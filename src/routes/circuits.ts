import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

const LIBRE_DNI = 'FEBIU000';

// -------------------------------------------------------
// HELPER: obtener jugadores inscriptos ordenados por ranking
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

  const inscriptos = circuit.players
    .map((cp: any) => cp.player)
    .filter((p: any) => p.dni !== LIBRE_DNI);

  const ordenados = [...inscriptos].sort((a: any, b: any) => getRankPos(a.id) - getRankPos(b.id));

  return { ordenados, getRankPos, rankings };
}

// -------------------------------------------------------
// HELPER: armar series en espejo
// Serie i: jugadores[i], jugadores[N-1-i], jugadores[N/2-1-i], jugadores[N/2+i]
// -------------------------------------------------------
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

// -------------------------------------------------------
// HELPER: completar a múltiplo de 4 con LIBRE
// -------------------------------------------------------
function completarConLibre(jugadores: any[], librePlayer: any): any[] {
  const resto = jugadores.length % 4;
  if (resto === 0) return jugadores;
  const byesNecesarios = 4 - resto;
  const result = [...jugadores];
  for (let i = 0; i < byesNecesarios; i++) {
    result.push(librePlayer);
  }
  return result;
}

function mkMatch(phaseId: number, playerAId: number | null, playerBId: number | null, round: number, slotA?: string, slotB?: string, serieId?: string) {
  return { phaseId, playerAId, playerBId, slotA: slotA ?? null, slotB: slotB ?? null, round, status: 'pendiente', serieId: serieId ?? null };
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
    const { ordenados } = await getJugadoresOrdenados(circuit, circuitId);

    const N = ordenados.length; // jugadores reales inscriptos

    // Clasificar por posición en ranking (65+ juegan clasificatorio, etc.)
    // Con N jugadores reales, los puestos son 1..N
    // Clasificatorio: puestos ceil(N/2)+1 .. N (segunda mitad)
    const mitad = Math.ceil(N / 2);
    const jugClasif  = ordenados.slice(mitad);      // puestos mitad+1 .. N
    const jugSegunda = ordenados.slice(mitad / 2, mitad); // puestos mitad/4+1 .. mitad
    const jugPrimera = ordenados.slice(4, mitad / 2); // aproximado
    const jugMaster  = ordenados.slice(0, 4);          // los mejores

    // Completar clasificatorio con libre si es necesario
    const jugClasifConLibre = librePlayer ? completarConLibre(jugClasif, librePlayer) : jugClasif;
    const numSeries = jugClasifConLibre.length / 4;

    const pn = (p: any) => p.dni === LIBRE_DNI ? 'LIBRE' : `${p.lastName}${p.lastName ? ', ' : ''}${p.firstName}`;

    const series = armarSeriesEspejo(jugClasifConLibre).map((serie, i) => ({
      serie: i + 1,
      jugadores: serie.map((p: any) => ({
        id: p.id,
        nombre: pn(p),
        esLibre: p.dni === LIBRE_DNI
      }))
    }));

    const numClasificados = numSeries * 2; // primero y segundo de cada serie
    const crucesReduccion = [];
    if (numClasificados > 16) {
      for (let i = 0; i < numSeries; i++) {
        crucesReduccion.push({
          cruce: i + 1,
          slotA: `1° Serie ${i + 1}`,
          slotB: `2° Serie ${numSeries - i}`
        });
      }
      // repechaje si numSeries > 16
      if (numSeries > 16) {
        crucesReduccion.push({
          cruce: numSeries + 1,
          slotA: `Ganador Cruce ${numSeries - 1}`,
          slotB: `Ganador Cruce ${numSeries}`
        });
      }
    }

    res.json({
      inscriptos: { total: N, clasificatorio: jugClasif.length, segunda: jugSegunda.length, primera: jugPrimera.length, master: jugMaster.length },
      clasificatorio: {
        totalJugadores: jugClasifConLibre.length,
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

    // Borrar partidos existentes
    const phaseIds = circuit.phases.map(p => p.id);
    await prisma.setResult.deleteMany({ where: { match: { phaseId: { in: phaseIds } } } });
    await prisma.matchResult.deleteMany({ where: { match: { phaseId: { in: phaseIds } } } });
    await prisma.match.deleteMany({ where: { phaseId: { in: phaseIds } } });

    const librePlayer = await prisma.player.findFirst({ where: { dni: LIBRE_DNI } });
    const libreId = librePlayer?.id ?? 0;

    const { ordenados } = await getJugadoresOrdenados(circuit, circuitId);
    const N = ordenados.length;

    // Dividir por posición en ranking
    // Clasificatorio: segunda mitad (puestos N/2+1 .. N)
    // Segunda fase: puestos N/4+1 .. N/2
    // Tercera fase: puestos 9 .. N/4
    // Master: puestos 1 .. 8
    const corte1 = Math.ceil(N / 2);      // límite clasificatorio
    const corte2 = Math.ceil(N / 4);      // límite segunda
    const corte3 = 8;                      // master siempre son 8

    const jugClasif  = ordenados.slice(corte1);
    const jugSegunda = ordenados.slice(corte2, corte1);
    const jugPrimera = ordenados.slice(corte3, corte2);
    const jugMaster  = ordenados.slice(0, corte3);

    const phaseClasif  = circuit.phases.find(p => p.type === 'clasificatorio');
    const phaseSegunda = circuit.phases.find(p => p.type === 'segunda');
    const fasePrimera  = circuit.phases.find(p => p.type === 'primera');
    const faseMaster   = circuit.phases.find(p => p.type === 'master');

    const matchesCreados: any[] = [];
    const woMatches: { playerAId: number; playerBId: number; phaseId: number }[] = [];

    // -------------------------------------------------------
    // FASE CLASIFICATORIO
    // -------------------------------------------------------
    if (phaseClasif) {
      const jugConLibre = completarConLibre(jugClasif, librePlayer ?? { id: libreId, dni: LIBRE_DNI, firstName: 'LIBRE', lastName: '' });
      const series = armarSeriesEspejo(jugConLibre);
      const numSeries = series.length;

      for (let i = 0; i < numSeries; i++) {
        const serie = series[i];
        const [A, B, C, D] = serie;
        const roundBase = i * 10 + 1;
        const serieId = `clasif-serie-${i + 1}`;

        // P1: A vs B
        matchesCreados.push(mkMatch(phaseClasif.id, A.id, B.id, roundBase, undefined, undefined, serieId));
        // P2: C vs D
        matchesCreados.push(mkMatch(phaseClasif.id, C.id, D.id, roundBase + 1, undefined, undefined, serieId));

        // Marcar WOs automáticos
        if (A.dni === LIBRE_DNI || B.dni === LIBRE_DNI) {
          woMatches.push({ playerAId: A.id, playerBId: B.id, phaseId: phaseClasif.id });
        }
        if (C.dni === LIBRE_DNI || D.dni === LIBRE_DNI) {
          woMatches.push({ playerAId: C.id, playerBId: D.id, phaseId: phaseClasif.id });
        }
      }

      // Cruces de reducción con slots
      const numClasificados = numSeries * 2;
      if (numClasificados > 16) {
        for (let i = 0; i < numSeries; i++) {
          const roundCruce = numSeries * 10 + i + 1;
          matchesCreados.push(mkMatch(
            phaseClasif.id, null, null, roundCruce,
            `1° Serie ${i + 1}`,
            `2° Serie ${numSeries - i}`,
            `clasif-reduccion-${i + 1}`
          ));
        }
        // Repechaje si numSeries > 16
        if (numSeries > 16) {
          matchesCreados.push(mkMatch(
            phaseClasif.id, null, null,
            numSeries * 10 + numSeries + 1,
            `Ganador Cruce ${numSeries - 1}`,
            `Ganador Cruce ${numSeries}`,
            'clasif-repechaje'
          ));
        }
      }
    }

    // -------------------------------------------------------
    // FASE SEGUNDA — puestos corte2..corte1 + 16 clasificados
    // -------------------------------------------------------
    if (phaseSegunda && jugSegunda.length > 0) {
      const numSegunda = jugSegunda.length;
      const numClasif = 16;
      const total = numSegunda + numClasif;
      const jugConSlots = [
        ...jugSegunda,
        ...Array.from({ length: numClasif }, (_, i) => ({ id: null, slot: `Clasificado Clasif. #${i + 1}` }))
      ];

      // Completar a múltiplo de 4
      while (jugConSlots.length % 4 !== 0) {
        jugConSlots.push({ id: null, slot: 'LIBRE' });
      }

      const numSeries = jugConSlots.length / 4;
      const mitad = jugConSlots.length / 2;

      for (let i = 0; i < numSeries; i++) {
        const roundBase = i * 10 + 1;
        const serieId = `segunda-serie-${i + 1}`;
        const N2 = jugConSlots.length;

        const posiciones = [i, N2 - 1 - i, mitad - 1 - i, mitad + i];
        const jugSerie = posiciones.map(pos => jugConSlots[pos]);

        const getPA = (j: any) => ({ id: j.id ?? null, slot: j.slot ?? null });

        const [j0, j1, j2, j3] = jugSerie.map(getPA);

        matchesCreados.push(mkMatch(phaseSegunda.id, j0.id, j1.id, roundBase, j0.slot ?? undefined, j1.slot ?? undefined, serieId));
        matchesCreados.push(mkMatch(phaseSegunda.id, j2.id, j3.id, roundBase + 1, j2.slot ?? undefined, j3.slot ?? undefined, serieId));
      }
    }

    // -------------------------------------------------------
    // FASE PRIMERA — puestos corte3..corte2 + 24 clasificados
    // -------------------------------------------------------
    if (fasePrimera && jugPrimera.length > 0) {
      const numPrimera = jugPrimera.length;
      const numClasif = 24;
      const jugConSlots = [
        ...jugPrimera,
        ...Array.from({ length: numClasif }, (_, i) => ({ id: null, slot: `Clasificado Segunda #${i + 1}` }))
      ];
      const total = jugConSlots.length;

      for (let i = 0; i < Math.floor(total / 2); i++) {
        const jA = jugConSlots[i];
        const jB = jugConSlots[total - 1 - i];
        matchesCreados.push(mkMatch(
          fasePrimera.id,
          jA.id ?? null, jB.id ?? null,
          i + 1,
          (jA as any).slot ?? undefined,
          (jB as any).slot ?? undefined,
          `primera-cruce-${i + 1}`
        ));
      }
    }

    // -------------------------------------------------------
    // FASE MASTER — puestos 1..8 + 24 clasificados
    // -------------------------------------------------------
    if (faseMaster && jugMaster.length > 0) {
      const jugConSlots = [
        ...jugMaster,
        ...Array.from({ length: 24 }, (_, i) => ({ id: null, slot: `Clasificado Primera #${i + 1}` }))
      ];
      const total = jugConSlots.length;

      // Ronda 1: 16 cruces
      for (let i = 0; i < Math.floor(total / 2); i++) {
        const jA = jugConSlots[i];
        const jB = jugConSlots[total - 1 - i];
        matchesCreados.push(mkMatch(
          faseMaster.id,
          jA.id ?? null, jB.id ?? null,
          i + 1,
          (jA as any).slot ?? undefined,
          (jB as any).slot ?? undefined,
          `master-r1-cruce-${i + 1}`
        ));
      }

      // Rondas siguientes con slots
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
            `master-r${ronda}-cruce-${i + 1}`
          ));
        }
        jugadoresRonda = ganadores;
        ronda++;
      }
    }

    // Insertar partidos
    if (matchesCreados.length > 0) {
      await prisma.match.createMany({ data: matchesCreados });
    }

    // Resolver WOs automáticos (partidos contra LIBRE)
    if (woMatches.length > 0 && phaseClasif) {
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
      jugadores: {
        total: N,
        clasificatorio: jugClasif.length,
        segunda: jugSegunda.length,
        primera: jugPrimera.length,
        master: jugMaster.length
      }
    });

  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
