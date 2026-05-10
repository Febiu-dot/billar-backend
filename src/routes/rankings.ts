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
// GET /api/rankings/torneo — ranking por fases del torneo
// -------------------------------------------------------
router.get('/torneo', async (_req, res: Response) => {
  try {
    const FASES = { clasificatorio: 30, segunda: 31, primera: 32, master: 33 };

    // Estados de publicación guardados en FaseConfig
    const configs = await prisma.faseConfig.findMany({
      where: { phaseId: { in: Object.values(FASES) } }
    });
    const getPublicado = (phaseId: number) => {
      const config = configs.find(c => c.phaseId === phaseId);
      return (config?.configuracion as any)?.rankingPublicado ?? false;
    };

    // ---- CLASIFICATORIO: ganadores de cruces 1-15 + repechaje ----
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

    // ---- SEGUNDA: 1° y 2° de cada serie ----
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

    // ---- PRIMERA: ganadores de cruces ----
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

    // ---- MASTER: posiciones finales ----
    const matchesMaster = await prisma.match.findMany({
      where: { phaseId: FASES.master },
      include: { result: true, playerA: true, playerB: true },
      orderBy: { round: 'desc' }
    });

    const clasificadosMaster: any[] = [];
    const finalMaster = matchesMaster[0]; // partido con round más alto = final
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

export default router;
