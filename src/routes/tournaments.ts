import { Router, Response } from 'express';
import prisma from '../services/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

// GET all tournaments
router.get('/', async (_req, res: Response) => {
  const tournaments = await prisma.tournament.findMany({
    include: {
      circuits: {
        include: {
          phases: { include: { _count: { select: { matches: true } } } },
          players: {
            include: {
              player: { include: { category: true } }
            }
          }
        },
        orderBy: { order: 'asc' },
      },
    },
    orderBy: [{ year: 'desc' }, { name: 'asc' }],
  });
  res.json(tournaments);
});

// GET tournament by id
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
          players: {
            include: {
              player: { include: { category: true } }
            },
            orderBy: { createdAt: 'asc' }
          },
        },
        orderBy: { order: 'asc' },
      },
    },
  });
  if (!tournament) { res.status(404).json({ error: 'Torneo no encontrado' }); return; }
  res.json(tournament);
});

// POST create tournament
router.post('/', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const { name, year, description, active } = req.body;
  const tournament = await prisma.tournament.create({
    data: { name, year, description, active: active ?? true },
  });
  res.status(201).json(tournament);
});

// PUT update tournament
router.put('/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const { name, year, description, active } = req.body;
  const tournament = await prisma.tournament.update({
    where: { id: Number(req.params.id) },
    data: { name, year, description, active },
  });
  res.json(tou
