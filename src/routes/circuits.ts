import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

const LIBRE_DNI = 'FEBIU000';
const RULESET_SERIES = 1;  // al mejor de 3
const RULESET_CRUCES = 2;  // al mejor de 5

const CORTE_MASTER   = 8;
const CORTE_PRIMERA  = 32;
const CORTE_SEGUNDA  = 64;

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

  const inscriptos = circuit.players
    .map((cp: any) => cp.player)
    .filter((p: any) => p.dni !== LIBRE_DNI);

  const ordenados = [...inscriptos].sort((a: any, b: any) => getRankPos(a.id) - getRankPos(b.id));

  const master   = ordenados.filter((p: any) => getRankPos(p.id) <= CORTE_MASTER);
  const primera  = ordenados.filter((p: any) => getRankPos(p.id) > CORTE_MASTER && getRankPos(p.id) <= CORTE_PRIMERA);
  const segunda  = ordenados.filter((p: any) => getRankPos(p.id) > CORTE_PRIMERA && getRankPos(p.id) <= CORTE_SEGUNDA);
  const clasif   = ordenados.filter((p: any) => getRankPos(p.id) > CORTE_SEGUNDA);

  return { master, primera, segunda, clasif, getRankPos, rankings };
}

function completarConLibre(jugadores: any[], librePlayer: any): any[] {
  const resto = jugadores.length % 4;
  if (resto === 0) return jugadores;
  const result = [...jugadores];
  for (let i = 0; i < 4 - resto; i++) result.push(librePlayer);
  return result;
}

function armarSeriesEspejo(jugadores: any[]): any[][] {
  const N = jugadores.length;
  const numSeries = N / 4;
  const mitad = N / 2;
  const series: any[][] = [];
  for (let i = 0; i < numSeries; i++) {
    series.push([
      jugadores[i],
      jugadores[N - 1 - i],
      jugadores[mitad - 1 - i],
      jugadores[mitad + i],
    ]);
  }
  return series;
}

function mkMatch(phaseId: number, playerAId: number | null, playerBId: number | null, round: number, slotA?: string, slotB?: string, serieId?: string, ruleSetId?: number) {
  return {
    phaseId, playerAId, playerBId,
    slotA: slotA ?? null, slotB: slotB ?? null,
    round, status: 'pendiente',
    serieId: serieId ?? null,
    ruleSetId: ruleSetId ?? null
  };
}

// GET /api/circuits
router.get('/', async (_req: Request, res: Response) => {
  try {
    const circuits = await prisma.circuit.findMany({
      include: {
        tournament: true,
        phases: { orderBy: { order: 'asc' } },
        players: { include: { player: { include: { category: true } } } }
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
        players: { include: { player: { include: { category: true } } } }
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
    const { master, primera, segunda, clasif } = await getJugadoresOrdenados(circuit, circuitId);

    const jugConLibre = completarConLibre(clasif, librePlayer ?? { id: 0, dni: LIBRE_DNI, firstName: 'LIBRE', lastName: '' });
    const numSeries = jugConLibre.length / 4;

    const pn = (p: any) => p.dni === LIBRE_DNI ? 'LIBRE' : `${p.lastName}${p.lastName ? ', ' : ''}${p.firstName}`;

    const series = armarSeriesEspejo(jugConLibre).map((serie, i) => ({
      serie: i + 1,
      jugadores: serie.map((p: any) => ({
        id: p.id,
        nombre: pn(p),
        esLibre: p.dni === LIBRE_DNI
      }))
    }));

    const numClasificados = numSeries * 2;
    const crucesReduccion: any[] = [];
    if (numClasificados > 16) {
      for (let i = 0; i < numSeries; i++) {
        crucesReduccion.push({
          cruce: i + 1,
          slotA: `1° Serie ${i + 1}`,
          slotB: `2° Serie ${numSeries - i}`
        });
      }
      if (numSeries > 16) {
        crucesReduccion.push({
          cruce: numSeries + 1,
          slotA: `Ganador Cruce ${numSeries - 1}`,
          slotB: `Ganador Cruce ${numSeries}`
        });
      }
    }

    res.json({
      inscriptos: {
        total: master.length + primera.length + segunda.length + clasif.length,
        master: master.length,
        primera: primera.length,
        segunda: segunda.length,
        clasificatorio: clasif.length
      },
      clasificatorio: {
        totalJugadores: jugConLibre.length,
        totalSeries: numSeries,
        series,
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

    const phaseIds = circuit.phases.map(p => p.id);
    await prisma.setResult.deleteMany({ where: { match: { phaseId: { in: phaseIds } } } });
    await prisma.matchResult.deleteMany({ where: { match: { phaseId: { in: phaseIds } } } });
    await prisma.match.deleteMany({ where: { phaseId: { in: phaseIds } } });

    const librePlayer = await prisma.player.findFirst({ where: { dni: LIBRE_DNI } });
    const libreId = librePlayer?.id ?? 0;
    const libreObj = librePlayer ?? { id: libreId, dni: LIBRE_DNI, firstName: 'LIBRE', lastName: '' };

    const { master, primera, segunda, clasif } = await getJugadoresOrdenados(circuit, circuitId);

    const phaseClasif  = circuit.phases.find(p => p.type === 'clasificatorio');
    const phaseSegunda = circuit.phases.find(p => p.type === 'segunda');
    const fasePrimera  = circuit.phases.find(p => p.type === 'primera');
    const faseMaster   = circuit.phases.find(p => p.type === 'master');

    const matchesCreados: any[] = [];

    // -------------------------------------------------------
    // FASE CLASIFICATORIO — series al mejor de 3
    // -------------------------------------------------------
    if (phaseClasif && clasif.length > 0) {
      const jugConLibre = completarConLibre(clasif, libreObj);
      const series = armarSeriesEspejo(jugConLibre);
      const numSeries = series.length;

      for (let i = 0; i < numSeries; i++) {
        const [A, B, C, D] = series[i];
        const roundBase = i * 10 + 1;
        const serieId = `clasif-serie-${i + 1}`;
        matchesCreados.push(mkMatch(phaseClasif.id, A.id, B.id, roundBase, undefined, undefined, serieId, RULESET_SERIES));
        matchesCreados.push(mkMatch(phaseClasif.id, C.id, D.id, roundBase + 1, undefined, undefined, serieId, RULESET_SERIES));
      }

      // Cruces de reducción — al mejor de 3
      const numClasificados = numSeries * 2;
      if (numClasificados > 16) {
        for (let i = 0; i < numSeries; i++) {
          matchesCreados.push(mkMatch(
            phaseClasif.id, null, null,
            numSeries * 10 + i + 1,
            `1° Serie ${i + 1}`,
            `2° Serie ${numSeries - i}`,
            `clasif-reduccion-${i + 1}`,
            RULESET_SERIES
          ));
        }
        if (numSeries > 16) {
          matchesCreados.push(mkMatch(
            phaseClasif.id, null, null,
            numSeries * 10 + numSeries + 1,
            `Ganador Cruce ${numSeries - 1}`,
            `Ganador Cruce ${numSeries}`,
            'clasif-repechaje',
            RULESET_SERIES
          ));
        }
      }
    }

    // -------------------------------------------------------
    // FASE SEGUNDA — series al mejor de 3
    // -------------------------------------------------------
    if (phaseSegunda && segunda.length > 0) {
      const slots16 = Array.from({ length: 16 }, (_, i) => ({ id: null, slot: `Clasificado Clasif. #${i + 1}` }));
      let jugConSlots = [...segunda, ...slots16] as any[];
      while (jugConSlots.length % 4 !== 0) jugConSlots.push({ id: null, slot: 'LIBRE' });

      const N2 = jugConSlots.length;
      const mitad = N2 / 2;
      const numSeries = N2 / 4;

      for (let i = 0; i < numSeries; i++) {
        const roundBase = i * 10 + 1;
        const serieId = `segunda-serie-${i + 1}`;
        const posiciones = [i, N2 - 1 - i, mitad - 1 - i, mitad + i];
        const [j0, j1, j2, j3] = posiciones.map(pos => jugConSlots[pos]);

        matchesCreados.push(mkMatch(phaseSegunda.id, j0.id ?? null, j1.id ?? null, roundBase, j0.slot ?? undefined, j1.slot ?? undefined, serieId, RULESET_SERIES));
        matchesCreados.push(mkMatch(phaseSegunda.id, j2.id ?? null, j3.id ?? null, roundBase + 1, j2.slot ?? undefined, j3.slot ?? undefined, serieId, RULESET_SERIES));
      }
    }

    // -------------------------------------------------------
    // FASE PRIMERA — cruces al mejor de 5
    // -------------------------------------------------------
    if (fasePrimera && primera.length > 0) {
      const slots24 = Array.from({ length: 24 }, (_, i) => ({ id: null, slot: `Clasificado Segunda #${i + 1}` }));
      const jugConSlots = [...primera, ...slots24] as any[];
      const total = jugConSlots.length;

      for (let i = 0; i < Math.floor(total / 2); i++) {
        const jA = jugConSlots[i];
        const jB = jugConSlots[total - 1 - i];
        matchesCreados.push(mkMatch(
          fasePrimera.id, jA.id ?? null, jB.id ?? null,
          i + 1,
          jA.slot ?? undefined, jB.slot ?? undefined,
          `primera-cruce-${i + 1}`,
          RULESET_CRUCES
        ));
      }
    }

    // -------------------------------------------------------
    // FASE MASTER — cruces al mejor de 5
    // -------------------------------------------------------
    if (faseMaster && master.length > 0) {
      const slots24 = Array.from({ length: 24 }, (_, i) => ({ id: null, slot: `Clasificado Primera #${i + 1}` }));
      const jugConSlots = [...master, ...slots24] as any[];
      const total = jugConSlots.length;

      for (let i = 0; i < Math.floor(total / 2); i++) {
        const jA = jugConSlots[i];
        const jB = jugConSlots[total - 1 - i];
        matchesCreados.push(mkMatch(
          faseMaster.id, jA.id ?? null, jB.id ?? null,
          i + 1,
          jA.slot ?? undefined, jB.slot ?? undefined,
          `master-r1-cruce-${i + 1}`,
          RULESET_CRUCES
        ));
      }

      let jugadoresRonda = Math.floor(total / 2);
      let ronda = 2;
      while (jugadoresRonda > 1) {
        const ganadores = Math.floor(jugadoresRonda / 2);
        for (let i = 0; i < ganadores; i++) {
          matchesCreados.push(mkMatch(
            faseMaster.id, null, null,
            ronda * 100 + i + 1,
            `Ganador R${ronda - 1} Cruce ${i * 2 + 1}`,
            `Ganador R${ronda - 1} Cruce ${i * 2 + 2}`,
            `master-r${ronda}-cruce-${i + 1}`,
            RULESET_CRUCES
          ));
        }
        jugadoresRonda = ganadores;
        ronda++;
      }
    }

    if (matchesCreados.length > 0) {
      await prisma.match.createMany({ data: matchesCreados });
    }

    // WOs automáticos contra LIBRE
    if (phaseClasif) {
      const partidos = await prisma.match.findMany({
        where: { phaseId: phaseClasif.id, OR: [{ playerAId: libreId }, { playerBId: libreId }] }
      });
      for (const partido of partidos) {
        const winnerId = partido.playerAId === libreId ? partido.playerBId : partido.playerAId;
        if (!winnerId) continue;
        const isA = partido.playerAId === libreId;
        await prisma.match.update({ where: { id: partido.id }, data: { status: 'wo', finishedAt: new Date() } });
        await prisma.matchResult.create({
          data: {
            matchId: partido.id,
            setsA: isA ? 0 : 2, setsB: isA ? 2 : 0,
            pointsA: isA ? 0 : 120, pointsB: isA ? 120 : 0,
            winnerId, isWO: true, woPlayerId: libreId
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
      jugadores: { master: master.length, primera: primera.length, segunda: segunda.length, clasificatorio: clasif.length }
    });

  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
