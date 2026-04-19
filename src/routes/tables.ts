import { Router, Response } from 'express';
import prisma from '../services/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { io } from '../index';
import { emitTableUpdate } from '../services/socketService';

const router = Router();

router.get('/', async (req, res: Response) => {
  const { venueId } = req.query;
  const tables = await prisma.table.findMany({
    where: venueId ? { venueId: Number(venueId) } : undefined,
    include: {
      venue: true,
      matches: {
        where: { status: { in: ['asignado', 'en_juego'] } },
        include: {
          playerA: true,
          playerB: true,
          phase: { include: { circuit: { include: { tournament: true } } } },
        },
        take: 1,
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

export default router;
