import { Router, Response } from 'express';
import prisma from '../services/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

router.get('/', async (_req, res: Response) => {
  const tournaments = await prisma.tournament.findMany({
    include: {
      circuits: {
        include: { phases: { include: { _count: { select: { matches: true } } } } },
        orderBy: { order: 'asc' },
      },
    },
    orderBy: [{ year: 'desc' }, { name: 'asc' }],
  });
  res.json(tournaments);
});

router.get('/:id', async (req, res: Response) => {
  const tournament = await prisma.tournament.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      circuits: {
        include: {
          phases: {
            include: {
              matches: {
                include: {
                  playerA: true,
                  playerB: true,
                  table: { include: { venue: true } },
                  result: true,
                },
                orderBy: [{ round: 'asc' }, { createdAt: 'asc' }],
              },
            },
            orderBy: { order: 'asc' },
          },
        },
        orderBy: { order: 'asc' },
      },
    },
  });
  if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });
  res.json(tournament);
});

router.post('/', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const { name, year, description } = req.body;
  const tournament = await prisma.tournament.create({ data: { name, year, description } });
  res.status(201).json(tournament);
});

export default router;
