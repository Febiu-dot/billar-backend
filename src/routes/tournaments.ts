import { Router, Response } from 'express';
import prisma from '../services/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

// ── Helper: cascade delete de un circuito ────────────────────────────
async function deleteCircuitCascade(circuitId: number) {
  const phases = await prisma.phase.findMany({ where: { circuitId } });
  const phaseIds = phases.map((p: any) => p.id);

  if (phaseIds.length > 0) {
    await prisma.setResult.deleteMany({ where: { match: { phaseId: { in: phaseIds } } } });
    await prisma.matchResult.deleteMany({ where: { match: { phaseId: { in: phaseIds } } } });
    await prisma.match.deleteMany({ where: { phaseId: { in: phaseIds } } });
    await prisma.faseConfig.deleteMany({ where: { phaseId: { in: phaseIds } } });
    await prisma.phase.deleteMany({ where: { circuitId } });
  }

  await prisma.circuitPlayer.deleteMany({ where: { circuitId } });
  await prisma.rankingEntry.deleteMany({ where: { circuitId } });
  await prisma.circuit.delete({ where: { id: circuitId } });
}

// GET all tournaments
router.get('/', async (_req, res: Response) => {
  try {
    const tournaments = await prisma.tournament.findMany({
      include: {
        departamento: true,
        circuits: {
          include: {
            phases: { include: { _count: { select: { matches: true } } } },
            players: { include: { player: { include: { category: true } } } }
          },
          orderBy: { order: 'asc' },
        },
      },
      orderBy: [{ year: 'desc' }, { name: 'asc' }],
    });
    res.json(tournaments);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET tournament by id
router.get('/:id', async (req, res: Response) => {
  try {
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
                    playerA: true, playerB: true,
                    table: { include: { venue: true } },
                    result: true,
                  },
                  orderBy: [{ round: 'asc' }, { createdAt: 'asc' }],
                },
              },
              orderBy: { order: 'asc' },
            },
            players: {
              include: { player: { include: { category: true } } },
              orderBy: { createdAt: 'asc' }
            },
          },
          orderBy: { order: 'asc' },
        },
      },
    });
    if (!tournament) { res.status(404).json({ error: 'Torneo no encontrado' }); return; }
    res.json(tournament);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST create tournament
router.post('/', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, year, description, active, departamentoId } = req.body;
    const tournament = await prisma.tournament.create({
      data: { name, year: Number(year), description, active: active ?? true, departamentoId: departamentoId ? Number(departamentoId) : undefined },
      include: { departamento: true }
    });
    res.status(201).json(tournament);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PUT update tournament
router.put('/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, year, description, active, departamentoId } = req.body;
    const tournament = await prisma.tournament.update({
      where: { id: Number(req.params.id) },
      data: { name, year: Number(year), description, active, departamentoId: departamentoId ? Number(departamentoId) : null },
      include: { departamento: true }
    });
    res.json(tournament);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE tournament — cascade completo
router.delete('/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const tournamentId = Number(req.params.id);
    const circuits = await prisma.circuit.findMany({ where: { tournamentId } });
    for (const circuit of circuits) {
      await deleteCircuitCascade(circuit.id);
    }
    await prisma.rankingAcumulado.deleteMany({ where: { tournamentId } });
    await prisma.tournament.delete({ where: { id: tournamentId } });
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST create circuit
router.post('/:id/circuits', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, order, startDate, endDate } = req.body;
    if (!name || name.trim() === '') { res.status(400).json({ error: 'El nombre del circuito es requerido' }); return; }
    const circuit = await prisma.circuit.create({
      data: {
        name: String(name).trim(),
        order: parseInt(String(order), 10),
        tournamentId: Number(req.params.id),
        startDate: startDate && startDate !== '' ? new Date(startDate) : undefined,
        endDate:   endDate   && endDate   !== '' ? new Date(endDate)   : undefined,
      },
    });
    res.status(201).json(circuit);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PUT update circuit
router.put('/circuits/:circuitId', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, order, startDate, endDate, active } = req.body;
    const circuit = await prisma.circuit.update({
      where: { id: Number(req.params.circuitId) },
      data: {
        name,
        order: order !== undefined ? parseInt(String(order), 10) : undefined,
        active,
        startDate: startDate && startDate !== '' ? new Date(startDate) : null,
        endDate:   endDate   && endDate   !== '' ? new Date(endDate)   : null,
      },
    });
    res.json(circuit);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE circuit — cascade completo
router.delete('/circuits/:circuitId', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    await deleteCircuitCascade(Number(req.params.circuitId));
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST create phase
router.post('/circuits/:circuitId/phases', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, type, order } = req.body;
    if (!name || name.trim() === '') { res.status(400).json({ error: 'El nombre de la fase es requerido' }); return; }
    const phase = await prisma.phase.create({
      data: { name: String(name).trim(), type, order: parseInt(String(order), 10), circuitId: Number(req.params.circuitId) },
    });
    res.status(201).json(phase);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE phase — cascade completo
router.delete('/phases/:phaseId', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const phaseId = Number(req.params.phaseId);
    await prisma.setResult.deleteMany({ where: { match: { phaseId } } });
    await prisma.matchResult.deleteMany({ where: { match: { phaseId } } });
    await prisma.match.deleteMany({ where: { phaseId } });
    await prisma.faseConfig.deleteMany({ where: { phaseId } });
    await prisma.phase.delete({ where: { id: phaseId } });
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
