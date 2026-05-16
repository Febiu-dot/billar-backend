import { Router, Response } from 'express';
import prisma from '../services/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

// Calcula y guarda el ranking acumulado de un torneo
export async function calcularYGuardarAcumulado(tournamentId: number) {
  // Obtener todos los circuitos del torneo
  const circuits = await prisma.circuit.findMany({
    where: { tournamentId },
    include: { phases: true },
    orderBy: { order: 'asc' }
  });

  // Determinar cuáles circuitos están completos (todos los partidos de Master finalizados)
  const completedCircuits: typeof circuits = [];
  for (const circuit of circuits) {
    const masterPhase = circuit.phases.find(p => p.type === 'master');
    if (!masterPhase) continue;

    const total = await prisma.match.count({ where: { phaseId: masterPhase.id } });
    const finished = await prisma.match.count({
      where: { phaseId: masterPhase.id, status: { in: ['finalizado', 'wo'] } }
    });

    if (total > 0 && total === finished) {
      completedCircuits.push(circuit);
    }
  }

  if (completedCircuits.length === 0) return;

  // Obtener RankingEntry de todos los circuitos completos
  const completedIds = completedCircuits.map(c => c.id);
  const entries = await prisma.rankingEntry.findMany({
    where: { circuitId: { in: completedIds } }
  });

  // Agrupar por jugador y sumar stats
  const playerMap: Record<number, {
    playerId: number;
    points: number;
    setsWon: number;
    setsLost: number;
    pointsFor: number;
    pointsAgainst: number;
    matchesPlayed: number;
    matchesWon: number;
  }> = {};

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

  // Ordenar y asignar posiciones
  const sorted = Object.values(playerMap).sort((a, b) => {
    if (b.points    !== a.points)    return b.points    - a.points;
    if (b.setsWon   !== a.setsWon)   return b.setsWon   - a.setsWon;
    if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;
    return a.pointsAgainst - b.pointsAgainst;
  });

  const lastCircuit = completedCircuits[completedCircuits.length - 1];
  const circuitosIncluidos = completedCircuits.map(c => c.name).join(', ');

  // Upsert de todas las entradas
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

  console.log(`✅ Ranking acumulado calculado: ${sorted.length} jugadores, circuitos: ${circuitosIncluidos}`);
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
      res.status(404).json({ error: 'No hay ranking acumulado disponible aún. Se genera automáticamente al finalizar cada circuito.' });
      return;
    }

    res.json(entries);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/acumulado/calcular/:tournamentId — trigger manual (admin)
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
