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
      include: { player: { include: { category: true } } }
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

// POST /api/circuits/:id/seed-ranking — cargar ranking inicial
router.post('/:id/seed-ranking', async (req: Request, res: Response) => {
  const circuitId = parseInt(req.params.id);
  try {
    const circuit = await prisma.circuit.findUnique({ where: { id: circuitId } });
    if (!circuit) {
      res.status(404).json({ error: 'Circuito no encontrado' });
      return;
    }
    const players = await prisma.player.findMany({ orderBy: { id: 'asc' } });
    let cargados = 0;
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      if (p.dni && p.dni.startsWith('FEBIU')) {
        const pos = parseInt(p.dni.replace('FEBIU', ''));
        await prisma.rankingEntry.upsert({
          where: { playerId_circuitId: { playerId: p.id, circuitId } },
          update: { position: pos },
          create: {
            playerId: p.id,
            circuitId,
            position: pos,
            points: 0,
            matchesPlayed: 0,
            matchesWon: 0,
            setsWon: 0,
            setsLost: 0,
            pointsFor: 0,
            pointsAgainst: 0,
          },
        });
        cargados++;
      }
    }
    res.json({ message: 'Ranking inicial cargado', total: cargados });
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

    // Borrar partidos existentes
    const phaseIds = circuit.phases.map(p => p.id);
    await prisma.setResult.deleteMany({ where: { match: { phaseId: { in: phaseIds } } } });
    await prisma.matchResult.deleteMany({ where: { match: { phaseId: { in: phaseIds } } } });
    await prisma.match.deleteMany({ where: { phaseId: { in: phaseIds } } });

    // Obtener ranking del circuito actual (primer circuito) o anterior
    const rankingEntries = await prisma.rankingEntry.findMany({
      where: { circuitId },
      include: { player: { include: { category: true } } },
      orderBy: { position: 'asc' }
    });

    // Si no hay ranking en este circuito, buscar el anterior
    let rankings = rankingEntries;
    if (rankings.length === 0) {
      const prevCircuit = await prisma.circuit.findFirst({
        where: { tournamentId: circuit.tournamentId, order: circuit.order - 1 }
      });
      if (prevCircuit) {
        rankings = await prisma.rankingEntry.findMany({
          where: { circuitId: prevCircuit.id },
          include: { player: { include: { category: true } } },
          orderBy: { position: 'asc' }
        });
      }
    }

    // Obtener todos los jugadores inscriptos
    const inscriptos = circuit.players.map(cp => cp.player);

    // Función para obtener posición en el ranking
    const getRankPos = (playerId: number): number => {
      const entry = rankings.find(r => r.playerId === playerId);
      return entry?.position ?? 9999;
    };

    // Ordenar inscriptos por posición en el ranking
    const inscriptosOrdenados = [...inscriptos].sort((a, b) => getRankPos(a.id) - getRankPos(b.id));

    // Clasificar por categoría (fija durante el año)
    const master  = inscriptosOrdenados.filter(p => p.category.name === 'master');
    const primera = inscriptosOrdenados.filter(p => p.category.name === 'primera');
    const segunda = inscriptosOrdenados.filter(p => p.category.name === 'segunda');
    const tercera = inscriptosOrdenados.filter(p => p.category.name === 'tercera');

    // Obtener fases por tipo
    const phaseClasif  = circuit.phases.find(p => p.type === 'clasificatorio');
    const phaseSegunda = circuit.phases.find(p => p.type === 'segunda');
    const fasePrimera  = circuit.phases.find(p => p.type === 'primera');
    const faseMaster   = circuit.phases.find(p => p.type === 'master');

    const matchesCreados: any[] = [];

    // -------------------------------------------------------
    // FASE CLASIFICATORIO — solo tercera, series de 4 (o 3)
    // doble eliminación a 5 partidos
    // -------------------------------------------------------
    if (phaseClasif && tercera.length > 0) {
      const series = armarSeries(tercera, 4);
      let roundBase = 1;
      for (const serie of series) {
        const partidos = generarDobleEliminacion5(serie, phaseClasif.id, roundBase);
        matchesCreados.push(...partidos);
        roundBase += 10;
      }
    }

    // -------------------------------------------------------
    // FASE SEGUNDA — 32 de segunda + 16 clasificados (espejo)
    // series de 4, doble eliminación a 5 partidos
    // Los 32 de segunda van primero (mejor ranked), los 16 clasificados al final
    // Espejo: 1° segunda vs 16° clasificado, etc.
    // -------------------------------------------------------
    if (phaseSegunda && segunda.length > 0) {
      // Los clasificados del clasificatorio serán los primeros 16 del ranking
      // de la fase clasificatoria — por ahora usamos placeholders con los de tercera
      // mejor rankeados como clasificados (los primeros 16 de tercera)
      const clasificadosClasif = tercera.slice(0, 16);
      const series = armarSeriesEspejo(segunda, clasificadosClasif, 4);
      let roundBase = 1;
      for (const serie of series) {
        const partidos = generarDobleEliminacion5(serie, phaseSegunda.id, roundBase);
        matchesCreados.push(...partidos);
        roundBase += 10;
      }
    }

    // -------------------------------------------------------
    // FASE PRIMERA — 24 de primera + 24 clasificados de segunda
    // eliminación directa espejo al mejor de 5
    // Los 24 de primera van primero, los 24 clasificados al final
    // -------------------------------------------------------
    if (fasePrimera && primera.length > 0) {
      const clasificadosSegunda = segunda.slice(0, 24);
      const todos = [...primera, ...clasificadosSegunda];
      const partidos = generarEliminacionEspejo(todos, fasePrimera.id, 1);
      matchesCreados.push(...partidos);
    }

    // -------------------------------------------------------
    // FASE MASTER — 8 master + clasificados de primera = 32
    // cuadro completo eliminación directa espejo al mejor de 5
    // 1° master vs 32°, 2° master vs 31°, etc.
    // -------------------------------------------------------
    if (faseMaster && master.length > 0) {
      const clasificadosPrimera = primera.slice(0, 24);
      const todos = [...master, ...clasificadosPrimera];
      // espejo: 1 vs N, 2 vs N-1
      const partidos = generarEliminacionEspejo(todos, faseMaster.id, 1);
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
      },
      jugadores: {
        master: master.length,
        primera: primera.length,
        segunda: segunda.length,
        tercera: tercera.length,
      }
    });

  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------
// HELPERS
// -------------------------------------------------------

// Divide jugadores en series de tamaño n (última puede ser n-1)
function armarSeries<T>(jugadores: T[], tam: number): T[][] {
  const series: T[][] = [];
  let i = 0;
  while (i < jugadores.length) {
    series.push(jugadores.slice(i, i + tam));
    i += tam;
  }
  return series;
}

// Arma series espejo: mejores de mejores con peores de clasificados
// mejores: ordenados por ranking (mejor primero)
// clasificados: ordenados por ranking (mejor primero), van al final
function armarSeriesEspejo<T extends { id: number }>(
  mejores: T[],
  clasificados: T[],
  tam: number
): T[][] {
  const todos = [...mejores, ...clasificados];
  const n = todos.length;
  const numSeries = Math.floor(n / tam);
  const series: T[][] = [];

  for (let i = 0; i < numSeries; i++) {
    // espejo: i-ésimo mejor con (n-1-i)-ésimo
    const mitad = Math.floor(numSeries / 2);
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

// Doble eliminación a 5 partidos exactos para serie de 3 o 4 jugadores
// Partido 1: A vs B
// Partido 2: C vs D
// Partido 3: ganador P1 vs ganador P2 → clasifica 1°
// Partido 4: perdedor P1 vs perdedor P2
// Partido 5: perdedor P3 vs ganador P4 → clasifica 2°
function generarDobleEliminacion5(
  jugadores: { id: number }[],
  phaseId: number,
  roundBase: number
): any[] {
  const partidos: any[] = [];

  if (jugadores.length === 4) {
    const [A, B, C, D] = jugadores;
    partidos.push(mkMatch(phaseId, A.id, B.id, roundBase));      // P1
    partidos.push(mkMatch(phaseId, C.id, D.id, roundBase + 1));  // P2
    partidos.push(mkMatch(phaseId, A.id, C.id, roundBase + 2));  // P3 ganadores (placeholders)
    partidos.push(mkMatch(phaseId, B.id, D.id, roundBase + 3));  // P4 perdedores
    partidos.push(mkMatch(phaseId, B.id, C.id, roundBase + 4));  // P5 repechaje
  } else if (jugadores.length === 3) {
    const [A, B, C] = jugadores;
    partidos.push(mkMatch(phaseId, A.id, B.id, roundBase));      // P1
    partidos.push(mkMatch(phaseId, A.id, C.id, roundBase + 1));  // P2 (C entra directo a segunda ronda)
    partidos.push(mkMatch(phaseId, B.id, C.id, roundBase + 2));  // P3 perdedor P1 vs C
    partidos.push(mkMatch(phaseId, A.id, B.id, roundBase + 3));  // P4 final
    partidos.push(mkMatch(phaseId, A.id, C.id, roundBase + 4));  // P5 repechaje
  }

  return partidos;
}

// Eliminación directa espejo: 1 vs N, 2 vs N-1, ...
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

export default router;
