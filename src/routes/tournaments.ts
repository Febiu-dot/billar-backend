import { Router, Response } from 'express';
import prisma from '../services/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

// GET all tournaments
router.get('/', async (_req, res: Response) => {
  const tournaments = await prisma.tournament.findMany({
    include: {
      departamento: true,
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
      departamento: true,
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
  if (!tournament) {
    res.status(404).json({ error: 'Torneo no encontrado' });
    return;
  }
  res.json(tournament);
});

// POST create tournament
router.post('/', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const { name, year, description, active, departamentoId } = req.body;
  const tournament = await prisma.tournament.create({
    data: { name, year, description, active: active ?? true, departamentoId: departamentoId ? Number(departamentoId) : undefined },
    include: { departamento: true }
  });
  res.status(201).json(tournament);
});

// PUT update tournament
router.put('/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const { name, year, description, active, departamentoId } = req.body;
  const tournament = await prisma.tournament.update({
    where: { id: Number(req.params.id) },
    data: { name, year, description, active, departamentoId: departamentoId ? Number(departamentoId) : null },
    include: { departamento: true }
  });
  res.json(tournament);
});

// DELETE tournament
router.delete('/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.tournament.delete({ where: { id: Number(req.params.id) } });
    res.json({ ok: true });
  } catch {
    res.status(400).json({ error: 'No se puede eliminar el torneo. Puede tener circuitos asociados.' });
  }
});

// POST create circuit
router.post('/:id/circuits', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const { name, order, startDate, endDate } = req.body;
  const circuit = await prisma.circuit.create({
    data: {
      name,
      order,
      tournamentId: Number(req.params.id),
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    },
  });
  res.status(201).json(circuit);
});

// PUT update circuit
router.put('/circuits/:circuitId', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const { name, order, startDate, endDate, active } = req.body;
  const circuit = await prisma.circuit.update({
    where: { id: Number(req.params.circuitId) },
    data: {
      name,
      order,
      active,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    },
  });
  res.json(circuit);
});

// DELETE circuit
router.delete('/circuits/:circuitId', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.circuit.delete({ where: { id: Number(req.params.circuitId) } });
    res.json({ ok: true });
  } catch {
    res.status(400).json({ error: 'No se puede eliminar el circuito. Puede tener fases asociadas.' });
  }
});

// POST create phase
router.post('/circuits/:circuitId/phases', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const { name, type, order } = req.body;
  const phase = await prisma.phase.create({
    data: {
      name,
      type,
      order,
      circuitId: Number(req.params.circuitId),
    },
  });
  res.status(201).json(phase);
});

// DELETE phase
router.delete('/phases/:phaseId', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.phase.delete({ where: { id: Number(req.params.phaseId) } });
    res.json({ ok: true });
  } catch {
    res.status(400).json({ error: 'No se puede eliminar la fase. Puede tener partidos asociados.' });
  }
});

export default router;
