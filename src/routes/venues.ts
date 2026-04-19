import { Router, Response } from 'express';
import prisma from '../services/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

router.get('/', async (_req, res: Response) => {
  const venues = await prisma.venue.findMany({
    include: { tables: true, _count: { select: { tables: true } } },
    orderBy: { name: 'asc' },
  });
  res.json(venues);
});

router.get('/:id', async (req, res: Response) => {
  const venue = await prisma.venue.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      tables: { orderBy: { number: 'asc' } },
      users: { select: { id: true, username: true, role: true } },
    },
  });
  if (!venue) return res.status(404).json({ error: 'Sede no encontrada' });
  res.json(venue);
});

router.post('/', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const { name, address, city } = req.body;
  const venue = await prisma.venue.create({ data: { name, address, city } });
  res.status(201).json(venue);
});

router.put('/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const { name, address, city } = req.body;
  const venue = await prisma.venue.update({
    where: { id: Number(req.params.id) },
    data: { name, address, city },
  });
  res.json(venue);
});

export default router;
