import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// GET /api/circuits
router.get('/', async (_req: Request, res: Response) => {
  try {
    const circuits = await prisma.circuit.findMany({
      include: {
        tournament: true,
        phases: { orderBy: { order: 'asc' } },
        players: {
          include: {
            player: { include: { category: true } }
          }
        }
      },
      orderBy: { order: 'asc' }
    });
    res.json(circuits);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/circuits/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const circuit = await prisma.circuit.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        tournament: true,
        phases: { orderBy: { order: 'asc' } },
        players: {
          include: {
            player: { include: { category: true } }
          }
        }
      }
    });
    if (!circuit) {
      res.status(404).json({ error: 'Circuito no encontrado' });
      return;
    }
    res.json(circuit);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/circuits/:id/players — inscribir jugador
router.post('/:id/players', async (req: Request, res: Response) => {
  const circuitId = parseInt(req.params.id);
  const { playerId } = req.body;
  if (!playerId) {
    res.status(400).json({ error: 'playerId es requerido' });
    return;
  }
  try {
    const circuit = await prisma.circuit.findUnique({ where: { id: circuitId } });
    if (!circuit) {
      res.status(404).json({ error: 'Circuito no encontrado' });
      return;
    }
    const player = await prisma.player.findUnique({ where: { id: parseInt(playerId) } });
    if (!player) {
      res.status(404).json({ error: 'Jugador no encontrado' });
      return;
    }
    const circuitPlayer = await prisma.circuitPlayer.create({
      data: { circuitId, playerId: parseInt(playerId) },
      include: {
        player: { include: { category: true } }
      }
    });
    res.status(201).json(circuitPlayer);
  } catch (error: any) {
    if (error.code === 'P2002') {
      res.status(409).json({ error: 'El jugador ya está inscripto en este circuito' });
      return;
    }
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/circuits/:id/players/:playerId — desinscribir jugador
router.delete('/:id/players/:playerId', async (req: Request, res: Response) => {
  const circuitId = parseInt(req.params.id);
  const playerId = parseInt(req.params.playerId);
  try {
    const record = await prisma.circuitPlayer.findUnique({
      where: { circuitId_playerId: { circuitId, playerId } }
    });
    if (!record) {
      res.status(404).json({ error: 'El jugador no está inscripto en este circuito' });
      return;
    }
    await prisma.circuitPlayer.delete({
      where: { circuitId_playerId: { circuitId, playerId } }
    });
    res.json({ message: 'Jugador desinscripto correctamente' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/circuits/:id/generate — generar partidos automáticamente
router.post('/:id/generate', async (req: Request, res: Response) => {
  const circuitId = parseInt(req.params.id);

  try {
    const circuit = await prisma.circuit.findUnique({
      where: { id: circuitId },
      include: {
        phases: { orderBy: { order: 'asc' } },
        players: {
          include: {
            player: { include: { category: true } }
          }
        }
      }
    });

    if (!circuit) {
      res.status(404).json({ error: 'Circuito no encontrado' });
      return;
    }

    if (circuit.players.length === 0) {
      res.status(400).json({ error: 'El circuito no tiene jugadores inscriptos' });
      return;
    }

    if (circuit.phases.length === 0) {
      res.status(400).json({ error: 'El circuito no tiene fases creadas' });
      return;
    }

    // Borrar partidos existentes de todas las fases del circuito
    const phaseIds = circuit.phases.map(p => p.id);
    await prisma.setResult.deleteMany({ where: { match: { phaseId: { in: phaseIds } } } });
    await prisma.matchResult.deleteMany({ where: { match: { phaseId: { in: phaseIds } } } });
    await prisma.match.deleteMany({ where: { phaseId: { in: phaseIds } } });

    // Ranking del circuito anterior para ordenar jugadores
    const prevCircuit = await prisma.circuit.findFirst({
      where: {
        tournamentId: circuit.tournamentId,
        order: circuit.order - 1
      },
      include: {
        rankings: {
          include: { player: true },
          orderBy: { position: 'asc' }
        }
      }
    });

    const inscriptos = circuit.players.map(cp => cp.player);

    const getRankPosition = (playerId: number): number => {
      if (!prevCircuit) return 9999;
      const entry = prevCircuit.rankings.find(r => r.playerId === playerId);
      return entry?.position ?? 9999;
    };

    const sortByRank = (players: typeof inscriptos) =>
      [...players].sort((a, b) => getRankPosition(a.id) - getRankPosition(b.id));

    const master  = sortByRank(inscriptos.filter(p => p.category.name === 'master'));
    const primera = sortByRank(inscriptos.filter(p => p.category.name === 'primera'));
    const segunda = sortByRank(inscriptos.filter(p => p.category.name === 'segunda'));
    const tercera = sortByRank(inscriptos.filter(p => p.category.name === 'tercera'));

    const getPhase = (tipo: string) => circuit.phases.find(p => p.type === tipo);
    const phaseClasif  = getPhase('clasificatorio');
    const phaseSegunda = getPhase('segunda');
    const fasePrimera  = getPhase('primera');
    const faseMaster   = getPhase('master');

    const matchesCreados: any[] = [];

    // FASE CLASIFICATORIO
    if (phaseClasif) {
      const jugadoresClasif = tercera;
      const series = armarSeries(jugadoresClasif, 4);
      let round = 1;
      for (const serie of series) {
        const partidos = generarDobleEliminacion(serie, phaseClasif.id, round);
        matchesCreados.push(...partidos);
        round += 10;
      }
    }

    // FASE SEGUNDA
    if (phaseSegunda) {
      const series = armarSeriesEspejo(segunda, [], 4);
      let round = 1;
      for (const serie of series) {
        const partidos = generarDobleEliminacion(serie, phaseSegunda.id, round);
        matchesCreados.push(...partidos);
        round += 10;
      }
    }

    // FASE PRIMERA — eliminación directa espejo
    if (fasePrimera) {
      const partidos = generarEliminacionDirectaEspejo(primera, fasePrimera.id, 1);
      matchesCreados.push(...partidos);
    }

    // FASE MASTER — eliminación directa espejo
    if (faseMaster) {
      const partidos = generarEliminacionDirectaEspejo(master, faseMaster.id, 1);
      matchesCreados.push(...partidos);
    }

    if (matchesCreados.length > 0) {
      await prisma.match.createMany({ data: matchesCreados });
    }

    res.json({
      message: 'Partidos generados correctamente',
      total: matchesCreados.length,
      detalle: {
        clasificatorio: matchesCreados.filter(m => m.phaseId === phaseClasif?.id).length,
        segunda: matchesCreados.filter(m => m.phaseId === phaseSegunda?.id).length,
        primera: matchesCreados.filter(m => m.phaseId === fasePrimera?.id).length,
        master: matchesCreados.filter(m => m.phaseId === faseMaster?.id).length,
      }
    });

  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------
// HELPERS
// -------------------------------------------------------

function armarSeries<T>(jugadores: T[], tam: number): T[][] {
  const series: T[][] = [];
  let i = 0;
  while (i < jugadores.length) {
    series.push(jugadores.slice(i, i + tam));
    i += tam;
  }
  return series;
}

function armarSeriesEspejo<T extends { id: number }>(
  mejores: T[],
  clasificados: T[],
  tam: number
): T[][] {
  const todos = [...mejores, ...clasificados];
  const n = todos.length;
  const series: T[][] = [];
  const mitad = Math.floor(n / tam / 2);
  for (let i = 0; i < mitad; i++) {
    const serie: T[] = [
      todos[i],
      todos[n - 1 - i],
      todos[mitad + i],
      todos[n - 1 - mitad - i],
    ].filter(Boolean) as T[];
    series.push(serie);
  }
  return series;
}

function generarDobleEliminacion(
  jugadores: { id: number }[],
  phaseId: number,
  roundBase: number
): any[] {
  const partidos: any[] = [];
  if (jugadores.length === 4) {
    const [A, B, C, D] = jugadores;
    partidos.push(mkMatch(phaseId, A.id, B.id, roundBase));
    partidos.push(mkMatch(phaseId, C.id, D.id, roundBase));
    partidos.push(mkMatch(phaseId, A.id, C.id, roundBase + 1));
    partidos.push(mkMatch(phaseId, B.id, D.id, roundBase + 2));
    partidos.push(mkMatch(phaseId, A.id, B.id, roundBase + 3));
  } else if (jugadores.length === 3) {
    const [A, B, C] = jugadores;
    partidos.push(mkMatch(phaseId, A.id, B.id, roundBase));
    partidos.push(mkMatch(phaseId, A.id, C.id, roundBase + 1));
    partidos.push(mkMatch(phaseId, B.id, C.id, roundBase + 2));
  }
  return partidos;
}

function generarEliminacionDirectaEspejo(
  jugadores: { id: number }[],
  phaseId: number,
  round: number
): any[] {
  const partidos: any[] = [];
  const n = jugadores.length;
  for (let i = 0; i < Math.floor(n / 2); i++) {
    partidos.push(mkMatch(phaseId, jugadores[i].id, jugadores[n - 1 - i].id, round));
  }
  return partidos;
}

function mkMatch(phaseId: number, playerAId: number, playerBId: number, round: number) {
  return { phaseId, playerAId, playerBId, round, status: 'pendiente' };
}

export default router;
