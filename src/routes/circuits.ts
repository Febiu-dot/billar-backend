import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

const LIBRE_DNI = 'FEBIU000';

// -------------------------------------------------------
// HELPERS
// -------------------------------------------------------

async function getJugadoresOrdenadosPorRanking(circuit: any, circuitId: number) {
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
  const tercera = ordenados.filter((p: any) => p.category.name === 'tercera' && p.dni !== LIBRE_DNI);

  return { master, primera, segunda, tercera, getRankPos };
}

// Arma series en espejo para N jugadores + bye si es necesario
// Serie i (0-indexed): jugadores[i], jugadores[N-1-i], jugadores[N/2-1-i], jugadores[N/2+i]
function armarSeriesEspejo(jugadores: any[], libreId: number): any[][] {
  const N = jugadores.length;
  const numSeriesCompletas = Math.floor(N / 4);
  const resto = N % 4;
  const series: any[][] = [];

  // Si el total no es múltiplo de 4, necesitamos un bye
  // Total con bye = numSeriesCompletas * 4 + 4 = (numSeriesCompletas + 1) * 4
  // Por lo que agregamos el LIBRE para completar
  let jugadoresConBye = [...jugadores];
  if (resto !== 0) {
    // Agregar byes hasta completar múltiplo de 4
    const byesNecesarios = 4 - resto;
    for (let b = 0; b < byesNecesarios; b++) {
      jugadoresConBye.push({ id: libreId, firstName: 'LIBRE', lastName: '', dni: LIBRE_DNI });
    }
  }

  const total = jugadoresConBye.length;
  const numSeries = total / 4;
  const mitad = total / 2;

  for (let i = 0; i < numSeries; i++) {
    const serie = [
      jugadoresConBye[i],
      jugadoresConBye[total - 1 - i],
      jugadoresConBye[mitad - 1 - i],
      jugadoresConBye[mitad + i],
    ];
    series.push(serie);
  }

  return series;
}

function mkMatch(phaseId: number, playerAId: number | null, playerBId: number | null, round: number, slotA?: string, slotB?: string) {
  return {
    phaseId,
    playerAId,
    playerBId,
    slotA: slotA ?? null,
    slotB: slotB ?? null,
    round,
    status: 'pendiente'
  };
}

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
    if (!circuit) { res.status(404).json({ error: 'Circuito no encontrado' }); return; }
    res.json(circuit);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/circuits/:id/players
router.post('/:id/players', async (req: Request, res: Response) => {
  const circuitId = parseInt(req.params.id);
  const { playerId } = req.body;
  if (!playerId) { res.status(400).json({ error: 'playerId es requerido' }); return; }
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
      if (p.dni && p.dni.startsWith('FEBIU') && p.dni !== LIBRE_DNI) {
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

// GET /api/circuits/:id/preview
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

    const librePlayer = await prisma.player.findFirst({ where: { dni: LIBRE_DNI } });
    const libreId = librePlayer?.id ?? 0;

    const { master, primera, segunda, tercera } = await getJugadoresOrdenadosPorRanking(circuit, circuitId);
    const pn = (p: any) => `${p.lastName}${p.lastName ? ', ' : ''}${p.firstName}`;

    const series = armarSeriesEspejo(tercera, libreId);

    const seriesPreview = series.map((serie, i) => ({
      serie: i + 1,
      jugadores: serie.map((p: any) => ({
        id: p.id,
        nombre: p.dni === LIBRE_DNI ? 'LIBRE' : pn(p),
        esLibre: p.dni === LIBRE_DNI
      }))
    }));

    // Preview cruces de reducción (34 → 16)
    const numSeries = series.length; // 17
    const primerosSlots = Array.from({ length: numSeries }, (_, i) => `1° Serie ${i + 1}`);
    const segundosSlots = Array.from({ length: numSeries }, (_, i) => `2° Serie ${i + 1}`);
    // Mejor primero vs peor segundo
    const crucesReduccion = Array.from({ length: numSeries }, (_, i) => ({
      cruce: i + 1,
      slotA: primerosSlots[i],
      slotB: segundosSlots[numSeries - 1 - i]
    }));

    res.json({
      inscriptos: { master: master.length, primera: primera.length, segunda: segunda.length, tercera: tercera.length },
      clasificatorio: {
        totalJugadores: tercera.length,
        totalSeries: series.length,
        series: seriesPreview,
        crucesReduccion
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/circuits/:id/generate
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

    const librePlayer = await prisma.player.findFirst({ where: { dni: LIBRE_DNI } });
    const libreId = librePlayer?.id ?? 0;

    const { master, primera, segunda, tercera } = await getJugadoresOrdenadosPorRanking(circuit, circuitId);

    const phaseClasif  = circuit.phases.find(p => p.type === 'clasificatorio');
    const phaseSegunda = circuit.phases.find(p => p.type === 'segunda');
    const fasePrimera  = circuit.phases.find(p => p.type === 'primera');
    const faseMaster   = circuit.phases.find(p => p.type === 'master');

    const matchesCreados: any[] = [];
    const matchesWO: any[] = []; // partidos contra LIBRE que se resuelven automáticamente

    // -------------------------------------------------------
    // FASE CLASIFICATORIO
    // -------------------------------------------------------
    if (phaseClasif) {
      const series = armarSeriesEspejo(tercera, libreId);
      const numSeries = series.length;

      for (let i = 0; i < numSeries; i++) {
        const serie = series[i];
        const [A, B, C, D] = serie;
        const roundBase = i * 10 + 1;
        const serieId = `clasif-serie-${i + 1}`;

        // P1: A vs B (espejo: mejor vs peor)
        const p1 = {
          ...mkMatch(phaseClasif.id, A.id, B.id, roundBase),
          serieId
        };

        // P2: C vs D (mitad superior vs mitad inferior)
        const p2 = {
          ...mkMatch(phaseClasif.id, C.id, D.id, roundBase + 1),
          serieId
        };

        matchesCreados.push(p1, p2);

        // Si alguno es LIBRE, marcar para WO automático
        if (A.dni === LIBRE_DNI || B.dni === LIBRE_DNI) {
          matchesWO.push({ index: matchesCreados.length - 2, libreEsA: A.dni === LIBRE_DNI });
        }
        if (C.dni === LIBRE_DNI || D.dni === LIBRE_DNI) {
          matchesWO.push({ index: matchesCreados.length - 1, libreEsA: C.dni === LIBRE_DNI });
        }
      }

      // Cruces de reducción 34→16 con slots
      // Se generan con slots porque los jugadores no se conocen aún
      for (let i = 0; i < numSeries; i++) {
        const roundCruce = numSeries * 10 + i + 1;
        matchesCreados.push({
          ...mkMatch(
            phaseClasif.id,
            null,
            null,
            roundCruce,
            `1° Serie ${i + 1}`,
            `2° Serie ${numSeries - i}`
          ),
          serieId: `clasif-reduccion-${i + 1}`
        });
      }

      // Repechaje entre ganadores 16 y 17 (si hay más de 16 cruces)
      if (numSeries > 16) {
        matchesCreados.push({
          ...mkMatch(
            phaseClasif.id,
            null,
            null,
            numSeries * 10 + numSeries + 1,
            `Ganador Cruce ${numSeries - 1}`,
            `Ganador Cruce ${numSeries}`
          ),
          serieId: 'clasif-repechaje'
        });
      }
    }

    // -------------------------------------------------------
    // FASE SEGUNDA — slots para clasificados del clasificatorio
    // -------------------------------------------------------
    if (phaseSegunda && segunda.length > 0) {
      // 32 de segunda + 16 clasificados del clasificatorio
      // Espejo: mejor de segunda vs clasificado peor rankeado
      const numSegunda = segunda.length; // hasta 32
      const numClasif = 16;
      const total = numSegunda + numClasif;
      const numSeries = Math.floor(total / 4);

      for (let i = 0; i < numSeries; i++) {
        const roundBase = i * 10 + 1;
        const serieId = `segunda-serie-${i + 1}`;
        const mitad = numSeries * 2;

        // Armar serie: posiciones del espejo
        // jugadores[i], jugadores[total-1-i], jugadores[mitad-1-i], jugadores[mitad+i]
        const getJugador = (pos: number) => {
          if (pos < numSegunda) {
            return { id: segunda[pos].id, slot: null };
          } else {
            const clasificadoPos = pos - numSegunda + 1;
            return { id: null, slot: `Clasificado Clasif. #${clasificadoPos}` };
          }
        };

        const posiciones = [i, total - 1 - i, mitad - 1 - i, mitad + i];
        const jugSerie = posiciones.map(pos => getJugador(pos));

        // P1 y P2
        const p1 = jugSerie[0];
        const p2j = jugSerie[1];
        const p3j = jugSerie[2];
        const p4j = jugSerie[3];

        matchesCreados.push({
          ...mkMatch(phaseSegunda.id, p1.id, p2j.id, roundBase, p1.slot ?? undefined, p2j.slot ?? undefined),
          serieId
        });
        matchesCreados.push({
          ...mkMatch(phaseSegunda.id, p3j.id, p4j.id, roundBase + 1, p3j.slot ?? undefined, p4j.slot ?? undefined),
          serieId
        });
      }
    }

    // -------------------------------------------------------
    // FASE PRIMERA — slots para clasificados de segunda
    // -------------------------------------------------------
    if (fasePrimera && primera.length > 0) {
      const numPrimera = primera.length; // hasta 24
      const numClasif = 24;
      const total = numPrimera + numClasif;

      for (let i = 0; i < Math.floor(total / 2); i++) {
        const jA = i < numPrimera
          ? { id: primera[i].id, slot: null }
          : { id: null, slot: `Clasificado Segunda #${i - numPrimera + 1}` };
        const jB_pos = total - 1 - i;
        const jB = jB_pos < numPrimera
          ? { id: primera[jB_pos].id, slot: null }
          : { id: null, slot: `Clasificado Segunda #${jB_pos - numPrimera + 1}` };

        matchesCreados.push({
          ...mkMatch(fasePrimera.id, jA.id, jB.id, i + 1, jA.slot ?? undefined, jB.slot ?? undefined),
          serieId: `primera-cruce-${i + 1}`
        });
      }
    }

    // -------------------------------------------------------
    // FASE MASTER — cuadro de 32 con slots
    // -------------------------------------------------------
    if (faseMaster && master.length > 0) {
      const numMaster = master.length; // 8
      const numClasif = 24;
      const total = numMaster + numClasif;

      for (let i = 0; i < Math.floor(total / 2); i++) {
        const jA = i < numMaster
          ? { id: master[i].id, slot: null }
          : { id: null, slot: `Clasificado Primera #${i - numMaster + 1}` };
        const jB_pos = total - 1 - i;
        const jB = jB_pos < numMaster
          ? { id: master[jB_pos].id, slot: null }
          : { id: null, slot: `Clasificado Primera #${jB_pos - numMaster + 1}` };

        matchesCreados.push({
          ...mkMatch(faseMaster.id, jA.id, jB.id, i + 1, jA.slot ?? undefined, jB.slot ?? undefined),
          serieId: `master-cruce-${i + 1}`
        });
      }

      // Rondas siguientes del cuadro master (slots vacíos)
      let jugadoresRonda = Math.floor(total / 2);
      let ronda = 2;
      while (jugadoresRonda > 1) {
        const ganadores = Math.floor(jugadoresRonda / 2);
        for (let i = 0; i < ganadores; i++) {
          matchesCreados.push({
            ...mkMatch(faseMaster.id, null, null, ronda * 100 + i + 1,
              `Ganador R${ronda - 1} Cruce ${i * 2 + 1}`,
              `Ganador R${ronda - 1} Cruce ${i * 2 + 2}`
            ),
            serieId: `master-r${ronda}-cruce-${i + 1}`
          });
        }
        jugadoresRonda = ganadores;
        ronda++;
      }
    }

    // Insertar todos los partidos
    if (matchesCreados.length > 0) {
      await prisma.match.createMany({ data: matchesCreados });
    }

    // Resolver WOs automáticos (partidos contra LIBRE)
    if (matchesWO.length > 0 && phaseClasif) {
      const partidos = await prisma.match.findMany({
        where: { phaseId: phaseClasif.id },
        orderBy: { id: 'asc' }
      });

      for (const wo of matchesWO) {
        // Buscar el partido con LIBRE
        const partidoConLibre = partidos.find(p =>
          p.playerAId === libreId || p.playerBId === libreId
        );
        if (!partidoConLibre) continue;

        const winnerId = partidoConLibre.playerAId === libreId
          ? partidoConLibre.playerBId
          : partidoConLibre.playerAId;

        if (!winnerId) continue;

        const isA = partidoConLibre.playerAId === libreId;
        await prisma.match.update({
          where: { id: partidoConLibre.id },
          data: { status: 'wo', finishedAt: new Date() }
        });
        await prisma.matchResult.create({
          data: {
            matchId: partidoConLibre.id,
            setsA: isA ? 0 : 3,
            setsB: isA ? 3 : 0,
            pointsA: isA ? 0 : 180,
            pointsB: isA ? 180 : 0,
            winnerId,
            isWO: true,
            woPlayerId: libreId
          }
        });
      }
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
