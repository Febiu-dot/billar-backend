import { Router, Response } from 'express';
import prisma from '../services/prisma';

const router = Router();

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

  // Calcular promedio con 2 decimales para desempate
  const withAverage = rankings.map((r, i) => ({
    ...r,
    position: i + 1,
    setsAverage:
      r.setsLost > 0 ? parseFloat((r.setsWon / r.setsLost).toFixed(2)) : r.setsWon > 0 ? 99.99 : 0,
    pointsAverage:
      r.pointsAgainst > 0
        ? parseFloat((r.pointsFor / r.pointsAgainst).toFixed(2))
        : r.pointsFor > 0 ? 99.99 : 0,
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
    setsAverage:
      r.setsLost > 0 ? parseFloat((r.setsWon / r.setsLost).toFixed(2)) : r.setsWon > 0 ? 99.99 : 0,
    pointsAverage:
      r.pointsAgainst > 0
        ? parseFloat((r.pointsFor / r.pointsAgainst).toFixed(2))
        : r.pointsFor > 0 ? 99.99 : 0,
  }));

  res.json(withAverage);
});

export default router;
