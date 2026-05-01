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
// POST /api/circuits/:id/seed-ranking — cargar ranking inicial
router.post('/:id/seed-ranking', async (req: Request, res: Response) => {
  const circuitId = parseInt(req.params.id);

  const RANKING_INICIAL = [
    { pos: 1,   dni: 'FEBIU001' }, { pos: 2,   dni: 'FEBIU002' }, { pos: 3,   dni: 'FEBIU003' },
    { pos: 4,   dni: 'FEBIU004' }, { pos: 5,   dni: 'FEBIU005' }, { pos: 6,   dni: 'FEBIU006' },
    { pos: 7,   dni: 'FEBIU007' }, { pos: 8,   dni: 'FEBIU008' }, { pos: 9,   dni: 'FEBIU009' },
    { pos: 10,  dni: 'FEBIU010' }, { pos: 11,  dni: 'FEBIU011' }, { pos: 12,  dni: 'FEBIU012' },
    { pos: 13,  dni: 'FEBIU013' }, { pos: 14,  dni: 'FEBIU014' }, { pos: 15,  dni: 'FEBIU015' },
    { pos: 16,  dni: 'FEBIU016' }, { pos: 17,  dni: 'FEBIU017' }, { pos: 18,  dni: 'FEBIU018' },
    { pos: 19,  dni: 'FEBIU019' }, { pos: 20,  dni: 'FEBIU020' }, { pos: 21,  dni: 'FEBIU021' },
    { pos: 22,  dni: 'FEBIU022' }, { pos: 23,  dni: 'FEBIU023' }, { pos: 24,  dni: 'FEBIU024' },
    { pos: 25,  dni: 'FEBIU025' }, { pos: 26,  dni: 'FEBIU026' }, { pos: 27,  dni: 'FEBIU027' },
    { pos: 28,  dni: 'FEBIU028' }, { pos: 29,  dni: 'FEBIU029' }, { pos: 30,  dni: 'FEBIU030' },
    { pos: 31,  dni: 'FEBIU031' }, { pos: 32,  dni: 'FEBIU032' }, { pos: 33,  dni: 'FEBIU033' },
    { pos: 34,  dni: 'FEBIU034' }, { pos: 35,  dni: 'FEBIU035' }, { pos: 36,  dni: 'FEBIU036' },
    { pos: 37,  dni: 'FEBIU037' }, { pos: 38,  dni: 'FEBIU038' }, { pos: 39,  dni: 'FEBIU039' },
    { pos: 40,  dni: 'FEBIU040' }, { pos: 41,  dni: 'FEBIU041' }, { pos: 42,  dni: 'FEBIU042' },
    { pos: 43,  dni: 'FEBIU043' }, { pos: 44,  dni: 'FEBIU044' }, { pos: 45,  dni: 'FEBIU045' },
    { pos: 46,  dni: 'FEBIU046' }, { pos: 47,  dni: 'FEBIU047' }, { pos: 48,  dni: 'FEBIU048' },
    { pos: 49,  dni: 'FEBIU049' }, { pos: 50,  dni: 'FEBIU050' }, { pos: 51,  dni: 'FEBIU051' },
    { pos: 52,  dni: 'FEBIU052' }, { pos: 53,  dni: 'FEBIU053' }, { pos: 54,  dni: 'FEBIU054' },
    { pos: 55,  dni: 'FEBIU055' }, { pos: 56,  dni: 'FEBIU056' }, { pos: 57,  dni: 'FEBIU057' },
    { pos: 58,  dni: 'FEBIU058' }, { pos: 59,  dni: 'FEBIU059' }, { pos: 60,  dni: 'FEBIU060' },
    { pos: 61,  dni: 'FEBIU061' }, { pos: 62,  dni: 'FEBIU062' }, { pos: 63,  dni: 'FEBIU063' },
    { pos: 64,  dni: 'FEBIU064' }, { pos: 65,  dni: 'FEBIU065' }, { pos: 66,  dni: 'FEBIU066' },
    { pos: 67,  dni: 'FEBIU067' }, { pos: 68,  dni: 'FEBIU068' }, { pos: 69,  dni: 'FEBIU069' },
    { pos: 70,  dni: 'FEBIU070' }, { pos: 71,  dni: 'FEBIU071' }, { pos: 72,  dni: 'FEBIU072' },
    { pos: 73,  dni: 'FEBIU073' }, { pos: 74,  dni: 'FEBIU074' }, { pos: 75,  dni: 'FEBIU075' },
    { pos: 76,  dni: 'FEBIU076' }, { pos: 77,  dni: 'FEBIU077' }, { pos: 78,  dni: 'FEBIU078' },
    { pos: 79,  dni: 'FEBIU079' }, { pos: 80,  dni: 'FEBIU080' }, { pos: 81,  dni: 'FEBIU081' },
    { pos: 82,  dni: 'FEBIU082' }, { pos: 83,  dni: 'FEBIU083' }, { pos: 84,  dni: 'FEBIU084' },
    { pos: 85,  dni: 'FEBIU085' }, { pos: 86,  dni: 'FEBIU086' }, { pos: 87,  dni: 'FEBIU087' },
    { pos: 88,  dni: 'FEBIU088' }, { pos: 89,  dni: 'FEBIU089' }, { pos: 90,  dni: 'FEBIU090' },
    { pos: 91,  dni: 'FEBIU091' }, { pos: 92,  dni: 'FEBIU092' }, { pos: 93,  dni: 'FEBIU093' },
    { pos: 94,  dni: 'FEBIU094' }, { pos: 95,  dni: 'FEBIU095' }, { pos: 96,  dni: 'FEBIU096' },
    { pos: 97,  dni: 'FEBIU097' }, { pos: 98,  dni: 'FEBIU098' }, { pos: 99,  dni: 'FEBIU099' },
    { pos: 100, dni: 'FEBIU100' }, { pos: 101, dni: 'FEBIU101' }, { pos: 102, dni: 'FEBIU102' },
    { pos: 103, dni: 'FEBIU103' }, { pos: 104, dni: 'FEBIU104' }, { pos: 105, dni: 'FEBIU105' },
    { pos: 106, dni: 'FEBIU106' }, { pos: 107, dni: 'FEBIU107' }, { pos: 108, dni: 'FEBIU108' },
    { pos: 109, dni: 'FEBIU109' }, { pos: 110, dni: 'FEBIU110' }, { pos: 111, dni: 'FEBIU111' },
    { pos: 112, dni: 'FEBIU112' }, { pos: 113, dni: 'FEBIU113' }, { pos: 114, dni: 'FEBIU114' },
    { pos: 115, dni: 'FEBIU115' }, { pos: 116, dni: 'FEBIU116' }, { pos: 117, dni: 'FEBIU117' },
    { pos: 118, dni: 'FEBIU118' }, { pos: 119, dni: 'FEBIU119' }, { pos: 120, dni: 'FEBIU120' },
    { pos: 121, dni: 'FEBIU121' }, { pos: 122, dni: 'FEBIU122' }, { pos: 123, dni: 'FEBIU123' },
    { pos: 124, dni: 'FEBIU124' }, { pos: 125, dni: 'FEBIU125' }, { pos: 126, dni: 'FEBIU126' },
    { pos: 127, dni: 'FEBIU127' }, { pos: 128, dni: 'FEBIU128' }, { pos: 129, dni: 'FEBIU129' },
    { pos: 130, dni: 'FEBIU130' }, { pos: 131, dni: 'FEBIU131' },
  ];

  try {
    const circuit = await prisma.circuit.findUnique({ where: { id: circuitId } });
    if (!circuit) {
      res.status(404).json({ error: 'Circuito no encontrado' });
      return;
    }

    let cargados = 0;
    for (const r of RANKING_INICIAL) {
      const player = await prisma.player.findFirst({ where: { dni: r.dni } });
      if (player) {
        await prisma.rankingEntry.upsert({
          where: { playerId_circuitId: { playerId: player.id, circuitId } },
          update: { position: r.pos },
          create: {
            playerId: player.id,
            circuitId,
            position: r.pos,
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
export default router;
