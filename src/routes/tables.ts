import { Router, Response } from 'express';
import prisma from '../services/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { io } from '../index';
import { emitTableUpdate } from '../services/socketService';

const router = Router();

router.get('/', async (req, res: Response) => {
  const { venueId, cola } = req.query;
  // cola=1 (panel del juez): devuelve TODOS los partidos jugables de cada mesa
  // (asignados / en juego, con ambos jugadores definidos y torneo activo), no solo uno.
  // Sin cola: comportamiento original (un solo partido por mesa).
  const matchesWhere: any = cola
    ? {
        status: { in: ['asignado', 'en_juego'] },
        playerAId: { not: null },
        playerBId: { not: null },
        phase: { circuit: { tournament: { active: true } } },
      }
    : { status: { in: ['asignado', 'en_juego'] } };
  const matchesExtra: any = cola
    ? { orderBy: [{ scheduledAt: 'asc' }, { round: 'asc' }, { id: 'asc' }] }
    : { take: 1 };
  const tables = await prisma.table.findMany({
    where: venueId ? { venueId: Number(venueId) } : undefined,
    include: {
      venue: true,
      matches: {
        where: matchesWhere,
        include: {
          playerA: { include: { category: true } },
          playerB: { include: { category: true } },
          phase: { include: { circuit: { include: { tournament: true } } } },
          result: true,
          ruleSet: true,
        },
        ...matchesExtra,
      },
    },
    orderBy: [{ venueId: 'asc' }, { number: 'asc' }],
  });
  res.json(tables);
});

router.get('/:id', async (req, res: Response) => {
  const table = await prisma.table.findUnique({
    where: { id: Number(req.params.id) },
    include: { venue: true },
  });
  if (!table) return res.status(404).json({ error: 'Mesa no encontrada' });
  res.json(table);
});

router.post('/', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const { number, venueId } = req.body;
  const table = await prisma.table.create({ data: { number, venueId } });
  res.status(201).json(table);
});

router.put('/:id/status', authenticate, requireRole('admin', 'juez_sede'), async (req: AuthRequest, res: Response) => {
  const { status } = req.body;
  const table = await prisma.table.update({
    where: { id: Number(req.params.id) },
    data: { status },
    include: { venue: true },
  });
  emitTableUpdate(io, table);
  res.json(table);
});
router.delete('/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.table.delete({ where: { id: Number(req.params.id) } });
    res.json({ ok: true });
  } catch {
    res.status(400).json({ error: 'No se puede eliminar la mesa. Puede tener partidos asignados.' });
  }
});
export default router;
