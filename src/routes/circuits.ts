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
    // 1. Cargar circuito con jugadores inscriptos y fases
    const circuit = await prisma.circuit.findUnique({
      where: { id: circuitId },
      include: {
        phases: { orderBy: { order: 'asc' } },
        players: {
          include: {
            player: {
              include: { category: true }
            }
          }
        },
        // ranking del circuito anterior para ordenar jugadores
        tournament: {
          include: {
            circuits: {
              where: { order: { lt: 0 } }, // placeholder, se reemplaza abajo
              include: {
                rankings: {
                  include: { player: true },
                  orderBy: { position: 'asc' }
                }
              }
            }
          }
        }
      }
    });

    if (!circuit) {
      res.status(404).json({ error: 'Circuito no encontrado' });
      return;
    }

    // 2. Cargar ranking del circuito anterior (order = circuit.order - 1)
    const prevCircuit = await prisma.circuit.findFirst({
      where: {
        tournamentId: circuit.tournamentId,
        order: circuit.order - 1
      },
      include: {
        rankings: {
          include: { player: { include: { category: true } } },
          orderBy: { position: 'asc' }
        }
      }
    });

    // 3. Separar jugadores inscriptos por categoría
    const inscriptos = circuit.players.map(cp => cp.player);

    const getRankPosition = (playerId: number): number => {
      if (!prevCircuit) return 9999;
      const entry = prevCircuit.rankings.find(r => r.playerId === playerId);
      return entry?.position ?? 9999;
    };

    const sortByRank = (players: typeof inscriptos) =>
      [...players].sort((a, b) => getRankPosition(a.id) - getRankPosition(b.id));

    const master   = sortByRank(inscriptos.filter(p => p.category.name === 'master'));
    const primera  = sortByRank(inscriptos.filter(p => p.category.name === 'primera'));
    const segunda  = sortByRank(inscriptos.filter(p => p.category.name === 'segunda'));
    const tercera  = sortByRank(inscriptos.filter(p => p.category.name === 'tercera'));

    // 4. Obtener fases por tipo
    const getPhase = (tipo: string) => circuit.phases.find(p => p.type === tipo);
    const phaseClasif  = getPhase('clasificatorio');
    const phaseSegunda = getPhase('segunda');
    const fasePrimera  = getPhase('primera');
    const faseMaster   = getPhase('master');

    const matchesCreados: any[] = [];

    // -------------------------------------------------------
    // FASE CLASIFICATORIO
    // -------------------------------------------------------
    if (phaseClasif) {
      // Solo Tercera (y Segunda que cayó en zona clasif — por ahora solo Tercera)
      const jugadoresClasif = tercera;

      // Armar series de 4 (o 3 si no da exacto)
      const series = armarSeries(jugadoresClasif, 4);

      let round = 1;
      for (const serie of series) {
        const partidos = generarDobleEliminacion(serie, phaseClasif.id, round);
        matchesCreados.push(...partidos);
        round += 10; // separar rondas por serie
      }
    }

    // -------------------------------------------------------
    // FASE SEGUNDA
    // -------------------------------------------------------
    if (phaseSegunda) {
      // Los 32 de Segunda van primero ordenados por ranking
      // Los 16 clasificados van al final (posiciones 33-48)
      // Como aún no se jugó el clasificatorio, creamos los partidos de Segunda
      // con los jugadores de Segunda actuales y dejamos los slots del clasificatorio
      // como placeholders — por ahora generamos solo con los de Segunda
      const jugadoresSegunda = segunda;

      // Armar series de 4 con sistema espejo
      const series = armarSeriesEspejo(jugadoresSegunda, [], 4);

      let round = 1;
      for (const serie of series) {
        const partidos = generarDobleEliminacion(serie, phaseSegunda.id, round);
        matchesCreados.push(...partidos);
        round += 10;
      }
    }

    // -------------------------------------------------------
    // FASE PRIMERA — eliminación directa espejo
    // -------------------------------------------------------
    if (fasePrimera) {
      // 24 de Primera + 24 clasificados de Segunda (placeholders)
      // Por ahora generamos con los de Primera
      const jugadoresPrimera = primera;
      const partidos = generarEliminacionDirectaEspejo(jugadoresPrimera, fasePrimera.id, 1);
      matchesCreados.push(...partidos);
    }

    // -------------------------------------------------------
    // FASE MASTER — eliminación directa espejo
    // -------------------------------------------------------
    if (faseMaster) {
      const jugadoresMaster = master;
      const partidos = generarEliminacionDirectaEspejo(jugadoresMaster, faseMaster.id, 1);
      matchesCreados.push(...partidos);
    }

    // 5. Insertar todos los partidos en la base de datos
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

// Divide jugadores en series de tamaño n (última puede ser de n-1)
function armarSeries<T>(jugadores: T[], tam: number): T[][] {
  const series: T[][] = [];
  let i = 0;
  while (i < jugadores.length) {
    series.push(jugadores.slice(i, i + tam));
    i += tam;
  }
  return series;
}

// Arma series espejo: mejores de A con peores de B
function armarSeriesEspejo<T extends { id: number }>(
  mejores: T[],
  clasificados: T[],
  tam: number
): T[][] {
  // Combinar: mejores al frente, clasificados al final
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

// Genera partidos de doble eliminación para una serie de 3 o 4 jugadores
// Estructura:
//   R1: A vs B, C vs D (winners bracket)
//   R2: ganW1 vs ganW2 (final winners), perW1 vs perW2 (final losers)
//   R3: perdedor final winners vs ganador final losers (partido extra doble elim)
function generarDobleEliminacion(
  jugadores: { id: number }[],
  phaseId: number,
  roundBase: number
): any[] {
  const partidos: any[] = [];

  if (jugadores.length === 4) {
    const [A, B, C, D] = jugadores;
    // Ronda 1 winners
    partidos.push(mkMatch(phaseId, A.id, B.id, roundBase));
    partidos.push(mkMatch(phaseId, C.id, D.id, roundBase));
    // Ronda 2: final winners y final losers
    partidos.push(mkMatch(phaseId, A.id, C.id, roundBase + 1)); // placeholder ganadores
    partidos.push(mkMatch(phaseId, B.id, D.id, roundBase + 2)); // placeholder perdedores
    // Ronda 3: partido extra doble eliminación
    partidos.push(mkMatch(phaseId, A.id, B.id, roundBase + 3)); // placeholder
  } else if (jugadores.length === 3) {
    const [A, B, C] = jugadores;
    partidos.push(mkMatch(phaseId, A.id, B.id, roundBase));
    partidos.push(mkMatch(phaseId, A.id, C.id, roundBase + 1));
    partidos.push(mkMatch(phaseId, B.id, C.id, roundBase + 2));
  }

  return partidos;
}

// Genera eliminación directa espejo: 1 vs N, 2 vs N-1, ...
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
