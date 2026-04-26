import { Router, Response } from 'express';
import prisma from '../services/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { io } from '../index';
import { emitMatchUpdate, emitTableUpdate } from '../services/socketService';

const router = Router();

// GET all matches with filters
router.get('/', async (req, res: Response) => {
  const { phaseId, status, tableId, venueId } = req.query;

  const matches = await prisma.match.findMany({
    where: {
      ...(phaseId ? { phaseId: Number(phaseId) } : {}),
      ...(status ? { status: status as any } : {}),
      ...(tableId ? { tableId: Number(tableId) } : {}),
      ...(venueId ? { table: { venueId: Number(venueId) } } : {}),
    },
    include: {
      playerA: { include: { category: true } },
      playerB: { include: { category: true } },
      table: { include: { venue: true } },
      phase: { include: { circuit: { include: { tournament: true } } } },
      result: true,
      ruleSet: true,
      sets: { orderBy: { setNumber: 'asc' } },
    },
    orderBy: [{ round: 'asc' }, { createdAt: 'asc' }],
  });
  res.json(matches);
});

router.get('/active', async (_req, res: Response) => {
  const matches = await prisma.match.findMany({
    where: { status: { in: ['asignado', 'en_juego'] } },
    include: {
      playerA: { include: { category: true } },
      playerB: { include: { category: true } },
      table: { include: { venue: true } },
      phase: { include: { circuit: { include: { tournament: true } } } },
      result: true,
      sets: { orderBy: { setNumber: 'asc' } },
    },
    orderBy: { updatedAt: 'desc' },
  });
  res.json(matches);
});

router.get('/:id', async (req, res: Response) => {
  const match = await prisma.match.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      playerA: { include: { category: true } },
      playerB: { include: { category: true } },
      table: { include: { venue: true } },
      phase: { include: { circuit: { include: { tournament: true } } } },
      result: true,
      ruleSet: true,
      sets: { orderBy: { setNumber: 'asc' } },
    },
  });
  if (!match) return res.status(404).json({ error: 'Partido no encontrado' });
  res.json(match);
});

// Assign match to table
router.put('/:id/assign', authenticate, requireRole('admin', 'juez_sede'), async (req: AuthRequest, res: Response) => {
  const { tableId } = req.body;
  const matchId = Number(req.params.id);

  await prisma.table.update({
    where: { id: tableId },
    data: { status: 'ocupada' },
  });

  const match = await prisma.match.update({
    where: { id: matchId },
    data: { tableId, status: 'asignado' },
    include: {
      playerA: { include: { category: true } },
      playerB: { include: { category: true } },
      table: { include: { venue: true } },
      phase: { include: { circuit: { include: { tournament: true } } } },
      result: true,
      sets: { orderBy: { setNumber: 'asc' } },
    },
  });

  emitMatchUpdate(io, match);
  if (match.table) emitTableUpdate(io, match.table);
  res.json(match);
});

// Start match
router.put('/:id/start', authenticate, requireRole('admin', 'juez_sede'), async (req: AuthRequest, res: Response) => {
  const match = await prisma.match.update({
    where: { id: Number(req.params.id) },
    data: { status: 'en_juego', startedAt: new Date() },
    include: {
      playerA: { include: { category: true } },
      playerB: { include: { category: true } },
      table: { include: { venue: true } },
      phase: { include: { circuit: { include: { tournament: true } } } },
      result: true,
      sets: { orderBy: { setNumber: 'asc' } },
    },
  });
  emitMatchUpdate(io, match);
  res.json(match);
});

// Load result
router.put('/:id/result', authenticate, requireRole('admin', 'juez_sede'), async (req: AuthRequest, res: Response) => {
  const matchId = Number(req.params.id);
  const { setsA, setsB, pointsA, pointsB, isWO, woPlayerId, notes, sets } = req.body;

  const existingMatch = await prisma.match.findUnique({
    where: { id: matchId },
    include: { ruleSet: true },
  });
  if (!existingMatch) return res.status(404).json({ error: 'Partido no encontrado' });

  const ruleSet = existingMatch.ruleSet;
  let finalSetsA = setsA;
  let finalSetsB = setsB;
  let finalPtsA = pointsA;
  let finalPtsB = pointsB;
  let winnerId: number | null = null;

  if (isWO) {
    const absentId = woPlayerId;
    const winnPId = absentId === existingMatch.playerAId ? existingMatch.playerBId : existingMatch.playerAId;
    winnerId = winnPId;
    if (ruleSet) {
      if (absentId === existingMatch.playerAId) {
        finalSetsA = ruleSet.woSetsLoser;
        finalSetsB = ruleSet.woSetsWinner;
        finalPtsA = ruleSet.woPtsLoser;
        finalPtsB = ruleSet.woPtsWinner;
      } else {
        finalSetsA = ruleSet.woSetsWinner;
        finalSetsB = ruleSet.woSetsLoser;
        finalPtsA = ruleSet.woPtsWinner;
        finalPtsB = ruleSet.woPtsLoser;
      }
    }
  } else {
    const setsToWin = ruleSet?.setsToWin ?? 3;
    if (finalSetsA >= setsToWin) winnerId = existingMatch.playerAId;
    else if (finalSetsB >= setsToWin) winnerId = existingMatch.playerBId;
  }

  const result = await prisma.matchResult.upsert({
    where: { matchId },
    create: { matchId, setsA: finalSetsA, setsB: finalSetsB, pointsA: finalPtsA, pointsB: finalPtsB, winnerId, isWO: !!isWO, woPlayerId, notes },
    update: { setsA: finalSetsA, setsB: finalSetsB, pointsA: finalPtsA, pointsB: finalPtsB, winnerId, isWO: !!isWO, woPlayerId, notes },
  });

  // Guardar sets individuales
  if (!isWO && sets && Array.isArray(sets) && sets.length > 0) {
    await prisma.setResult.deleteMany({ where: { matchId } });
    await prisma.setResult.createMany({
      data: sets.map((s: { setNumber: number; pointsA: number; pointsB: number }) => ({
        matchId,
        setNumber: s.setNumber,
        pointsA: s.pointsA,
        pointsB: s.pointsB,
        winnerId: s.pointsA > s.pointsB ? existingMatch.playerAId : existingMatch.playerBId,
      })),
    });
  }

  const updatedMatch = await prisma.match.update({
    where: { id: matchId },
    data: { status: isWO ? 'wo' : 'finalizado', finishedAt: new Date() },
    include: {
      playerA: { include: { category: true } },
      playerB: { include: { category: true } },
      table: { include: { venue: true } },
      phase: { include: { circuit: { include: { tournament: true } } } },
      result: true,
      sets: { orderBy: { setNumber: 'asc' } },
    },
  });

  if (updatedMatch.tableId) {
    const freedTable = await prisma.table.update({
      where: { id: updatedMatch.tableId },
      data: { status: 'libre' },
      include: { venue: true },
    });
    emitTableUpdate(io, freedTable);
  }

  emitMatchUpdate(io, updatedMatch);
  res.json({ match: updatedMatch, result });
});

// Auto-assign: first available table
router.post('/auto-assign', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const { matchId, venueId } = req.body;

  const freeTable = await prisma.table.findFirst({
    where: { status: 'libre', ...(venueId ? { venueId: Number(venueId) } : {}) },
    orderBy: [{ venueId: 'asc' }, { number: 'asc' }],
  });

  if (!freeTable) return res.status(409).json({ error: 'No hay mesas libres disponibles' });

  await prisma.table.update({ where: { id: freeTable.id }, data: { status: 'ocupada' } });

  const match = await prisma.match.update({
    where: { id: matchId },
    data: { tableId: freeTable.id, status: 'asignado' },
    include: {
      playerA: { include: { category: true } },
      playerB: { include: { category: true } },
      table: { include: { venue: true } },
      phase: { include: { circuit: { include: { tournament: true } } } },
      result: true,
      sets: { orderBy: { setNumber: 'asc' } },
    },
  });

  emitMatchUpdate(io, match);
  emitTableUpdate(io, { ...freeTable, status: 'ocupada' });
  res.json(match);
});

export default router;