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
    if (!circuit) { res.status(404).json({ error: 'Circuito no encontrado' }); return; }
    const player = await prisma.player.findUnique({ where: { id: parseInt(playerId) } });
    if (!player) { res.status(404).json({ error: 'Jugador no encontrado' }); return; }
    const circuitPlayer = await prisma.circuitPlayer.create({
      data: { circuitId, playerId: parseInt(playerId) },
      include: { player: { include: { category: true } } }
    });
    res.status(201).json(circuitPlayer);
  } catch (error: any) {
    if (error.code === 'P2002') { res.status(409).json({ error: 'El jugador ya está inscripto en este circuito' }); return; }
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/circuits/:id/players/:playerId
router.delete('/:id/players/:playerId', async (req: Request, res: Response) => {
  const circuitId = parseInt(req.params.id);
  const playerId = parseInt(req.params.playerId);
  try {
    const record = await prisma.circuitPlayer.findUnique({
      where: { circuitId_playerId: { circuitId, playerId } }
    });
    if (!record) { res.status(404).json({ error: 'El jugador no está inscripto en este circuito' }); return; }
    await prisma.circuitPlayer.delete({ where: { circuitId_playerId: { circuitId, playerId } } });
    res.json({ message: 'Jugador desinscripto correctamente' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/circuits/:id/seed-ranking
router.post('/:id/seed-ranking', async (req: Request, res: Response) => {
  const circuitId = parseInt(req.params.id);
  try {
    const circuit = await prisma.circuit.findUnique({ where: { id: circuitId } });
    if (!circuit) { res.status(404).json({ error: 'Circuito no encontrado' }); return; }
    const players = await prisma.player.findMany({ orderBy: { id: 'asc' } });
    let cargados = 0;
    for (const p of players) {
      if (p.dni && p.dni.startsWith('FEBIU')) {
        const pos = parseInt(p.dni.replace('FEBIU', ''));
        await prisma.rankingEntry.upsert({
          where: { playerId_circuitId: { playerId: p.id, circuitId } },
          update: { position: pos },
          create: { playerId: p.id, circuitId, position: pos, points: 0, matchesPlayed: 0, matchesWon: 0, setsWon: 0, setsLost: 0, pointsFor: 0, pointsAgainst: 0 },
        });
        cargados++;
      }
    }
    res.json({ message: 'Ranking inicial cargado', total: cargados });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------
// HELPER: obtener jugadores ordenados por ranking
// -------------------------------------------------------
async function getJugadoresOrdenados(circuit: any, circuitId: number) {
  let rankings = await prisma.rankingEntry.findMany({
    where: { circuitId },
    orderBy: { position: 'asc' }
  });

  if (rankings.length === 0) {
    const prevCircuit = await prisma.circuit.findFirst({
      where: { tournamentId: circuit.tournamentId, order: circuit.order - 1 }
    });
    if (prevCircuit) {
      rankings = await prisma.rankingEntry.findMany({
        where: { circuitId: prevCircuit.id },
        orderBy: { position: 'asc' }
      });
    }
  }

  const getRankPos = (playerId: number): number => {
    const entry = rankings.find((r: any) => r.playerId === playerId);
    return entry?.position ?? 9999;
  };

  const inscriptos = circuit.players.map((cp: any) => cp.player);
  const ordenados = [...inscriptos].sort((a: any, b: any) => getRankPos(a.id) - getRankPos(b.id));

  const master  = ordenados.filter((p: any) => p.category.name === 'master');
  const primera = ordenados.filter((p: any) => p.category.name === 'primera');
  const segunda = ordenados.filter((p: any) => p.category.name === 'segunda');
  const tercera = ordenados.filter((p: any) => p.category.name === 'tercera');

  return { master, primera, segunda, tercera };
}

// -------------------------------------------------------
// HELPER: armar series en espejo
// N jugadores, series de 4:
// Serie i (0-indexed): jugadores[i], jugadores[N-1-i], jugadores[N/2-1-i], jugadores[N/2+i]
// -------------------------------------------------------
function armarSeriesEspejo<T>(jugadores: T[], tamSerie: number): T[][] {
  const N = jugadores.length;
  const numSeries = Math.floor(N / tamSerie);
  const mitad = Math.floor(N / 2);
  const series: T[][] = [];

  for (let i = 0; i < numSeries; i++) {
    const serie: T[] = [
      jugadores[i],
      jugadores[N - 1 - i],
      jugadores[mitad - 1 - i],
      jugadores[mitad + i],
    ].filter(Boolean) as T[];
    series.push(serie);
  }

  // Si sobran jugadores (N no divisible por 4), armar serie final de 3
  const restantes = N - numSeries * tamSerie;
  if (restantes >= 2) {
    series.push(jugadores.slice(numSeries * tamSerie) as T[]);
  }

  return series;
}

// -------------------------------------------------------
// HELPER: doble eliminación 5 partidos
// P1: A vs B, P2: C vs D
// P3: ganW1 vs ganW2 (clasifica 1°)
// P4: perW1 vs perW2
// P5: perP3 vs ganP4 (clasifica 2°)
// -------------------------------------------------------
function generarDobleEliminacion5(
  jugadores: { id: number; firstName: string; lastName: string }[],
  phaseId: number,
  roundBase: number
): any[] {
  const partidos: any[] = [];
  if (jugadores.length === 4) {
    const [A, B, C, D] = jugadores;
    partidos.push(mkMatch(phaseId, A.id, B.id, roundBase));
    partidos.push(mkMatch(phaseId, C.id, D.id, roundBase + 1));
    partidos.push(mkMatch(phaseId, A.id, C.id, roundBase + 2)); // placeholder ganadores
    partidos.push(mkMatch(phaseId, B.id, D.id, roundBase + 3)); // placeholder perdedores
    partidos.push(mkMatch(phaseId, B.id, C.id, roundBase + 4)); // placeholder repechaje
  } else if (jugadores.length === 3) {
    const [A, B, C] = jugadores;
    partidos.push(mkMatch(phaseId, A.id, B.id, roundBase));
    partidos.push(mkMatch(phaseId, A.id, C.id, roundBase + 1));
    partidos.push(mkMatch(phaseId, B.id, C.id, roundBase + 2));
    partidos.push(mkMatch(phaseId, A.id, B.id, roundBase + 3));
    partidos.push(mkMatch(phaseId, A.id, C.id, roundBase + 4));
  }
  return partidos;
}

// -------------------------------------------------------
// HELPER: eliminación directa espejo
// -------------------------------------------------------
function generarEliminacionEspejo(
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

// -------------------------------------------------------
// GET /api/circuits/:id/preview — vista previa sin guardar
// -------------------------------------------------------
router.get('/:id/preview', async (req: Request, res: Response) => {
  const circuitId = parseInt(req.params.id);
  try {
    const circuit = await prisma.circuit.findUnique({
      where: { id: circuitId },
      include: {
        phases: { orderBy: { order: 'asc' } },
        players: { include: { player: { include: { category: true } } } }
      }
    });
    if (!circuit) { res.status(404).json({ error: 'Circuito no encontrado' }); return; }
    if (circuit.players.length === 0) { res.status(400).json({ error: 'Sin jugadores inscriptos' }); return; }

    const { master, primera, segunda, tercera } = await getJugadoresOrdenados(circuit, circuitId);

    const pn = (p: any) => `${p.lastName}, ${p.firstName}`;

    // Series clasificatorio
    const seriesClasif = armarSeriesEspejo(tercera, 4).map((serie, i) => ({
      serie: i + 1,
      jugadores: serie.map((p: any) => ({ id: p.id, nombre: pn(p) }))
    }));

    // Series segunda (32 segunda + 16 mejores de tercera como placeholder clasificados)
    const clasificadosPlaceholder = tercera.slice(0, 16);
    const todosSegunda = [...segunda, ...clasificadosPlaceholder];
    const seriesSegunda = armarSeriesEspejo(todosSegunda, 4).map((serie, i) => ({
      serie: i + 1,
      jugadores: serie.map((p: any) => ({ id: p.id, nombre: pn(p), esClasificado: clasificadosPlaceholder.some((c: any) => c.id === p.id) }))
    }));

    res.json({
      inscriptos: { master: master.length, primera: primera.length, segunda: segunda.length, tercera: tercera.length },
      clasificatorio: { totalJugadores: tercera.length, totalSeries: seriesClasif.length, series: seriesClasif },
      segunda: { totalJugadores: todosSegunda.length, totalSeries: seriesSegunda.length, series: seriesSegunda },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------
// POST /api/circuits/:id/generate — generar partidos
// -------------------------------------------------------
router.post('/:id/generate', async (req: Request, res: Response) => {
  const circuitId = parseInt(req.params.id);
  try {
    const circuit = await prisma.circuit.findUnique({
      where: { id: circuitId },
      include: {
        phases: { orderBy: { order: 'asc' } },
        players: { include: { player: { include: { category: true } } } }
      }
    });
    if (!circuit) { res.status(404).json({ error: 'Circuito no encontrado' }); return; }
    if (circuit.players.length === 0) { res.status(400).json({ error: 'El circuito no tiene jugadores inscriptos' }); return; }
    if (circuit.phases.length === 0) { res.status(400).json({ error: 'El circuito no tiene fases creadas' }); return; }

    // Borrar partidos existentes
    const phaseIds = circuit.phases.map(p => p.id);
    await prisma.setResult.deleteMany({ where: { match: { phaseId: { in: phaseIds } } } });
    await prisma.matchResult.deleteMany({ where: { match: { phaseId: { in: phaseIds } } } });
    await prisma.match.deleteMany({ where: { phaseId: { in: phaseIds } } });

    const { master, primera, segunda, tercera } = await getJugadoresOrdenados(circuit, circuitId);

    const phaseClasif  = circuit.phases.find(p => p.type === 'clasificatorio');
    const phaseSegunda = circuit.phases.find(p => p.type === 'segunda');
    const fasePrimera  = circuit.phases.find(p => p.type === 'primera');
    const faseMaster   = circuit.phases.find(p => p.type === 'master');

    const matchesCreados: any[] = [];

    // FASE CLASIFICATORIO
    if (phaseClasif && tercera.length > 0) {
      const series = armarSeriesEspejo(tercera, 4);
      let roundBase = 1;
      for (const serie of series) {
        matchesCreados.push(...generarDobleEliminacion5(serie, phaseClasif.id, roundBase));
        roundBase += 10;
      }
    }

    // FASE SEGUNDA — 32 segunda + 16 clasificados de tercera (placeholder)
    if (phaseSegunda && segunda.length > 0) {
      const clasificados = tercera.slice(0, 16);
      const todos = [...segunda, ...clasificados];
      const series = armarSeriesEspejo(todos, 4);
      let roundBase = 1;
      for (const serie of series) {
        matchesCreados.push(...generarDobleEliminacion5(serie, phaseSegunda.id, roundBase));
        roundBase += 10;
      }
    }

    // FASE PRIMERA — 24 primera + 24 clasificados de segunda (placeholder)
    if (fasePrimera && primera.length > 0) {
      const clasificados = segunda.slice(0, 24);
      const todos = [...primera, ...clasificados];
      matchesCreados.push(...generarEliminacionEspejo(todos, fasePrimera.id, 1));
    }

    // FASE MASTER — 8 master + 24 clasificados de primera (placeholder)
    if (faseMaster && master.length > 0) {
      const clasificados = primera.slice(0, 24);
      const todos = [...master, ...clasificados];
      matchesCreados.push(...generarEliminacionEspejo(todos, faseMaster.id, 1));
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
      },
      jugadores: { master: master.length, primera: primera.length, segunda: segunda.length, tercera: tercera.length }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
