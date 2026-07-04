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
    clasificatorio: phases.find((p: any) => p.type === 'clasificatorio')?.id ?? null,
    segunda:        phases.find((p: any) => p.type === 'segunda')?.id ?? null,
    primera:        phases.find((p: any) => p.type === 'primera')?.id ?? null,
    master:         phases.find((p: any) => p.type === 'master')?.id ?? null,
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

  // Diferencia de sets (ganados - perdidos)
  const difSetsA = a.setsGanados - (a.setsJugados - a.setsGanados);
  const difSetsB = b.setsGanados - (b.setsJugados - b.setsGanados);
  if (difSetsB !== difSetsA) return difSetsB - difSetsA;

  // Promedio de tantos (tantos a favor / tantos en contra)
  const promA = (a.tantosContra ?? 0) > 0 ? a.tantos / (a.tantosContra ?? 1) : a.tantos > 0 ? 99999 : 0;
  const promB = (b.tantosContra ?? 0) > 0 ? b.tantos / (b.tantosContra ?? 1) : b.tantos > 0 ? 99999 : 0;
  return promB - promA;
}

// ── Helper: sort Alternativa 4 para RankingEntry (datos de DB) ────────
function sortRankingEntry(
  a: { points: number; setsWon: number; setsLost: number; pointsFor: number; pointsAgainst: number },
  b: { points: number; setsWon: number; setsLost: number; pointsFor: number; pointsAgainst: number }
): number {
  if (b.points !== a.points) return b.points - a.points;

  // Diferencia de sets (ganados - perdidos)
  const difSetsA = a.setsWon - a.setsLost;
  const difSetsB = b.setsWon - b.setsLost;
  if (difSetsB !== difSetsA) return difSetsB - difSetsA;

  // Promedio de tantos (tantos a favor / tantos en contra)
  const promA = a.pointsAgainst > 0 ? a.pointsFor / a.pointsAgainst : a.pointsFor > 0 ? 99999 : 0;
  const promB = b.pointsAgainst > 0 ? b.pointsFor / b.pointsAgainst : b.pointsFor > 0 ? 99999 : 0;
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
      const config = configs.find((c: any) => c.phaseId === phaseId);
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
        const cruce = crucesClasif.find((c: any) => c.serieId === `clasif-reduccion-${i}`);
        if (cruce?.result?.winnerId) {
          const jugador = cruce.playerA?.id === cruce.result.winnerId ? cruce.playerA : cruce.playerB;
          clasificadosClasif.push({ posicion: i, jugador, fuente: `Cruce ${i}` });
        }
      }
      const repechaje = crucesClasif.find((c: any) => c.serieId === 'clasif-repechaje');
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

    // ── Nacional: leer directamente de RankingEntry (ya calculado) ──────
    const circuit = await prisma.circuit.findUnique({
      where: { id: circuitId },
      select: { configTorneo: true }
    });
    const configTorneo = circuit?.configTorneo as any;
    if (configTorneo?.tipo === 'nacional' || configTorneo?.tipo === 'panamericano') {
      const entries = await prisma.rankingEntry.findMany({
        where: { circuitId, position: { not: null } },
        include: { player: { include: { category: true } } },
        orderBy: { position: 'asc' }
      });
      const ranking = entries
        .filter((e: any) => e.player.dni !== 'FEBIU000' && e.player.active)
        .map((e: any) => {
          const setsJugados = e.setsWon + e.setsLost;
          const promedio = setsJugados > 0 ? parseFloat((e.pointsFor / setsJugados).toFixed(2)) : 0;
          const pctSets   = setsJugados > 0 ? parseFloat((e.setsWon / setsJugados * 100).toFixed(1)) : 0;
          const totalTantos = e.pointsFor + e.pointsAgainst;
          const pctTantos = totalTantos > 0 ? parseFloat((e.pointsFor / totalTantos * 100).toFixed(1)) : 0;
          return {
            posicion:    e.position,
            playerId:    e.playerId,
            firstName:   e.player.firstName,
            lastName:    e.player.lastName,
            club:        e.player.club ?? '',
            pais:        e.player.pais ?? 'Uruguay',
            categoria:   e.player.category.name,
            puntos:      e.points,
            setsGanados: e.setsWon,
            setsJugados,
            tantos:      e.pointsFor,
            tantosContra: e.pointsAgainst,
            promedio,
            pctSets,
            pctTantos,
          };
        });
      res.json(ranking);
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
      .map((cp: any) => cp.player)
      .filter((p: any) => p.dni !== 'FEBIU000' && p.active);

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
      .map((player: any) => {
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
      .sort((a: any, b: any) => sortAlternativa4(
        { puntos: a.puntos, setsGanados: a.setsGanados, setsJugados: a.setsJugados, tantos: a.tantos, tantosContra: a.tantosContra },
        { puntos: b.puntos, setsGanados: b.setsGanados, setsJugados: b.setsJugados, tantos: b.tantos, tantosContra: b.tantosContra }
      ))
      .map((player: any, index: any) => ({ ...player, posicion: index + 1 }));

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
      .map((cp: any) => cp.player)
      .filter((p: any) => p.dni !== 'FEBIU000' && p.active);

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
        if (!match.serieId || !esNacionalSerie(match.serieId)) continue;
        const sid = match.serieId as string;
        if (!nacSerieMatches[sid]) nacSerieMatches[sid] = [];
        nacSerieMatches[sid].push(match);
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
          addPts(match.result.winnerId, isFinal ? 5 : 3);
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
      .map((player: any) => {
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
      .sort((a: any, b: any) => sortAlternativa4(
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
    // Detectar si el circuito es nacional/panamericano
    const circuit = await prisma.circuit.findUnique({ where: { id: circuitId }, select: { configTorneo: true } });
    const tipoTorneo = (circuit?.configTorneo as any)?.tipo;
    const esNacional = tipoTorneo === 'nacional' || tipoTorneo === 'panamericano';

    // ── SINCRONIZACIÓN DE QUALY (solo nacionales/panamericanos) ──────────
    // Detecta filas del RankingEntry cuyo jugador NO jugó ninguna serie real
    // y las reemplaza por los jugadores reales que sí jugaron.
    let sincronizados = 0;
    if (esNacional) {
      // 1. Obtener todos los playerIds únicos que jugaron series nac-serie-*
      const seriesMatches = await prisma.match.findMany({
        where: {
          phase: { circuitId },
          serieId: { startsWith: 'nac-serie-' },
          status: { in: ['finalizado', 'wo', 'pendiente', 'en_juego'] }
        },
        select: { playerAId: true, playerBId: true }
      });
      const jugadoresRealesSet = new Set<number>();
      for (const m of seriesMatches) {
        if (m.playerAId) jugadoresRealesSet.add(m.playerAId);
        if (m.playerBId) jugadoresRealesSet.add(m.playerBId);
      }
      const jugadoresReales = Array.from(jugadoresRealesSet);

      // 2. Obtener filas actuales del RankingEntry
      const entradasActuales = await prisma.rankingEntry.findMany({ where: { circuitId } });
      const playerIdsEnRanking = entradasActuales.map((e: any) => e.playerId);

      // 3. Detectar provisorios: están en el RankingEntry pero NO jugaron ninguna serie
      const provisorios = entradasActuales.filter((e: any) => !jugadoresRealesSet.has(e.playerId));
      // 4. Detectar reales sin fila: jugaron series pero no tienen RankingEntry
      const sinFila = jugadoresReales.filter((id: number) => !playerIdsEnRanking.includes(id));

      // 5. Reemplazar provisorios por reales sin fila (par a par)
      for (let i = 0; i < Math.min(provisorios.length, sinFila.length); i++) {
        await prisma.rankingEntry.update({
          where: { id: provisorios[i].id },
          data: { playerId: sinFila[i] }
        });
        sincronizados++;
      }
      // 6. Borrar provisorios sobrantes (si hubiera más provisorios que reales sin fila)
      const sobrantes = provisorios.slice(sinFila.length);
      for (const s of sobrantes) {
        await prisma.rankingEntry.delete({ where: { id: s.id } });
      }
    }
    // ── FIN SINCRONIZACIÓN ───────────────────────────────────────────────

    // Reset stats (no puntos)
    await prisma.rankingEntry.updateMany({
      where: { circuitId },
      data: { matchesPlayed: 0, matchesWon: 0, setsWon: 0, setsLost: 0, pointsFor: 0, pointsAgainst: 0 }
    });

    // Buscar partidos finalizados — para nacionales solo series (nac-serie-*)
    const matches = await prisma.match.findMany({
      where: {
        phase: { circuitId },
        status: { in: ['finalizado', 'wo'] },
        ...(esNacional ? { serieId: { startsWith: 'nac-serie-' } } : {})
      },
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

    res.json({ ok: true, partidos: matches.length, jugadores: entries.length, sincronizados });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
