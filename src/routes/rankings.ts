import { Router, Response } from 'express';
import prisma from '../services/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

// ── Helper: obtiene phaseIds de un circuito ───────────────────────────
async function getPhasesDeCircuito(circuitId: number) {
  const phases = await prisma.phase.findMany({
    where: { circuitId },
    orderBy: { order: 'asc' }
  });
  return {
    clasificatorio: phases.find(p => p.type === 'clasificatorio')?.id ?? null,
    segunda:        phases.find(p => p.type === 'segunda')?.id ?? null,
    primera:        phases.find(p => p.type === 'primera')?.id ?? null,
    master:         phases.find(p => p.type === 'master')?.id ?? null,
  };
}

// ── Helper: calcula stats de partidos de un circuito ─────────────────
async function calcularStatsCircuito(phaseIds: { clasificatorio: number | null; segunda: number | null; primera: number | null; master: number | null }) {
  const phaseIdList = Object.values(phaseIds).filter(Boolean) as number[];
  if (phaseIdList.length === 0) return [];

  return prisma.match.findMany({
    where: {
      phaseId: { in: phaseIdList },
      status: { in: ['finalizado', 'wo'] },
    },
    include: { result: true, sets: { orderBy: { setNumber: 'asc' } }, phase: true }
  });
}

// ── Helper: función de ordenamiento Alternativa 4 ─────────────────────
// 1. Puntos (más es mejor)
// 2. % sets ganados = setsWon / (setsWon + setsLost) — evita ventaja por más partidos
// 3. % tantos a favor = pointsFor / (pointsFor + pointsAgainst)
// 4. promedio tantos por set (tantos / setsJugados) — como último desempate
function sortAlternativa4(
  a: { puntos: number; setsGanados: number; setsJugados: number; tantos: number; tantosContra?: number },
  b: { puntos: number; setsGanados: number; setsJugados: number; tantos: number; tantosContra?: number }
): number {
  if (b.puntos !== a.puntos) return b.puntos - a.puntos;

  const pctSetsA = a.setsJugados > 0 ? a.setsGanados / a.setsJugados : 0;
  const pctSetsB = b.setsJugados > 0 ? b.setsGanados / b.setsJugados : 0;
  if (Math.abs(pctSetsB - pctSetsA) > 0.0001) return pctSetsB - pctSetsA;

  const totalTantosA = a.tantos + (a.tantosContra ?? 0);
  const totalTantosB = b.tantos + (b.tantosContra ?? 0);
  const pctTantosA = totalTantosA > 0 ? a.tantos / totalTantosA : 0;
  const pctTantosB = totalTantosB > 0 ? b.tantos / totalTantosB : 0;
  if (Math.abs(pctTantosB - pctTantosA) > 0.0001) return pctTantosB - pctTantosA;

  const promA = a.setsJugados > 0 ? a.tantos / a.setsJugados : 0;
  const promB = b.setsJugados > 0 ? b.tantos / b.setsJugados : 0;
  return promB - promA;
}

// ── Helper: sort Alternativa 4 para RankingEntry (datos de DB) ────────
function sortRankingEntry(
  a: { points: number; setsWon: number; setsLost: number; pointsFor: number; pointsAgainst: number },
  b: { points: number; setsWon: number; setsLost: number; pointsFor: number; pointsAgainst: number }
): number {
  if (b.points !== a.points) return b.points - a.points;

  const setsJugadosA = a.setsWon + a.setsLost;
  const setsJugadosB = b.setsWon + b.setsLost;
  const pctSetsA = setsJugadosA > 0 ? a.setsWon / setsJugadosA : 0;
  const pctSetsB = setsJugadosB > 0 ? b.setsWon / setsJugadosB : 0;
  if (Math.abs(pctSetsB - pctSetsA) > 0.0001) return pctSetsB - pctSetsA;

  const totalTantosA = a.pointsFor + a.pointsAgainst;
  const totalTantosB = b.pointsFor + b.pointsAgainst;
  const pctTantosA = totalTantosA > 0 ? a.pointsFor / totalTantosA : 0;
  const pctTantosB = totalTantosB > 0 ? b.pointsFor / totalTantosB : 0;
  if (Math.abs(pctTantosB - pctTantosA) > 0.0001) return pctTantosB - pctTantosA;

  const promA = setsJugadosA > 0 ? a.pointsFor / setsJugadosA : 0;
  const promB = setsJugadosB > 0 ? b.pointsFor / setsJugadosB : 0;
  return promB - promA;
}

// -------------------------------------------------------
// GET /api/rankings — Rankings por circuito
// -------------------------------------------------------
router.get('/', async (req, res: Response) => {
  const { circuitId } = req.query;
  const rankings = await prisma.rankingEntry.findMany({
    where: circuitId ? { circuitId: Number(circuitId) } : undefined,
    include: {
      player: { include: { category: true } },
      circuit: { include: { tournament: true } },
    },
  });

  const sorted = [...rankings].sort(sortRankingEntry);

  const withAverage = sorted.map((r, i) => ({
    ...r,
    position: i + 1,
    setsAverage:   r.setsLost > 0   ? parseFloat((r.setsWon / r.setsLost).toFixed(2))     : r.setsWon > 0   ? 99.99 : 0,
    pointsAverage: r.pointsAgainst > 0 ? parseFloat((r.pointsFor / r.pointsAgainst).toFixed(2)) : r.pointsFor > 0 ? 99.99 : 0,
  }));
  res.json(withAverage);
});

router.get('/circuit/:circuitId', async (req, res: Response) => {
  const circuitId = Number(req.params.circuitId);
  const rankings = await prisma.rankingEntry.findMany({
    where: { circuitId },
    include: { player: { include: { category: true } } },
  });

  const sorted = [...rankings].sort(sortRankingEntry);

  const withAverage = sorted.map((r, i) => ({
    ...r,
    position: i + 1,
    setsAverage:   r.setsLost > 0   ? parseFloat((r.setsWon / r.setsLost).toFixed(2))     : r.setsWon > 0   ? 99.99 : 0,
    pointsAverage: r.pointsAgainst > 0 ? parseFloat((r.pointsFor / r.pointsAgainst).toFixed(2)) : r.pointsFor > 0 ? 99.99 : 0,
  }));
  res.json(withAverage);
});

// -------------------------------------------------------
// GET /api/rankings/torneo?circuitId=X
// -------------------------------------------------------
router.get('/torneo', async (req, res: Response) => {
  try {
    const circuitId = req.query.circuitId ? Number(req.query.circuitId) : null;
    if (!circuitId) {
      res.status(400).json({ error: 'circuitId es requerido' });
      return;
    }

    const FASES = await getPhasesDeCircuito(circuitId);

    const configs = await prisma.faseConfig.findMany({
      where: { phaseId: { in: Object.values(FASES).filter(Boolean) as number[] } }
    });
    const getPublicado = (phaseId: number | null) => {
      if (!phaseId) return false;
      const config = configs.find(c => c.phaseId === phaseId);
      return (config?.configuracion as any)?.rankingPublicado ?? false;
    };

    // ── Clasificatorio ────────────────────────────────────────────────
    const clasificadosClasif: any[] = [];
    if (FASES.clasificatorio) {
      const circuit = await prisma.circuit.findUnique({
        where: { id: circuitId },
        include: { phases: true }
      });
      const config = (circuit as any)?.configTorneo as any;
      const cuposDesdeClasif = config?.cuposDesdeClasif ?? 16;

      const crucesClasif = await prisma.match.findMany({
        where: {
          phaseId: FASES.clasificatorio,
          serieId: { in: [...Array.from({ length: cuposDesdeClasif + 1 }, (_, i) => `clasif-reduccion-${i + 1}`), 'clasif-repechaje'] }
        },
        include: { result: true, playerA: true, playerB: true }
      });

      for (let i = 1; i <= cuposDesdeClasif - 1; i++) {
        const cruce = crucesClasif.find(c => c.serieId === `clasif-reduccion-${i}`);
        if (cruce?.result?.winnerId) {
          const jugador = cruce.playerA?.id === cruce.result.winnerId ? cruce.playerA : cruce.playerB;
          clasificadosClasif.push({ posicion: i, jugador, fuente: `Cruce ${i}` });
        }
      }
      const repechaje = crucesClasif.find(c => c.serieId === 'clasif-repechaje');
      if (repechaje?.result?.winnerId) {
        const jugador = repechaje.playerA?.id === repechaje.result.winnerId ? repechaje.playerA : repechaje.playerB;
        clasificadosClasif.push({ posicion: cuposDesdeClasif, jugador, fuente: 'Repechaje' });
      }
    }

    // ── Segunda ───────────────────────────────────────────────────────
    const clasificadosSegunda: any[] = [];
    if (FASES.segunda) {
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
    }

    // ── Primera ───────────────────────────────────────────────────────
    const clasificadosPrimera: any[] = [];
    if (FASES.primera) {
      const matchesPrimera = await prisma.match.findMany({
        where: { phaseId: FASES.primera },
        include: { result: true, playerA: true, playerB: true },
        orderBy: { round: 'asc' }
      });
      let posPrimera = 1;
      for (const m of matchesPrimera) {
        if (m.result?.winnerId) {
          const jugador = m.playerA?.id === m.result.winnerId ? m.playerA : m.playerB;
          clasificadosPrimera.push({ posicion: posPrimera++, jugador, fuente: `Cruce ${m.round}` });
        }
      }
    }

    // ── Máster ────────────────────────────────────────────────────────
    const clasificadosMaster: any[] = [];
    if (FASES.master) {
      const matchesMaster = await prisma.match.findMany({
        where: { phaseId: FASES.master },
        include: { result: true, playerA: true, playerB: true },
        orderBy: { round: 'desc' }
      });
      const finalMaster = matchesMaster[0];
      if (finalMaster?.result?.winnerId) {
        const campeon    = finalMaster.playerA?.id === finalMaster.result.winnerId ? finalMaster.playerA : finalMaster.playerB;
        const subcampeon = finalMaster.playerA?.id === finalMaster.result.winnerId ? finalMaster.playerB : finalMaster.playerA;
        if (campeon)    clasificadosMaster.push({ posicion: 1, jugador: campeon,    fuente: 'Campeón' });
        if (subcampeon) clasificadosMaster.push({ posicion: 2, jugador: subcampeon, fuente: 'Finalista' });
      }
    }

    res.json({
      phaseIds: FASES,
      clasificatorio: { publicado: getPublicado(FASES.clasificatorio), clasificados: clasificadosClasif },
      segunda:        { publicado: getPublicado(FASES.segunda),        clasificados: clasificadosSegunda },
      primera:        { publicado: getPublicado(FASES.primera),        clasificados: clasificadosPrimera },
      master:         { publicado: getPublicado(FASES.master),         clasificados: clasificadosMaster },
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
// GET /api/rankings/final?circuitId=X
// -------------------------------------------------------
router.get('/final', async (req, res: Response) => {
  try {
    const circuitId = req.query.circuitId ? Number(req.query.circuitId) : null;
    if (!circuitId) {
      res.status(400).json({ error: 'circuitId es requerido' });
      return;
    }

    const FASES = await getPhasesDeCircuito(circuitId);
    const phaseIdList = Object.values(FASES).filter(Boolean) as number[];

    // Jugadores inscriptos en este circuito
    const circuitPlayers = await prisma.circuitPlayer.findMany({
      where: { circuitId },
      include: { player: { include: { category: true } } }
    });
    const players = circuitPlayers
      .map(cp => cp.player)
      .filter(p => p.dni !== 'FEBIU000' && p.active);

    const allMatches = await prisma.match.findMany({
      where: {
        phaseId: { in: phaseIdList },
        status: { in: ['finalizado', 'wo'] },
      },
      include: { result: true, sets: { orderBy: { setNumber: 'asc' } }, phase: true }
    });

    interface PlayerStats { puntos: number; setsGanados: number; setsJugados: number; tantos: number; tantosContra: number; }
    const stats = new Map<number, PlayerStats>();
    for (const player of players) {
      stats.set(player.id, { puntos: 0, setsGanados: 0, setsJugados: 0, tantos: 0, tantosContra: 0 });
    }

    const addSetsAndTantos = (playerId: number | null | undefined, match: any, isPlayerA: boolean) => {
      if (!playerId) return;
      const s = stats.get(playerId);
      if (!s || !match.result) return;
      if (match.sets && match.sets.length > 0) {
        let setsWon = 0, tantos = 0, tantosContra = 0;
        for (const set of match.sets) {
          const ptsFor     = isPlayerA ? set.pointsA : set.pointsB;
          const ptsAgainst = isPlayerA ? set.pointsB : set.pointsA;
          tantos += ptsFor;
          tantosContra += ptsAgainst;
          if (ptsFor > ptsAgainst) setsWon++;
        }
        s.setsGanados += setsWon;
        s.setsJugados += match.sets.length;
        s.tantos += tantos;
        s.tantosContra += tantosContra;
      } else {
        const setsFor     = isPlayerA ? match.result.setsA    : match.result.setsB;
        const setsAgainst = isPlayerA ? match.result.setsB    : match.result.setsA;
        const tantosFor   = isPlayerA ? match.result.pointsA  : match.result.pointsB;
        const tantosContra = isPlayerA ? match.result.pointsB : match.result.pointsA;
        s.setsGanados += setsFor;
        s.setsJugados += setsFor + setsAgainst;
        s.tantos += tantosFor;
        s.tantosContra += tantosContra ?? 0;
      }
    };

    const addPts = (playerId: number | null | undefined, pts: number) => {
      if (!playerId) return;
      const s = stats.get(playerId);
      if (s) s.puntos += pts;
    };

    // ── Series Clasificatorio y Segunda ───────────────────────────────
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
      if (p3?.result?.winnerId) addPts(p3.result.winnerId, 8);
      if (p4?.result) { const p4LoserId = p4.playerAId === p4.result.winnerId ? p4.playerBId : p4.playerAId; addPts(p4LoserId, 2); }
      if (p5?.result?.winnerId) {
        const p5LoserId = p5.playerAId === p5.result.winnerId ? p5.playerBId : p5.playerAId;
        addPts(p5.result.winnerId, 6);
        addPts(p5LoserId, 4);
      }
      for (const match of matches) {
        addSetsAndTantos(match.playerAId, match, true);
        addSetsAndTantos(match.playerBId, match, false);
      }
    }

    // ── Reducción y Repechaje: 0 puntos ───────────────────────────────
    for (const match of allMatches) {
      if (!match.serieId) continue;
      if (!match.serieId.includes('reduccion') && !match.serieId.includes('repechaje')) continue;
      addSetsAndTantos(match.playerAId, match, true);
      addSetsAndTantos(match.playerBId, match, false);
    }

    // ── Cruces Primera: 5/1 ───────────────────────────────────────────
    for (const match of allMatches) {
      if (match.phase.type !== 'primera') continue;
      if (!match.result?.winnerId) continue;
      const loserId = match.playerAId === match.result.winnerId ? match.playerBId : match.playerAId;
      if (!match.result.isWO) {
        addPts(match.result.winnerId, 5);
        addPts(loserId, 1);
      }
      addSetsAndTantos(match.playerAId, match, true);
      addSetsAndTantos(match.playerBId, match, false);
    }

    // ── Cruces Máster: 5/1, Final: 7/2 ───────────────────────────────
    for (const match of allMatches) {
      if (match.phase.type !== 'master') continue;
      if (!match.result?.winnerId) continue;
      const isFinal = match.serieId === 'master-final';
      const loserId = match.playerAId === match.result.winnerId ? match.playerBId : match.playerAId;
      if (!match.result.isWO) {
        addPts(match.result.winnerId, isFinal ? 7 : 5);
        addPts(loserId, isFinal ? 2 : 1);
      }
      addSetsAndTantos(match.playerAId, match, true);
      addSetsAndTantos(match.playerBId, match, false);
    }

    const ranking = players
      .map(player => {
        const s = stats.get(player.id) ?? { puntos: 0, setsGanados: 0, setsJugados: 0, tantos: 0, tantosContra: 0 };
        const promedio = s.setsJugados > 0 ? parseFloat((s.tantos / s.setsJugados).toFixed(2)) : 0;
        const pctSets   = s.setsJugados > 0 ? parseFloat((s.setsGanados / s.setsJugados * 100).toFixed(1)) : 0;
        const pctTantos = (s.tantos + s.tantosContra) > 0 ? parseFloat((s.tantos / (s.tantos + s.tantosContra) * 100).toFixed(1)) : 0;
        return {
          playerId: player.id,
          firstName: player.firstName,
          lastName: player.lastName,
          club: player.club ?? '',
          categoria: player.category.name,
          puntos: s.puntos,
          setsGanados: s.setsGanados,
          setsJugados: s.setsJugados,
          tantos: s.tantos,
          tantosContra: s.tantosContra,
          promedio,
          pctSets,
          pctTantos,
        };
      })
      .sort((a, b) => sortAlternativa4(
        { puntos: a.puntos, setsGanados: a.setsGanados, setsJugados: a.setsJugados, tantos: a.tantos, tantosContra: a.tantosContra },
        { puntos: b.puntos, setsGanados: b.setsGanados, setsJugados: b.setsJugados, tantos: b.tantos, tantosContra: b.tantosContra }
      ))
      .map((player, index) => ({ ...player, posicion: index + 1 }));

    res.json(ranking);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------
// POST /api/rankings/guardar-final/:circuitId
// -------------------------------------------------------
router.post('/guardar-final/:circuitId', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const circuitId = parseInt(req.params.circuitId);
    const FASES = await getPhasesDeCircuito(circuitId);
    const phaseIdList = Object.values(FASES).filter(Boolean) as number[];

    const circuitPlayers = await prisma.circuitPlayer.findMany({
      where: { circuitId },
      include: { player: { include: { category: true } } }
    });
    const players = circuitPlayers
      .map(cp => cp.player)
      .filter(p => p.dni !== 'FEBIU000' && p.active);

    const allMatches = await prisma.match.findMany({
      where: {
        phaseId: { in: phaseIdList },
        status: { in: ['finalizado', 'wo'] },
      },
      include: { result: true, sets: { orderBy: { setNumber: 'asc' } }, phase: true }
    });

    interface PlayerStats { puntos: number; setsGanados: number; setsJugados: number; tantos: number; tantosContra: number; }
    const stats = new Map<number, PlayerStats>();
    for (const player of players) {
      stats.set(player.id, { puntos: 0, setsGanados: 0, setsJugados: 0, tantos: 0, tantosContra: 0 });
    }

    const addSetsAndTantos = (playerId: number | null | undefined, match: any, isPlayerA: boolean) => {
      if (!playerId) return;
      const s = stats.get(playerId);
      if (!s || !match.result) return;
      if (match.sets && match.sets.length > 0) {
        let setsWon = 0, tantos = 0, tantosContra = 0;
        for (const set of match.sets) {
          const ptsFor     = isPlayerA ? set.pointsA : set.pointsB;
          const ptsAgainst = isPlayerA ? set.pointsB : set.pointsA;
          tantos += ptsFor;
          tantosContra += ptsAgainst;
          if (ptsFor > ptsAgainst) setsWon++;
        }
        s.setsGanados += setsWon;
        s.setsJugados += match.sets.length;
        s.tantos += tantos;
        s.tantosContra += tantosContra;
      } else {
        const setsFor      = isPlayerA ? match.result.setsA   : match.result.setsB;
        const setsAgainst  = isPlayerA ? match.result.setsB   : match.result.setsA;
        const tantosFor    = isPlayerA ? match.result.pointsA : match.result.pointsB;
        const tantosContra = isPlayerA ? match.result.pointsB : match.result.pointsA;
        s.setsGanados += setsFor;
        s.setsJugados += setsFor + setsAgainst;
        s.tantos += tantosFor;
        s.tantosContra += tantosContra ?? 0;
      }
    };

    const addPts = (playerId: number | null | undefined, pts: number) => {
      if (!playerId) return;
      const s = stats.get(playerId);
      if (s) s.puntos += pts;
    };

    // Detectar si el circuito es nacional (serieIds: nac-serie-X o NP-G1..NP-G8)
    const esNacionalSerie = (id: string | null) =>
      !!id && (id.startsWith('nac-serie-') || /^[A-Z]+-G\d+$/.test(id));
    const esNacional = allMatches.some((m: any) => esNacionalSerie(m.serieId));

    if (esNacional) {
      // ── NACIONAL: series nac-serie-X o NP-G1..NP-G8 (P1..P5) ───────
      const nacSerieMatches: Record<string, any[]> = {};
      for (const match of allMatches) {
        if (!esNacionalSerie(match.serieId)) continue;
        if (!nacSerieMatches[match.serieId]) nacSerieMatches[match.serieId] = [];
        nacSerieMatches[match.serieId].push(match);
      }
      for (const matches of Object.values(nacSerieMatches)) {
        const roundBase = Math.min(...matches.map((m: any) => m.round));
        const p3 = matches.find((m: any) => m.round === roundBase + 2);
        const p4 = matches.find((m: any) => m.round === roundBase + 3);
        const p5 = matches.find((m: any) => m.round === roundBase + 4);
        if (p3?.result?.winnerId) addPts(p3.result.winnerId, 8);
        if (p4?.result) { const p4LoserId = p4.playerAId === p4.result.winnerId ? p4.playerBId : p4.playerAId; addPts(p4LoserId, 2); }
        if (p5?.result?.winnerId) {
          const p5LoserId = p5.playerAId === p5.result.winnerId ? p5.playerBId : p5.playerAId;
          addPts(p5.result.winnerId, 6);
          addPts(p5LoserId, 4);
        }
        for (const match of matches) {
          addSetsAndTantos(match.playerAId, match, true);
          addSetsAndTantos(match.playerBId, match, false);
        }
      }

      // ── NACIONAL: bracket master ──────────────────────────────────────
      for (const match of allMatches) {
        if (match.phase.type !== 'master') continue;
        if (!match.serieId?.startsWith('nac-')) continue;
        if (!match.result?.winnerId) continue;
        const isFinal = match.serieId === 'nac-final';
        const loserId = match.playerAId === match.result.winnerId ? match.playerBId : match.playerAId;
        if (!match.result.isWO) {
          addPts(match.result.winnerId, isFinal ? 7 : 5);
          addPts(loserId, isFinal ? 2 : 1);
        }
        addSetsAndTantos(match.playerAId, match, true);
        addSetsAndTantos(match.playerBId, match, false);
      }
    } else {
      // ── DEPARTAMENTAL: clasif-serie-, segunda-serie- ──────────────────
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
        if (p3?.result?.winnerId) addPts(p3.result.winnerId, 8);
        if (p4?.result) { const p4LoserId = p4.playerAId === p4.result.winnerId ? p4.playerBId : p4.playerAId; addPts(p4LoserId, 2); }
        if (p5?.result?.winnerId) {
          const p5LoserId = p5.playerAId === p5.result.winnerId ? p5.playerBId : p5.playerAId;
          addPts(p5.result.winnerId, 6);
          addPts(p5LoserId, 4);
        }
        for (const match of matches) {
          addSetsAndTantos(match.playerAId, match, true);
          addSetsAndTantos(match.playerBId, match, false);
        }
      }

      for (const match of allMatches) {
        if (!match.serieId) continue;
        if (!match.serieId.includes('reduccion') && !match.serieId.includes('repechaje')) continue;
        addSetsAndTantos(match.playerAId, match, true);
        addSetsAndTantos(match.playerBId, match, false);
      }

      for (const match of allMatches) {
        if (match.phase.type !== 'primera') continue;
        if (!match.result?.winnerId) continue;
        const loserId = match.playerAId === match.result.winnerId ? match.playerBId : match.playerAId;
        if (!match.result.isWO) { addPts(match.result.winnerId, 5); addPts(loserId, 1); }
        addSetsAndTantos(match.playerAId, match, true);
        addSetsAndTantos(match.playerBId, match, false);
      }

      for (const match of allMatches) {
        if (match.phase.type !== 'master') continue;
        if (!match.result?.winnerId) continue;
        const isFinal = match.serieId === 'master-final';
        const loserId = match.playerAId === match.result.winnerId ? match.playerBId : match.playerAId;
        if (!match.result.isWO) { addPts(match.result.winnerId, isFinal ? 7 : 5); addPts(loserId, isFinal ? 2 : 1); }
        addSetsAndTantos(match.playerAId, match, true);
        addSetsAndTantos(match.playerBId, match, false);
      }
    }

    const ranked = players
      .map(player => {
        const s = stats.get(player.id) ?? { puntos: 0, setsGanados: 0, setsJugados: 0, tantos: 0, tantosContra: 0 };
        return {
          playerId: player.id,
          puntos: s.puntos,
          setsGanados: s.setsGanados,
          setsJugados: s.setsJugados,
          tantos: s.tantos,
          tantosContra: s.tantosContra,
        };
      })
      .sort((a, b) => sortAlternativa4(
        { puntos: a.puntos, setsGanados: a.setsGanados, setsJugados: a.setsJugados, tantos: a.tantos, tantosContra: a.tantosContra },
        { puntos: b.puntos, setsGanados: b.setsGanados, setsJugados: b.setsJugados, tantos: b.tantos, tantosContra: b.tantosContra }
      ));

    let guardados = 0;
    for (let i = 0; i < ranked.length; i++) {
      const entry = ranked[i];
      await prisma.rankingEntry.upsert({
        where: { playerId_circuitId: { playerId: entry.playerId, circuitId } },
        create: {
          playerId: entry.playerId, circuitId, position: i + 1,
          points: entry.puntos, matchesPlayed: 0, matchesWon: 0,
          setsWon: entry.setsGanados, setsLost: entry.setsJugados - entry.setsGanados,
          pointsFor: entry.tantos, pointsAgainst: entry.tantosContra,
        },
        update: {
          position: i + 1, points: entry.puntos,
          setsWon: entry.setsGanados, setsLost: entry.setsJugados - entry.setsGanados,
          pointsFor: entry.tantos, pointsAgainst: entry.tantosContra,
        }
      });
      guardados++;
    }

    res.json({ message: `Ranking guardado correctamente — ${guardados} jugadores`, circuitId });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});


// ── DELETE /api/rankings/limpiar/:circuitId ──────────────────────────
// Borra RankingEntry, CircuitPlayer y partidos del circuito.
router.delete('/limpiar/:circuitId', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const circuitId = parseInt(req.params.circuitId);

    // Borrar partidos (SetResult -> MatchResult -> Match)
    const phases = await prisma.phase.findMany({ where: { circuitId } });
    const phaseIds = phases.map((p: any) => p.id);
    if (phaseIds.length > 0) {
      await prisma.setResult.deleteMany({ where: { match: { phaseId: { in: phaseIds } } } });
      await prisma.matchResult.deleteMany({ where: { match: { phaseId: { in: phaseIds } } } });
      await prisma.match.deleteMany({ where: { phaseId: { in: phaseIds } } });
    }

    // Borrar ranking
    const ranking = await prisma.rankingEntry.deleteMany({ where: { circuitId } });

    // Borrar inscripciones
    const inscripciones = await prisma.circuitPlayer.deleteMany({ where: { circuitId } });

    res.json({ ok: true, message: 'Circuito ' + circuitId + ' limpiado completamente', ranking: ranking.count, inscripciones: inscripciones.count });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});


// ── Recalcular stats de ranking desde partidos ya jugados ──────────────
router.post('/recalcular-stats/:circuitId', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const circuitId = Number(req.params.circuitId);
  try {
    // Reset stats (no puntos)
    await prisma.rankingEntry.updateMany({
      where: { circuitId },
      data: { matchesPlayed: 0, matchesWon: 0, setsWon: 0, setsLost: 0, pointsFor: 0, pointsAgainst: 0 }
    });

    // Buscar todos los partidos finalizados del circuito
    const matches = await prisma.match.findMany({
      where: { phase: { circuitId }, status: { in: ['finalizado', 'wo'] } },
      include: { result: true }
    });

    for (const m of matches) {
      if (!m.result || !m.playerAId || !m.playerBId) continue;
      const { setsA, setsB, pointsA, pointsB, winnerId } = m.result;
      const wonA = winnerId === m.playerAId ? 1 : 0;
      const wonB = winnerId === m.playerBId ? 1 : 0;
      await prisma.rankingEntry.updateMany({
        where: { playerId: m.playerAId, circuitId },
        data: { matchesPlayed: { increment: 1 }, matchesWon: { increment: wonA }, setsWon: { increment: setsA }, setsLost: { increment: setsB }, pointsFor: { increment: pointsA ?? 0 }, pointsAgainst: { increment: pointsB ?? 0 } }
      });
      await prisma.rankingEntry.updateMany({
        where: { playerId: m.playerBId, circuitId },
        data: { matchesPlayed: { increment: 1 }, matchesWon: { increment: wonB }, setsWon: { increment: setsB }, setsLost: { increment: setsA }, pointsFor: { increment: pointsB ?? 0 }, pointsAgainst: { increment: pointsA ?? 0 } }
      });
    }

    // Recalcular posiciones con Alternativa 4
    const entries = await prisma.rankingEntry.findMany({
      where: { circuitId }
    });

    const sorted = [...entries].sort(sortRankingEntry);

    for (let i = 0; i < sorted.length; i++) {
      await prisma.rankingEntry.update({ where: { id: sorted[i].id }, data: { position: i + 1 } });
    }

    res.json({ ok: true, partidos: matches.length, jugadores: entries.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
