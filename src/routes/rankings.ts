import { Router, Response } from 'express';
import prisma from '../services/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

// -------------------------------------------------------
// Rankings existentes (RankingEntry)
// -------------------------------------------------------
router.get('/', async (req, res: Response) => {
  const { circuitId } = req.query;
  const rankings = await prisma.rankingEntry.findMany({
    where: circuitId ? { circuitId: Number(circuitId) } : undefined,
    include: {
      player: { include: { category: true } },
      circuit: { include: { tournament: true } },
    },
    orderBy: [{ points: 'desc' }, { matchesWon: 'desc' }],
  });
  const withAverage = rankings.map((r, i) => ({
    ...r,
    position: i + 1,
    setsAverage: r.setsLost > 0 ? parseFloat((r.setsWon / r.setsLost).toFixed(2)) : r.setsWon > 0 ? 99.99 : 0,
    pointsAverage: r.pointsAgainst > 0 ? parseFloat((r.pointsFor / r.pointsAgainst).toFixed(2)) : r.pointsFor > 0 ? 99.99 : 0,
  }));
  res.json(withAverage);
});

router.get('/circuit/:circuitId', async (req, res: Response) => {
  const circuitId = Number(req.params.circuitId);
  const rankings = await prisma.rankingEntry.findMany({
    where: { circuitId },
    include: { player: { include: { category: true } } },
    orderBy: [{ points: 'desc' }, { matchesWon: 'desc' }],
  });
  const withAverage = rankings.map((r, i) => ({
    ...r,
    position: i + 1,
    setsAverage: r.setsLost > 0 ? parseFloat((r.setsWon / r.setsLost).toFixed(2)) : r.setsWon > 0 ? 99.99 : 0,
    pointsAverage: r.pointsAgainst > 0 ? parseFloat((r.pointsFor / r.pointsAgainst).toFixed(2)) : r.pointsFor > 0 ? 99.99 : 0,
  }));
  res.json(withAverage);
});

// -------------------------------------------------------
// GET /api/rankings/torneo
// -------------------------------------------------------
router.get('/torneo', async (_req, res: Response) => {
  try {
    const FASES = { clasificatorio: 30, segunda: 31, primera: 32, master: 33 };
    const configs = await prisma.faseConfig.findMany({
      where: { phaseId: { in: Object.values(FASES) } }
    });
    const getPublicado = (phaseId: number) => {
      const config = configs.find(c => c.phaseId === phaseId);
      return (config?.configuracion as any)?.rankingPublicado ?? false;
    };

    const crucesClasif = await prisma.match.findMany({
      where: {
        phaseId: FASES.clasificatorio,
        serieId: {
          in: [
            ...Array.from({ length: 15 }, (_, i) => `clasif-reduccion-${i + 1}`),
            'clasif-repechaje'
          ]
        }
      },
      include: { result: true, playerA: true, playerB: true }
    });

    const clasificadosClasif: any[] = [];
    for (let i = 1; i <= 15; i++) {
      const cruce = crucesClasif.find(c => c.serieId === `clasif-reduccion-${i}`);
      if (cruce?.result?.winnerId) {
        const jugador = cruce.playerA?.id === cruce.result.winnerId ? cruce.playerA : cruce.playerB;
        clasificadosClasif.push({ posicion: i, jugador, fuente: `Cruce ${i}` });
      }
    }
    const repechaje = crucesClasif.find(c => c.serieId === 'clasif-repechaje');
    if (repechaje?.result?.winnerId) {
      const jugador = repechaje.playerA?.id === repechaje.result.winnerId ? repechaje.playerA : repechaje.playerB;
      clasificadosClasif.push({ posicion: 16, jugador, fuente: 'Repechaje' });
    }

    const matchesSegunda = await prisma.match.findMany({
      where: { phaseId: FASES.segunda },
      include: { result: true, playerA: true, playerB: true },
      orderBy: { round: 'asc' }
    });

    const seriesSegundaMap: Record<string, any[]> = {};
    for (const m of matchesSegunda) {
      if (!m.serieId) continue;
      if (!seriesSegundaMap[m.serieId]) seriesSegundaMap[m.serieId] = [];
      seriesSegundaMap[m.serieId].push(m);
    }

    const clasificadosSegunda: any[] = [];
    const seriesOrdenadas = Object.keys(seriesSegundaMap).sort((a, b) => {
      const numA = parseInt(a.match(/(\d+)$/)?.[1] ?? '0');
      const numB = parseInt(b.match(/(\d+)$/)?.[1] ?? '0');
      return numA - numB;
    });

    let posSegunda = 1;
    for (const serieId of seriesOrdenadas) {
      const partidos = seriesSegundaMap[serieId];
      const roundBase = Math.min(...partidos.map(p => p.round));
      const p3 = partidos.find(p => p.round === roundBase + 2);
      const p5 = partidos.find(p => p.round === roundBase + 4);
      if (p3?.result?.winnerId) {
        const jugador = p3.playerA?.id === p3.result.winnerId ? p3.playerA : p3.playerB;
        clasificadosSegunda.push({ posicion: posSegunda++, jugador, fuente: `${serieId} — 1°` });
      }
      if (p5?.result?.winnerId) {
        const jugador = p5.playerA?.id === p5.result.winnerId ? p5.playerA : p5.playerB;
        clasificadosSegunda.push({ posicion: posSegunda++, jugador, fuente: `${serieId} — 2°` });
      }
    }

    const matchesPrimera = await prisma.match.findMany({
      where: { phaseId: FASES.primera },
      include: { result: true, playerA: true, playerB: true },
      orderBy: { round: 'asc' }
    });

    const clasificadosPrimera: any[] = [];
    let posPrimera = 1;
    for (const m of matchesPrimera) {
      if (m.result?.winnerId) {
        const jugador = m.playerA?.id === m.result.winnerId ? m.playerA : m.playerB;
        clasificadosPrimera.push({ posicion: posPrimera++, jugador, fuente: `Cruce ${m.round}` });
      }
    }

    const matchesMaster = await prisma.match.findMany({
      where: { phaseId: FASES.master },
      include: { result: true, playerA: true, playerB: true },
      orderBy: { round: 'desc' }
    });

    const clasificadosMaster: any[] = [];
    const finalMaster = matchesMaster[0];
    if (finalMaster?.result?.winnerId) {
      const campeon = finalMaster.playerA?.id === finalMaster.result.winnerId ? finalMaster.playerA : finalMaster.playerB;
      const subcampeon = finalMaster.playerA?.id === finalMaster.result.winnerId ? finalMaster.playerB : finalMaster.playerA;
      if (campeon) clasificadosMaster.push({ posicion: 1, jugador: campeon, fuente: 'Campeón' });
      if (subcampeon) clasificadosMaster.push({ posicion: 2, jugador: subcampeon, fuente: 'Finalista' });
    }

    res.json({
      clasificatorio: { publicado: getPublicado(FASES.clasificatorio), clasificados: clasificadosClasif },
      segunda: { publicado: getPublicado(FASES.segunda), clasificados: clasificadosSegunda },
      primera: { publicado: getPublicado(FASES.primera), clasificados: clasificadosPrimera },
      master: { publicado: getPublicado(FASES.master), clasificados: clasificadosMaster },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------
// PUT /api/rankings/torneo/:phaseId/publicar
// -------------------------------------------------------
router.put('/torneo/:phaseId/publicar', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const phaseId = parseInt(req.params.phaseId);
    const { publicado } = req.body;
    const config = await prisma.faseConfig.findUnique({ where: { phaseId } });
    const configuracionActual = (config?.configuracion as any) ?? {};
    await prisma.faseConfig.upsert({
      where: { phaseId },
      create: { phaseId, duracionSerie: 45, configuracion: { ...configuracionActual, rankingPublicado: publicado } },
      update: { configuracion: { ...configuracionActual, rankingPublicado: publicado }, updatedAt: new Date() }
    });
    res.json({ phaseId, publicado });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------
// GET /api/rankings/final — ranking final del circuito con puntos completos
// -------------------------------------------------------
router.get('/final', async (_req, res: Response) => {
  try {
    const FASES = { clasificatorio: 30, segunda: 31, primera: 32, master: 33 };

    // Compensaciones por categoría
    const COMP: Record<string, { puntos: number; sets: number; tantos: number }> = {
      tercera: { puntos: 0, sets: 0, tantos: 0 },
      segunda: { puntos: 8, sets: 9, tantos: 540 },
      primera: { puntos: 16, sets: 18, tantos: 1080 },
      master: { puntos: 21, sets: 23, tantos: 1380 },
    };

    // Jugadores activos excepto LIBRE
    const players = await prisma.player.findMany({
      where: { active: true, NOT: { dni: 'FEBIU000' } },
      include: { category: true },
    });

    // Todos los partidos finalizados
    const allMatches = await prisma.match.findMany({
      where: {
        phaseId: { in: [FASES.clasificatorio, FASES.segunda, FASES.primera, FASES.master] },
        status: { in: ['finalizado', 'wo'] },
      },
      include: {
        result: true,
        sets: { orderBy: { setNumber: 'asc' } },
        phase: true,
      }
    });

    interface PlayerStats {
      puntos: number;
      setsGanados: number;
      setsJugados: number;
      tantos: number;
    }
    const stats = new Map<number, PlayerStats>();

    // Inicializar con compensaciones
    for (const player of players) {
      const catName = player.category.name.toLowerCase();
      const comp = COMP[catName] ?? { puntos: 0, sets: 0, tantos: 0 };
      stats.set(player.id, {
        puntos: comp.puntos,
        setsGanados: comp.sets,
        setsJugados: comp.sets,
        tantos: comp.tantos,
      });
    }

    // Helper: sumar sets y tantos de un partido
    const addSetsAndTantos = (playerId: number | null | undefined, match: any, isPlayerA: boolean) => {
      if (!playerId) return;
      const s = stats.get(playerId);
      if (!s || !match.result) return;

      if (match.sets && match.sets.length > 0) {
        let setsWon = 0;
        let tantos = 0;
        for (const set of match.sets) {
          const ptsFor = isPlayerA ? set.pointsA : set.pointsB;
          const ptsAgainst = isPlayerA ? set.pointsB : set.pointsA;
          tantos += ptsFor;
          if (ptsFor > ptsAgainst) setsWon++;
        }
        s.setsGanados += setsWon;
        s.setsJugados += match.sets.length;
        s.tantos += tantos;
      } else {
        const setsFor = isPlayerA ? match.result.setsA : match.result.setsB;
        const setsAgainst = isPlayerA ? match.result.setsB : match.result.setsA;
        const tantosFor = isPlayerA ? match.result.pointsA : match.result.pointsB;
        s.setsGanados += setsFor;
        s.setsJugados += setsFor + setsAgainst;
        s.tantos += tantosFor;
      }
    };

    // Helper: sumar puntos
    const addPts = (playerId: number | null | undefined, pts: number) => {
      if (!playerId) return;
      const s = stats.get(playerId);
      if (s) s.puntos += pts;
    };

    // Series (clasificatorio y segunda)
    const serieMatches: Record<string, any[]> = {};
    for (const match of allMatches) {
      if (!match.serieId) continue;
      if (!match.serieId.startsWith('clasif-serie-') && !match.serieId.startsWith('segunda-serie-')) continue;
      if (!serieMatches[match.serieId]) serieMatches[match.serieId] = [];
      serieMatches[match.serieId].push(match);
    }

    for (const matches of Object.values(serieMatches)) {
      const roundBase = Math.min(...matches.map((m: any) => m.round));
      const p3 = matches.find((m: any) => m.round === roundBase + 2);
      const p4 = matches.find((m: any) => m.round === roundBase + 3);
      const p5 = matches.find((m: any) => m.round === roundBase + 4);

      if (p3?.result?.winnerId) addPts(p3.result.winnerId, 8); // 1°
      if (p4?.result) {
        const p4LoserId = p4.playerAId === p4.result.winnerId ? p4.playerBId : p4.playerAId;
        addPts(p4LoserId, 2); // 4°
      }
      if (p5?.result?.winnerId) {
        const p5LoserId = p5.playerAId === p5.result.winnerId ? p5.playerBId : p5.playerAId;
        addPts(p5.result.winnerId, 6); // 2°
        addPts(p5LoserId, 4); // 3°
      }

      for (const match of matches) {
        addSetsAndTantos(match.playerAId, match, true);
        addSetsAndTantos(match.playerBId, match, false);
      }
    }

    // Reducción y repechaje
    for (const match of allMatches) {
      if (!match.serieId) continue;
      if (!match.serieId.includes('reduccion') && !match.serieId.includes('repechaje')) continue;
      if (!match.result?.winnerId) continue;
      const loserId = match.playerAId === match.result.winnerId ? match.playerBId : match.playerAId;
      addPts(match.result.winnerId, 5);
      addPts(loserId, 1);
      addSetsAndTantos(match.playerAId, match, true);
      addSetsAndTantos(match.playerBId, match, false);
    }

    // Primera
    for (const match of allMatches) {
      if (match.phase.type !== 'primera') continue;
      if (!match.result?.winnerId) continue;
      const loserId = match.playerAId === match.result.winnerId ? match.playerBId : match.playerAId;
      addPts(match.result.winnerId, 5);
      addPts(loserId, 1);
      addSetsAndTantos(match.playerAId, match, true);
      addSetsAndTantos(match.playerBId, match, false);
    }

    // Master
    for (const match of allMatches) {
      if (match.phase.type !== 'master') continue;
      if (!match.result?.winnerId) continue;
      const isFinal = match.round === 31;
      const loserId = match.playerAId === match.result.winnerId ? match.playerBId : match.playerAId;
      addPts(match.result.winnerId, isFinal ? 7 : 5);
      addPts(loserId, isFinal ? 2 : 1);
      addSetsAndTantos(match.playerAId, match, true);
      addSetsAndTantos(match.playerBId, match, false);
    }

    // Construir ranking
    const ranking = players
      .map(player => {
        const s = stats.get(player.id) ?? { puntos: 0, setsGanados: 0, setsJugados: 0, tantos: 0 };
        const promedio = s.setsJugados > 0 ? parseFloat((s.tantos / s.setsJugados).toFixed(2)) : 0;
        return {
          playerId: player.id,
          firstName: player.firstName,
          lastName: player.lastName,
          club: player.club ?? '',
          categoria: player.category.name,
          puntos: s.puntos,
          setsGanados: s.setsGanados,
          tantos: s.tantos,
          promedio,
        };
      })
      .sort((a, b) => {
        if (b.puntos !== a.puntos) return b.puntos - a.puntos;
        if (b.setsGanados !== a.setsGanados) return b.setsGanados - a.setsGanados;
        if (b.tantos !== a.tantos) return b.tantos - a.tantos;
        return b.promedio - a.promedio;
      })
      .map((player, index) => ({
        ...player,
        posicion: index + 1,
        categoriaProxima: index < 8 ? 'master' : index < 32 ? 'primera' : index < 64 ? 'segunda' : 'tercera',
      }));

    res.json(ranking);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
