import { Router, Response } from 'express';
import prisma from '../services/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { io } from '../index';
import { emitMatchUpdate, emitTableUpdate } from '../services/socketService';

const router = Router();

async function generarSiguientePartidoSerie(matchId: number) {
  try {
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      include: { result: true, phase: true }
    });
    if (!match || !match.result?.winnerId) return;

    const phaseId = match.phaseId;
    const round = match.round;
    const roundBase = Math.floor(round / 10) * 10 + 1;
    const posEnSerie = round - roundBase;

    if (posEnSerie > 3) return;

    const partidos = await prisma.match.findMany({
      where: { phaseId, serieId: match.serieId },
      include: { result: true },
      orderBy: { round: 'asc' },
    });

    const p1 = partidos.find(p => p.round === roundBase);
    const p2 = partidos.find(p => p.round === roundBase + 1);
    const p3 = partidos.find(p => p.round === roundBase + 2);
    const p4 = partidos.find(p => p.round === roundBase + 3);

    // Mesa y ruleSet se heredan siempre del P1 de la serie
    const tableId = p1?.tableId ?? null;
    const ruleSetId = p1?.ruleSetId ?? null;

    if (posEnSerie <= 1) {
      const p1Done = p1?.result?.winnerId;
      const p2Done = p2?.result?.winnerId;

      if (p1Done && p2Done && !p3) {
        // P3: ganador P1 vs ganador P2
        const newP3 = await prisma.match.create({
          data: {
            phaseId,
            playerAId: p1.result!.winnerId!,
            playerBId: p2.result!.winnerId!,
            round: roundBase + 2,
            status: 'asignado',
            serieId: match.serieId,
            tableId,
            ruleSetId,
          },
          include: {
            playerA: { include: { category: true } },
            playerB: { include: { category: true } },
            table: { include: { venue: true } },
            phase: { include: { circuit: { include: { tournament: true } } } },
            result: true,
            ruleSet: true,
            sets: { orderBy: { setNumber: 'asc' } },
          }
        });

        // P4: perdedor P1 vs perdedor P2
        const p1LoserId = p1.playerAId === p1.result!.winnerId ? p1.playerBId : p1.playerAId;
        const p2LoserId = p2.playerAId === p2.result!.winnerId ? p2.playerBId : p2.playerAId;

        if (p1LoserId && p2LoserId) {
          const newP4 = await prisma.match.create({
            data: {
              phaseId,
              playerAId: p1LoserId,
              playerBId: p2LoserId,
              round: roundBase + 3,
              status: 'asignado',
              serieId: match.serieId,
              tableId,
              ruleSetId,
            },
            include: {
              playerA: { include: { category: true } },
              playerB: { include: { category: true } },
              table: { include: { venue: true } },
              phase: { include: { circuit: { include: { tournament: true } } } },
              result: true,
              ruleSet: true,
              sets: { orderBy: { setNumber: 'asc' } },
            }
          });
          emitMatchUpdate(io, newP4);
        }

        emitMatchUpdate(io, newP3);
        console.log(`✅ Serie ${match.serieId}: P3 y P4 generados`);
      }
    }

    if (posEnSerie >= 2 && posEnSerie <= 3) {
      const p3Done = p3?.result?.winnerId;
      const p4Done = p4?.result?.winnerId;
      const p5existe = partidos.find(p => p.round === roundBase + 4);

      if (p3Done && p4Done && !p5existe) {
        const p3LoserId = p3!.playerAId === p3!.result!.winnerId ? p3!.playerBId : p3!.playerAId;

        if (p3LoserId && p4!.result!.winnerId) {
          const newP5 = await prisma.match.create({
            data: {
              phaseId,
              playerAId: p3LoserId,
              playerBId: p4!.result!.winnerId!,
              round: roundBase + 4,
              status: 'asignado',
              serieId: match.serieId,
              tableId,
              ruleSetId,
            },
            include: {
              playerA: { include: { category: true } },
              playerB: { include: { category: true } },
              table: { include: { venue: true } },
              phase: { include: { circuit: { include: { tournament: true } } } },
              result: true,
              ruleSet: true,
              sets: { orderBy: { setNumber: 'asc' } },
            }
          });
          emitMatchUpdate(io, newP5);
          console.log(`✅ Serie ${match.serieId}: P5 generado`);
        }
      }
    }
  } catch (error) {
    console.error('Error generando siguiente partido de serie:', error);
  }
}

// GET all matches
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
    orderBy: [{ scheduledAt: 'asc' }, { round: 'asc' }, { createdAt: 'asc' }],
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
  if (!match) return res.status(404).json({ error: 'Partido no encontrado' }) as any;
  res.json(match);
});

// PUT /:id — actualizar scheduledAt
router.put('/:id', authenticate, requireRole('admin', 'juez_sede'), async (req: AuthRequest, res: Response) => {
  const { scheduledAt } = req.body;
  const match = await prisma.match.update({
    where: { id: Number(req.params.id) },
    data: { scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined },
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

// PUT /:id/assign
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

// PUT /:id/start
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

// PUT /:id/set
router.put('/:id/set', authenticate, requireRole('admin', 'juez_sede'), async (req: AuthRequest, res: Response) => {
  const matchId = Number(req.params.id);
  const { setNumber, pointsA, pointsB } = req.body;

  const existingMatch = await prisma.match.findUnique({
    where: { id: matchId },
    include: { ruleSet: true, sets: true },
  });
  if (!existingMatch) return res.status(404).json({ error: 'Partido no encontrado' }) as any;

  const winnerId = pointsA > pointsB ? existingMatch.playerAId : existingMatch.playerBId;

  await prisma.setResult.upsert({
    where: { id: (existingMatch.sets.find(s => s.setNumber === setNumber)?.id ?? 0) },
    create: { matchId, setNumber, pointsA, pointsB, winnerId },
    update: { pointsA, pointsB, winnerId },
  });

  const allSets = await prisma.setResult.findMany({
    where: { matchId },
    orderBy: { setNumber: 'asc' },
  });

  const setsA = allSets.filter(s => s.pointsA > s.pointsB).length;
  const setsB = allSets.filter(s => s.pointsB > s.pointsA).length;
  const totalPtsA = allSets.reduce((acc, s) => acc + s.pointsA, 0);
  const totalPtsB = allSets.reduce((acc, s) => acc + s.pointsB, 0);

  await prisma.matchResult.upsert({
    where: { matchId },
    create: { matchId, setsA, setsB, pointsA: totalPtsA, pointsB: totalPtsB, isWO: false },
    update: { setsA, setsB, pointsA: totalPtsA, pointsB: totalPtsB },
  });

  const updatedMatch = await prisma.match.findUnique({
    where: { id: matchId },
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

  emitMatchUpdate(io, updatedMatch);
  res.json(updatedMatch);
});

// PUT /:id/result
router.put('/:id/result', authenticate, requireRole('admin', 'juez_sede'), async (req: AuthRequest, res: Response) => {
  const matchId = Number(req.params.id);
  const { setsA, setsB, pointsA, pointsB, isWO, woPlayerId, notes, sets } = req.body;

  const existingMatch = await prisma.match.findUnique({
    where: { id: matchId },
    include: { ruleSet: true, phase: { include: { circuit: true } } },
  });
  if (!existingMatch) return res.status(404).json({ error: 'Partido no encontrado' }) as any;

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
    const setsToWin = ruleSet?.setsToWin ?? 2;
    if (finalSetsA >= setsToWin) winnerId = existingMatch.playerAId;
    else if (finalSetsB >= setsToWin) winnerId = existingMatch.playerBId;
  }

  const result = await prisma.matchResult.upsert({
    where: { matchId },
    create: { matchId, setsA: finalSetsA, setsB: finalSetsB, pointsA: finalPtsA, pointsB: finalPtsB, winnerId, isWO: !!isWO, woPlayerId, notes },
    update: { setsA: finalSetsA, setsB: finalSetsB, pointsA: finalPtsA, pointsB: finalPtsB, winnerId, isWO: !!isWO, woPlayerId, notes },
  });

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

  // NO liberar la mesa si el partido pertenece a una serie
  // La mesa se libera solo cuando termina el P5 (último partido de la serie)
  const esPartidoDeSerie = existingMatch.serieId &&
    !existingMatch.serieId.includes('reduccion') &&
    !existingMatch.serieId.includes('repechaje') &&
    (existingMatch.phase?.type === 'clasificatorio' || existingMatch.phase?.type === 'segunda');

  const roundBase = Math.floor(existingMatch.round / 10) * 10 + 1;
  const posEnSerie = existingMatch.round - roundBase;
  const esUltimoPartidoSerie = posEnSerie === 4; // P5

  if (!esPartidoDeSerie || esUltimoPartidoSerie) {
    if (updatedMatch.tableId) {
      const freedTable = await prisma.table.update({
        where: { id: updatedMatch.tableId },
        data: { status: 'libre' },
        include: { venue: true },
      });
      emitTableUpdate(io, freedTable);
    }
  }

  emitMatchUpdate(io, updatedMatch);

  const phaseType = existingMatch.phase?.type;
  if (phaseType === 'clasificatorio' || phaseType === 'segunda') {
    await generarSiguientePartidoSerie(matchId);
  }

  res.json({ match: updatedMatch, result });
});

// POST /auto-assign
router.post('/auto-assign', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const { matchId, venueId } = req.body;

  const freeTable = await prisma.table.findFirst({
    where: { status: 'libre', ...(venueId ? { venueId: Number(venueId) } : {}) },
    orderBy: [{ venueId: 'asc' }, { number: 'asc' }],
  });

  if (!freeTable) return res.status(409).json({ error: 'No hay mesas libres disponibles' }) as any;

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
