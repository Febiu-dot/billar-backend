import { Router, Response } from 'express';
import prisma from '../services/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

// Fechas de calendario (inicio/fin): se guardan a las 12:00 UTC del dia elegido. Asi el dia no cambia
// al verlo en ningun huso horario (a medianoche UTC se veia el dia anterior/siguiente en Uruguay).
const diaCalendario = (s: string): Date => new Date(`${String(s).slice(0, 10)}T12:00:00.000Z`);

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

// POST crear un circuito del formato nuevo (Circuito Nacional 2026-27) con sus 4 fases y la configuracion ya guardada.
// Sin tournamentId crea el torneo "CIRCUITOS FEBIU 2026-27" con el Circuito 1; con tournamentId agrega el siguiente circuito.
// OJO: el nombre del torneo NO debe llevar la palabra "nacional" (el sistema la usa para tratarlo con las reglas viejas).
router.post('/nacional-2027', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { tournamentId } = req.body ?? {};
    let torneo: any;
    if (tournamentId) {
      torneo = await prisma.tournament.findUnique({ where: { id: Number(tournamentId) }, include: { circuits: true } });
      if (!torneo) { res.status(404).json({ error: 'Torneo no encontrado' }); return; }
    } else {
      torneo = await prisma.tournament.create({ data: { name: 'CIRCUITOS FEBIU 2026-27', year: 2026, description: 'Circuitos del formato nuevo 2026-27 y torneo final', active: true } });
      torneo.circuits = [];
    }
    const orden = (torneo.circuits ?? []).reduce((mx: number, c: any) => Math.max(mx, c.order ?? 0), 0) + 1;
    if (orden > 4) { res.status(400).json({ error: 'El torneo ya tiene los 4 circuitos.' }); return; }
    const circuit = await prisma.circuit.create({
      data: {
        name: `Circuito ${orden}`, order: orden, tournamentId: torneo.id,
        configTorneo: { tipo: 'departamental', esquema: 'nacional-2027', cantMaster: 16, cantPrimera: 16, cantSegunda: 0, cuposDesdeClasif: 64 } as any,
      },
    });
    const fases: { name: string; type: 'clasificatorio' | 'segunda' | 'primera' | 'master' }[] = [
      { name: 'Clasificatorio', type: 'clasificatorio' },
      { name: 'Cruces 64 a 16', type: 'segunda' },
      { name: 'Cruce con Primera Nacional', type: 'primera' },
      { name: 'Cuadro final', type: 'master' },
    ];
    for (let i = 0; i < fases.length; i++) {
      await prisma.phase.create({ data: { name: fases[i].name, type: fases[i].type, order: i + 1, circuitId: circuit.id } });
    }
    res.status(201).json({ ok: true, tournamentId: torneo.id, circuitId: circuit.id, circuito: circuit.name, torneo: torneo.name });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST restaura las fases que falten (de las 4) en un circuito del formato nuevo 2026-27.
router.post('/circuits/:circuitId/restaurar-fases-2027', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const circuitId = Number(req.params.circuitId);
    const circuit = await prisma.circuit.findUnique({ where: { id: circuitId }, include: { phases: true } });
    if (!circuit) { res.status(404).json({ error: 'Circuito no encontrado' }); return; }
    if ((circuit.configTorneo as any)?.esquema !== 'nacional-2027') { res.status(400).json({ error: 'Este circuito no es del formato nuevo 2026-27.' }); return; }
    const fases: { name: string; type: 'clasificatorio' | 'segunda' | 'primera' | 'master' }[] = [
      { name: 'Clasificatorio', type: 'clasificatorio' },
      { name: 'Cruces 64 a 16', type: 'segunda' },
      { name: 'Cruce con Primera Nacional', type: 'primera' },
      { name: 'Cuadro final', type: 'master' },
    ];
    const creadas: string[] = [];
    for (let i = 0; i < fases.length; i++) {
      if (circuit.phases.some((p: any) => p.type === fases[i].type)) continue;
      await prisma.phase.create({ data: { name: fases[i].name, type: fases[i].type, order: i + 1, circuitId } });
      creadas.push(fases[i].name);
    }
    res.json({ ok: true, creadas });
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
        startDate: startDate && startDate !== '' ? diaCalendario(startDate) : undefined,
        endDate:   endDate   && endDate   !== '' ? diaCalendario(endDate)   : undefined,
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
        startDate: startDate && startDate !== '' ? diaCalendario(startDate) : null,
        endDate:   endDate   && endDate   !== '' ? diaCalendario(endDate)   : null,
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
