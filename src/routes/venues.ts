import { Router, Response } from 'express';
import prisma from '../services/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

router.get('/', async (_req, res: Response) => {
  const venues = await prisma.venue.findMany({
    include: { tables: true, departamento: true, _count: { select: { tables: true } } },
    orderBy: { name: 'asc' },
  });
  res.json(venues);
});

router.get('/:id', async (req, res: Response) => {
  const venue = await prisma.venue.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      tables: { orderBy: { number: 'asc' } },
      departamento: true,
      users: { select: { id: true, username: true, role: true } },
    },
  });
  if (!venue) return res.status(404).json({ error: 'Sede no encontrada' }) as any;
  res.json(venue);
});

router.post('/', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const { name, address, city, departamentoId } = req.body;
  const venue = await prisma.venue.create({
    data: { name, address, city, departamentoId: departamentoId ? Number(departamentoId) : undefined },
    include: { departamento: true }
  });
  res.status(201).json(venue);
});

router.put('/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const { name, address, city, departamentoId } = req.body;
  const venue = await prisma.venue.update({
    where: { id: Number(req.params.id) },
    data: { name, address, city, departamentoId: departamentoId ? Number(departamentoId) : null },
    include: { departamento: true }
  });
  res.json(venue);
});

router.delete('/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.venue.delete({ where: { id: Number(req.params.id) } });
    res.json({ ok: true });
  } catch {
    res.status(400).json({ error: 'No se puede eliminar la sede. Puede tener mesas o usuarios asignados.' });
  }
});

export default router;
