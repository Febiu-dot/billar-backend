import { Router, Response } from 'express';
import prisma from '../services/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

router.get('/', async (req, res: Response) => {
  const { categoryId, active } = req.query;
  const players = await prisma.player.findMany({
    where: {
      ...(categoryId ? { categoryId: Number(categoryId) } : {}),
      ...(active !== undefined ? { active: active === 'true' } : {}),
    },
    include: { category: true },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });
  res.json(players);
});

router.get('/:id', async (req, res: Response) => {
  const player = await prisma.player.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      category: true,
      matchesA: {
        include: { playerB: true, result: true, phase: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
      matchesB: {
        include: { playerA: true, result: true, phase: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
    },
  });
  if (!player) return res.status(404).json({ error: 'Jugador no encontrado' });
  res.json(player);
});

router.post('/', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const { firstName, lastName, dni, categoryId } = req.body;
  const player = await prisma.player.create({
    data: { firstName, lastName, dni, categoryId },
    include: { category: true },
  });
  res.status(201).json(player);
});

router.put('/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const { firstName, lastName, dni, categoryId, active } = req.body;
  const player = await prisma.player.update({
    where: { id: Number(req.params.id) },
    data: { firstName, lastName, dni, categoryId, active },
    include: { category: true },
  });
  res.json(player);
});

export default router;
