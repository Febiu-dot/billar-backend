import { Router, Response } from 'express';
import prisma from '../services/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

interface PlayerAcum {
  playerId: number;
  points: number;
  setsWon: number;
  setsLost: number;
  pointsFor: number;
  pointsAgainst: number;
  matchesPlayed: number;
  matchesWon: number;
}

export async function calcularYGuardarAcumulado(tournamentId: number): Promise<void> {
  const circuits = await prisma.circuit.findMany({
    where: { tournamentId },
    include: { phases: true },
    orderBy: { order: 'asc' }
  });

  const completedCircuits: typeof circuits = [];

  for (const circuit of circuits) {
    const masterPhase = circuit.phases.find((p: { type: string }) => p.type === 'master');
    if (!masterPhase) continue;

    const total    = await prisma.match.count({ where: { phaseId: masterPhase.id } });
    const finished = await prisma.match.count({
      where: { phaseId: masterPhase.id, status: { in: ['finalizado', 'wo'] } }
    });

    if (total > 0 && total === finished) {
      completedCircuits.push(circuit);
    }
  }

  if (completedCircuits.length === 0) return;

  const completedIds = completedCircuits.map((c: { id: number }) => c.id);

  const entries = await prisma.rankingEntry.findMany({
    where: { circuitId: { in: completedIds } }
  });

  const playerMap: Record<number, PlayerAcum> = {};

  for (const e of entries) {
    if (!playerMap[e.playerId]) {
      playerMap[e.playerId] = {
        playerId: e.playerId,
        points: 0, setsWon: 0, setsLost: 0,
        pointsFor: 0, pointsAgainst: 0,
        matchesPlayed: 0, matchesWon: 0,
      };
    }
    playerMap[e.playerId].points        += e.points;
    playerMap[e.playerId].setsWon       += e.setsWon;
    playerMap[e.playerId].setsLost      += e.setsLost;
    playerMap[e.playerId].pointsFor     += e.pointsFor;
    playerMap[e.playerId].pointsAgainst += e.pointsAgainst;
    playerMap[e.playerId].matchesPlayed += e.matchesPlayed;
    playerMap[e.playerId].matchesWon    += e.matchesWon;
  }

  const sorted: PlayerAcum[] = Object.values(playerMap).sort((a: PlayerAcum, b: PlayerAcum) => {
    if (b.points    !== a.points)    return b.points    - a.points;
    if (b.setsWon   !== a.setsWon)   return b.setsWon   - a.setsWon;
    if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;
    return a.pointsAgainst - b.pointsAgainst;
  });

  const lastCircuit = completedCircuits[completedCircuits.length - 1];
  const circuitosIncluidos = completedCircuits.map((c: { name: string }) => c.name).join(', ');

  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    await prisma.rankingAcumulado.upsert({
      where: { playerId_tournamentId: { playerId: e.playerId, tournamentId } },
      create: {
        playerId: e.playerId,
        tournamentId,
        position: i + 1,
        points: e.points,
        setsWon: e.setsWon,
        setsLost: e.setsLost,
        pointsFor: e.pointsFor,
        pointsAgainst: e.pointsAgainst,
        matchesPlayed: e.matchesPlayed,
        matchesWon: e.matchesWon,
        lastCircuitOrder: lastCircuit.order,
        circuitosIncluidos,
      },
      update: {
        position: i + 1,
        points: e.points,
        setsWon: e.setsWon,
        setsLost: e.setsLost,
        pointsFor: e.pointsFor,
        pointsAgainst: e.pointsAgainst,
        matchesPlayed: e.matchesPlayed,
        matchesWon: e.matchesWon,
        lastCircuitOrder: lastCircuit.order,
        circuitosIncluidos,
      }
    });
  }

  console.log(`✅ Ranking acumulado: ${sorted.length} jugadores, ${circuitosIncluidos}`);
}

// GET /api/acumulado/:tournamentId
router.get('/:tournamentId', async (req, res: Response) => {
  try {
    const tournamentId = parseInt(req.params.tournamentId);
    const entries = await prisma.rankingAcumulado.findMany({
      where: { tournamentId },
      include: { player: { include: { category: true } } },
      orderBy: { position: 'asc' }
    });

    if (entries.length === 0) {
      res.status(404).json({ error: 'No hay ranking acumulado disponible aún. Se genera automáticamente al finalizar cada fase Máster.' });
      return;
    }

    res.json(entries);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/acumulado/calcular/:tournamentId — trigger manual
router.post('/calcular/:tournamentId', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const tournamentId = parseInt(req.params.tournamentId);
    await calcularYGuardarAcumulado(tournamentId);
    res.json({ ok: true, message: 'Ranking acumulado calculado correctamente.' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
