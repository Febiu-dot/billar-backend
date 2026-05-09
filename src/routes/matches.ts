import { Router, Response } from 'express';
import prisma from '../services/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { io } from '../index';
import { emitMatchUpdate, emitTableUpdate } from '../services/socketService';

const router = Router();

// -------------------------------------------------------
// HELPER: rellenar slot de Segunda con ganador de cruce de reducción
// -------------------------------------------------------
async function rellenarSlotSegunda(matchId: number) {
  try {
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      include: { result: true }
    });

    if (!match || !match.result?.winnerId) return;
    if (!match.serieId) return;

    // Solo cruces de reducción 1-15
    const mReduccion = match.serieId.match(/^clasif-reduccion-(\d+)$/);
    if (!mReduccion) return;

    const cruceNum = parseInt(mReduccion[1]);
    if (cruceNum > 15) return;

    const slotLabel = `Clasificado Clasif. #${cruceNum}`;
    const winnerId = match.result.winnerId;

    const segundaMatch = await prisma.match.findFirst({
      where: {
        OR: [{ slotA: slotLabel }, { slotB: slotLabel }]
      }
    });

    if (!segundaMatch) {
      console.log(`No se encontró partido de Segunda con slot ${slotLabel}`);
      return;
    }

    const esSlotA = segundaMatch.slotA === slotLabel;

    await prisma.match.update({
      where: { id: segundaMatch.id },
      data: esSlotA
        ? { playerAId: winnerId, slotA: null }
        : { playerBId: winnerId, slotB: null }
    });

    const actualizado = await prisma.match.findUnique({ where: { id: segundaMatch.id } });

    if (actualizado?.playerAId && actualizado?.playerBId) {
      await prisma.match.update({
        where: { id: segundaMatch.id },
        data: { status: actualizado.tableId ? 'asignado' : 'pendiente' }
      });

      const full = await prisma.match.findUnique({
        where: { id: segundaMatch.id },
        include: {
          playerA: { include: { category: true } },
          playerB: { include: { category: true } },
          table: { include: { venue: true } },
          phase: { include: { circuit: { include: { tournament: true } } } },
          result: true,
          sets: { orderBy: { setNumber: 'asc' } },
        }
      });
      if (full) emitMatchUpdate(io, full);
    }

    console.log(`✅ Slot ${slotLabel} rellenado en Segunda con jugador ${winnerId}`);
  } catch (error) {
    console.error('Error rellenando slot de Segunda:', error);
  }
}

// -------------------------------------------------------
// HELPER: rellenar slot #16 de Segunda con ganador del repechaje
// -------------------------------------------------------
async function rellenarSlotSegundaConRepechaje(winnerId: number) {
  try {
    const slotLabel = 'Clasificado Clasif. #16';

    const segundaMatch = await prisma.match.findFirst({
      where: {
        OR: [{ slotA: slotLabel }, { slotB: slotLabel }]
      }
    });

    if (!segundaMatch) {
      console.log(`No se encontró partido de Segunda con slot ${slotLabel}`);
      return;
    }

    const esSlotA = segundaMatch.slotA === slotLabel;

    await prisma.match.update({
      where: { id: segundaMatch.id },
      data: esSlotA
        ? { playerAId: winnerId, slotA: null }
        : { playerBId: winnerId, slotB: null }
    });

    const actualizado = await prisma.match.findUnique({ where: { id: segundaMatch.id } });

    if (actualizado?.playerAId && actualizado?.playerBId) {
      await prisma.match.update({
        where: { id: segundaMatch.id },
        data: { status: actualizado.tableId ? 'asignado' : 'pendiente' }
      });

      const full = await prisma.match.findUnique({
        where: { id: segundaMatch.id },
        include: {
          playerA: { include: { category: true } },
          playerB: { include: { category: true } },
          table: { include: { venue: true } },
          phase: { include: { circuit: { include: { tournament: true } } } },
          result: true,
          sets: { orderBy: { setNumber: 'asc' } },
        }
      });
      if (full) emitMatchUpdate(io, full);
    }

    console.log(`✅ Slot ${slotLabel} rellenado en Segunda con ganador del repechaje ${winnerId}`);
  } catch (error) {
    console.error('Error rellenando slot de Segunda con repechaje:', error);
  }
}

// -------------------------------------------------------
// HELPER: rellenar repechaje con ganadores de cruces 16 y 17
// -------------------------------------------------------
async function rellenarRepechaje(matchId: number) {
  try {
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      include: { result: true }
    });

    if (!match || !match.result?.winnerId) return;
    if (!match.serieId) return;

    const esCruce16 = match.serieId === 'clasif-reduccion-16';
    const esCruce17 = match.serieId === 'clasif-reduccion-17';
    if (!esCruce16 && !esCruce17) return;

    const repechaje = await prisma.match.findFirst({
      where: { phaseId: match.phaseId, serieId: 'clasif-repechaje' }
    });
    if (!repechaje) return;

    const winnerId = match.result.winnerId;

    await prisma.match.update({
      where: { id: repechaje.id },
      data: {
        ...(esCruce16 ? { playerAId: winnerId, slotA: null } : {}),
        ...(esCruce17 ? { playerBId: winnerId, slotB: null } : {}),
      }
    });

    const repechajeActualizado = await prisma.match.findUnique({ where: { id: repechaje.id } });

    if (repechajeActualizado?.playerAId && repechajeActualizado?.playerBId) {
      await prisma.match.update({
        where: { id: repechaje.id },
        data: { status: repechajeActualizado.tableId ? 'asignado' : 'pendiente' }
      });
      console.log('✅ Repechaje listo con ambos jugadores');

      const updatedRepechaje = await prisma.match.findUnique({
        where: { id: repechaje.id },
        include: {
          playerA: { include: { category: true } },
          playerB: { include: { category: true } },
          table: { include: { venue: true } },
          phase: { include: { circuit: { include: { tournament: true } } } },
          result: true,
          sets: { orderBy: { setNumber: 'asc' } },
        }
      });
      if (updatedRepechaje) emitMatchUpdate(io, updatedRepechaje);
    }

    console.log(`✅ Repechaje actualizado con ganador de ${match.serieId}`);
  } catch (error) {
    console.error('Error rellenando repechaje:', error);
  }
}

// -------------------------------------------------------
// HELPER: calcular ranking y rellenar cruces de reducción
// -------------------------------------------------------
async function rellenarCrucesReduccion(phaseId: number) {
  try {
    const todasLasSeries = await prisma.match.findMany({
      where: {
        phaseId,
        serieId: { startsWith: 'clasif-serie-' },
      },
      include: { result: true, sets: true },
      orderBy: { round: 'asc' }
    });

    const seriesMap: Record<string, any[]> = {};
    for (const m of todasLasSeries) {
      if (!m.serieId) continue;
      if (!seriesMap[m.serieId]) seriesMap[m.serieId] = [];
      seriesMap[m.serieId].push(m);
    }

    for (const serieId of Object.keys(seriesMap)) {
      const partidos = seriesMap[serieId];
      const p5 = partidos.find(p => {
        const roundBase = Math.floor(p.round / 10) * 10 + 1;
        return p.round === roundBase + 4;
      });
      if (!p5 || !p5.result?.winnerId) {
        console.log(`Serie ${serieId} aún no tiene P5 con resultado`);
        return;
      }
    }

    console.log('✅ Todas las series terminaron, calculando ranking...');

    interface ClasificadoStats {
      playerId: number;
      posEnSerie: number;
      puntos: number;
      setsGanados: number;
      tantosAFavor: number;
      tantosEnContra: number;
    }

    const clasificados: ClasificadoStats[] = [];

    for (const serieId of Object.keys(seriesMap)) {
      const partidos = seriesMap[serieId];

      const jugadoresIds = new Set<number>();
      for (const p of partidos) {
        if (p.playerAId) jugadoresIds.add(p.playerAId);
        if (p.playerBId) jugadoresIds.add(p.playerBId);
      }

      const statsJugador: Record<number, { wins: number; sets: number; ptsFor: number; ptsAgainst: number }> = {};
      for (const id of jugadoresIds) {
        statsJugador[id] = { wins: 0, sets: 0, ptsFor: 0, ptsAgainst: 0 };
      }

      for (const partido of partidos) {
        if (!partido.result) continue;
        const { winnerId, setsA, setsB, pointsA, pointsB } = partido.result;
        const pA = partido.playerAId;
        const pB = partido.playerBId;

        if (pA && statsJugador[pA]) {
          statsJugador[pA].wins += winnerId === pA ? 1 : 0;
          statsJugador[pA].sets += setsA;
          statsJugador[pA].ptsFor += pointsA;
          statsJugador[pA].ptsAgainst += pointsB;
        }
        if (pB && statsJugador[pB]) {
          statsJugador[pB].wins += winnerId === pB ? 1 : 0;
          statsJugador[pB].sets += setsB;
          statsJugador[pB].ptsFor += pointsB;
          statsJugador[pB].ptsAgainst += pointsA;
        }
      }

      const jugadoresOrdenados = Array.from(jugadoresIds)
        .filter(id => statsJugador[id])
        .sort((a, b) => {
          const sa = statsJugador[a];
          const sb = statsJugador[b];
          if (sb.wins !== sa.wins) return sb.wins - sa.wins;
          if (sb.sets !== sa.sets) return sb.sets - sa.sets;
          if (sb.ptsFor !== sa.ptsFor) return sb.ptsFor - sa.ptsFor;
          return sa.ptsAgainst - sb.ptsAgainst;
        });

      if (jugadoresOrdenados[0]) {
        const s = statsJugador[jugadoresOrdenados[0]];
        clasificados.push({
          playerId: jugadoresOrdenados[0],
          posEnSerie: 1,
          puntos: 8,
          setsGanados: s.sets,
          tantosAFavor: s.ptsFor,
          tantosEnContra: s.ptsAgainst,
        });
      }
      if (jugadoresOrdenados[1]) {
        const s = statsJugador[jugadoresOrdenados[1]];
        clasificados.push({
          playerId: jugadoresOrdenados[1],
          posEnSerie: 2,
          puntos: 6,
          setsGanados: s.sets,
          tantosAFavor: s.ptsFor,
          tantosEnContra: s.ptsAgainst,
        });
      }
    }

    clasificados.sort((a, b) => {
      if (b.puntos !== a.puntos) return b.puntos - a.puntos;
      if (b.setsGanados !== a.setsGanados) return b.setsGanados - a.setsGanados;
      if (b.tantosAFavor !== a.tantosAFavor) return b.tantosAFavor - a.tantosAFavor;
      return a.tantosEnContra - b.tantosEnContra;
    });

    console.log(`Ranking calculado: ${clasificados.length} clasificados`);

    const crucesReduccion = await prisma.match.findMany({
      where: {
        phaseId,
        serieId: { startsWith: 'clasif-reduccion-' }
      },
      orderBy: { round: 'asc' }
    });

    const N = clasificados.length;
    for (let i = 0; i < crucesReduccion.length && i < Math.floor(N / 2); i++) {
      const cruce = crucesReduccion[i];
      const jugA = clasificados[i];
      const jugB = clasificados[N - 1 - i];

      if (jugA && jugB) {
        await prisma.match.update({
          where: { id: cruce.id },
          data: {
            playerAId: jugA.playerId,
            playerBId: jugB.playerId,
            slotA: null,
            slotB: null,
            status: cruce.tableId ? 'asignado' : 'pendiente',
          }
        });
        console.log(`✅ Cruce ${i + 1}: #${i + 1} vs #${N - i}`);
      }
    }

    const repechaje = await prisma.match.findFirst({
      where: { phaseId, serieId: 'clasif-repechaje' }
    });
    if (repechaje && crucesReduccion.length >= 2) {
      const ultimoCruce = crucesReduccion[crucesReduccion.length - 1];
      const penultimoCruce = crucesReduccion[crucesReduccion.length - 2];
      await prisma.match.update({
        where: { id: repechaje.id },
        data: {
          slotA: `Ganador Cruce ${penultimoCruce.round}`,
          slotB: `Ganador Cruce ${ultimoCruce.round}`,
        }
      });
    }

    console.log('✅ Cruces de reducción rellenados');
  } catch (error) {
    console.error('Error rellenando cruces de reducción:', error);
  }
}

// -------------------------------------------------------
// HELPER: generar siguiente partido de la serie
// -------------------------------------------------------
async function generarSiguientePartidoSerie(matchId: number) {
  try {
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      include: { result: true, phase: true }
    });
    if (!match || !match.result?.winnerId) return;

    const phaseId = match.phaseId;
    const round = match.round;
    const roundBase = Math.floor(round / 10) * 10 + 1;
    const posEnSerie = round - roundBase;

    if (posEnSerie > 3) return;

    const partidos = await prisma.match.findMany({
      where: { phaseId, serieId: match.serieId },
      include: { result: true },
      orderBy: { round: 'asc' },
    });

    const p1 = partidos.find(p => p.round === roundBase);
    const p2 = partidos.find(p => p.round === roundBase + 1);
    const p3 = partidos.find(p => p.round === roundBase + 2);
    const p4 = partidos.find(p => p.round === roundBase + 3);

    const tableId = p1?.tableId ?? null;
    const ruleSetId = p1?.ruleSetId ?? null;

    if (posEnSerie <= 1) {
      const p1Done = p1?.result?.winnerId;
      const p2Done = p2?.result?.winnerId;

      if (p1Done && p2Done && !p3) {
        const newP3 = await prisma.match.create({
          data: {
            phaseId,
            playerAId: p1.result!.winnerId!,
            playerBId: p2.result!.winnerId!,
            round: roundBase + 2,
            status: 'asignado',
            serieId: match.serieId,
            tableId,
            ruleSetId,
          },
          include: {
            playerA: { include: { category: true } },
            playerB: { include: { category: true } },
            table: { include: { venue: true } },
            phase: { include: { circuit: { include: { tournament: true } } } },
            result: true,
            ruleSet: true,
            sets: { orderBy: { setNumber: 'asc' } },
          }
        });

        const p1LoserId = p1.playerAId === p1.result!.winnerId ? p1.playerBId : p1.playerAId;
        const p2LoserId = p2.playerAId === p2.result!.winnerId ? p2.playerBId : p2.playerAId;

        if (p1LoserId && p2LoserId) {
          const newP4 = await prisma.match.create({
            data: {
              phaseId,
              playerAId: p1LoserId,
              playerBId: p2LoserId,
              round: roundBase + 3,
              status: 'asignado',
              serieId: match.serieId,
              tableId,
              ruleSetId,
            },
            include: {
              playerA: { include: { category: true } },
              playerB: { include: { category: true } },
              table: { include: { venue: true } },
              phase: { include: { circuit: { include: { tournament: true } } } },
              result: true,
              ruleSet: true,
              sets: { orderBy: { setNumber: 'asc' } },
            }
          });
          emitMatchUpdate(io, newP4);
        }

        emitMatchUpdate(io, newP3);
        console.log(`✅ Serie ${match.serieId}: P3 y P4 generados`);
      }
    }

    if (posEnSerie >= 2 && posEnSerie <= 3) {
      const p3Done = p3?.result?.winnerId;
      const p4Done = p4?.result?.winnerId;
      const p5existe = partidos.find(p => p.round === roundBase + 4);

      if (p3Done && p4Done && !p5existe) {
        const p3LoserId = p3!.playerAId === p3!.result!.winnerId ? p3!.playerBId : p3!.playerAId;

        if (p3LoserId && p4!.result!.winnerId) {
          const newP5 = await prisma.match.create({
            data: {
              phaseId,
              playerAId: p3LoserId,
              playerBId: p4!.result!.winnerId!,
              round: roundBase + 4,
              status: 'asignado',
              serieId: match.serieId,
              tableId,
              ruleSetId,
            },
            include: {
              playerA: { include: { category: true } },
              playerB: { include: { category: true } },
              table: { include: { venue: true } },
              phase: { include: { circuit: { include: { tournament: true } } } },
              result: true,
              ruleSet: true,
              sets: { orderBy: { setNumber: 'asc' } },
            }
          });
          emitMatchUpdate(io, newP5);
          console.log(`✅ Serie ${match.serieId}: P5 generado`);

          if (match.phase?.type === 'clasificatorio' && match.serieId?.startsWith('clasif-serie-')) {
            await rellenarCrucesReduccion(phaseId);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error generando siguiente partido de serie:', error);
  }
}

// GET all matches
router.get('/', async (req, res: Response) => {
  const { phaseId, status, tableId, venueId } = req.query;

  const matches = await prisma.match.findMany({
    where: {
      ...(phaseId ? { phaseId: Number(phaseId) } : {}),
      ...(status ? { status: status as any } : {}),
      ...(tableId ? { tableId: Number(tableId) } : {}),
      ...(venueId ? { table: { venueId: Number(venueId) } } : {}),
    },
    include: {
      playerA: { include: { category: true } },
      playerB: { include: { category: true } },
      table: { include: { venue: true } },
      phase: { include: { circuit: { include: { tournament: true } } } },
      result: true,
      ruleSet: true,
      sets: { orderBy: { setNumber: 'asc' } },
    },
    orderBy: [{ scheduledAt: 'asc' }, { round: 'asc' }, { createdAt: 'asc' }],
  });
  res.json(matches);
});

router.get('/active', async (_req, res: Response) => {
  const matches = await prisma.match.findMany({
    where: { status: { in: ['asignado', 'en_juego'] } },
    include: {
      playerA: { include: { category: true } },
      playerB: { include: { category: true } },
      table: { include: { venue: true } },
      phase: { include: { circuit: { include: { tournament: true } } } },
      result: true,
      sets: { orderBy: { setNumber: 'asc' } },
    },
    orderBy: { updatedAt: 'desc' },
  });
  res.json(matches);
});

router.get('/:id', async (req, res: Response) => {
  const match = await prisma.match.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      playerA: { include: { category: true } },
      playerB: { include: { category: true } },
      table: { include: { venue: true } },
      phase: { include: { circuit: { include: { tournament: true } } } },
      result: true,
      ruleSet: true,
      sets: { orderBy: { setNumber: 'asc' } },
    },
  });
  if (!match) return res.status(404).json({ error: 'Partido no encontrado' }) as any;
  res.json(match);
});

router.put('/:id', authenticate, requireRole('admin', 'juez_sede'), async (req: AuthRequest, res: Response) => {
  const { scheduledAt } = req.body;
  const match = await prisma.match.update({
    where: { id: Number(req.params.id) },
    data: { scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined },
    include: {
      playerA: { include: { category: true } },
      playerB: { include: { category: true } },
      table: { include: { venue: true } },
      phase: { include: { circuit: { include: { tournament: true } } } },
      result: true,
      sets: { orderBy: { setNumber: 'asc' } },
    },
  });
  emitMatchUpdate(io, match);
  res.json(match);
});

router.put('/:id/assign', authenticate, requireRole('admin', 'juez_sede'), async (req: AuthRequest, res: Response) => {
  const { tableId } = req.body;
  const matchId = Number(req.params.id);

  await prisma.table.update({
    where: { id: tableId },
    data: { status: 'ocupada' },
  });

  const match = await prisma.match.update({
    where: { id: matchId },
    data: { tableId, status: 'asignado' },
    include: {
      playerA: { include: { category: true } },
      playerB: { include: { category: true } },
      table: { include: { venue: true } },
      phase: { include: { circuit: { include: { tournament: true } } } },
      result: true,
      sets: { orderBy: { setNumber: 'asc' } },
    },
  });

  emitMatchUpdate(io, match);
  if (match.table) emitTableUpdate(io, match.table);
  res.json(match);
});

router.put('/:id/start', authenticate, requireRole('admin', 'juez_sede'), async (req: AuthRequest, res: Response) => {
  const match = await prisma.match.update({
    where: { id: Number(req.params.id) },
    data: { status: 'en_juego', startedAt: new Date() },
    include: {
      playerA: { include: { category: true } },
      playerB: { include: { category: true } },
      table: { include: { venue: true } },
      phase: { include: { circuit: { include: { tournament: true } } } },
      result: true,
      sets: { orderBy: { setNumber: 'asc' } },
    },
  });
  emitMatchUpdate(io, match);
  res.json(match);
});

router.put('/:id/set', authenticate, requireRole('admin', 'juez_sede'), async (req: AuthRequest, res: Response) => {
  const matchId = Number(req.params.id);
  const { setNumber, pointsA, pointsB } = req.body;

  const existingMatch = await prisma.match.findUnique({
    where: { id: matchId },
    include: { ruleSet: true, sets: true },
  });
  if (!existingMatch) return res.status(404).json({ error: 'Partido no encontrado' }) as any;

  const winnerId = pointsA > pointsB ? existingMatch.playerAId : existingMatch.playerBId;

  await prisma.setResult.upsert({
    where: { id: (existingMatch.sets.find(s => s.setNumber === setNumber)?.id ?? 0) },
    create: { matchId, setNumber, pointsA, pointsB, winnerId },
    update: { pointsA, pointsB, winnerId },
  });

  const allSets = await prisma.setResult.findMany({
    where: { matchId },
    orderBy: { setNumber: 'asc' },
  });

  const setsA = allSets.filter(s => s.pointsA > s.pointsB).length;
  const setsB = allSets.filter(s => s.pointsB > s.pointsA).length;
  const totalPtsA = allSets.reduce((acc, s) => acc + s.pointsA, 0);
  const totalPtsB = allSets.reduce((acc, s) => acc + s.pointsB, 0);

  await prisma.matchResult.upsert({
    where: { matchId },
    create: { matchId, setsA, setsB, pointsA: totalPtsA, pointsB: totalPtsB, isWO: false },
    update: { setsA, setsB, pointsA: totalPtsA, pointsB: totalPtsB },
  });

  const updatedMatch = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      playerA: { include: { category: true } },
      playerB: { include: { category: true } },
      table: { include: { venue: true } },
      phase: { include: { circuit: { include: { tournament: true } } } },
      result: true,
      ruleSet: true,
      sets: { orderBy: { setNumber: 'asc' } },
    },
  });

  emitMatchUpdate(io, updatedMatch);
  res.json(updatedMatch);
});

router.put('/:id/result', authenticate, requireRole('admin', 'juez_sede'), async (req: AuthRequest, res: Response) => {
  const matchId = Number(req.params.id);
  const { setsA, setsB, pointsA, pointsB, isWO, woPlayerId, notes, sets } = req.body;

  const existingMatch = await prisma.match.findUnique({
    where: { id: matchId },
    include: { ruleSet: true, phase: { include: { circuit: true } } },
  });
  if (!existingMatch) return res.status(404).json({ error: 'Partido no encontrado' }) as any;

  const ruleSet = existingMatch.ruleSet;
  let finalSetsA = setsA;
  let finalSetsB = setsB;
  let finalPtsA = pointsA;
  let finalPtsB = pointsB;
  let winnerId: number | null = null;

  if (isWO) {
    const absentId = woPlayerId;
    const winnPId = absentId === existingMatch.playerAId ? existingMatch.playerBId : existingMatch.playerAId;
    winnerId = winnPId;
    if (ruleSet) {
      if (absentId === existingMatch.playerAId) {
        finalSetsA = ruleSet.woSetsLoser;
        finalSetsB = ruleSet.woSetsWinner;
        finalPtsA = ruleSet.woPtsLoser;
        finalPtsB = ruleSet.woPtsWinner;
      } else {
        finalSetsA = ruleSet.woSetsWinner;
        finalSetsB = ruleSet.woSetsLoser;
        finalPtsA = ruleSet.woPtsWinner;
        finalPtsB = ruleSet.woPtsLoser;
      }
    }
  } else {
    const setsToWin = ruleSet?.setsToWin ?? 2;
    if (finalSetsA >= setsToWin) winnerId = existingMatch.playerAId;
    else if (finalSetsB >= setsToWin) winnerId = existingMatch.playerBId;
  }

  const result = await prisma.matchResult.upsert({
    where: { matchId },
    create: { matchId, setsA: finalSetsA, setsB: finalSetsB, pointsA: finalPtsA, pointsB: finalPtsB, winnerId, isWO: !!isWO, woPlayerId, notes },
    update: { setsA: finalSetsA, setsB: finalSetsB, pointsA: finalPtsA, pointsB: finalPtsB, winnerId, isWO: !!isWO, woPlayerId, notes },
  });

  if (!isWO && sets && Array.isArray(sets) && sets.length > 0) {
    await prisma.setResult.deleteMany({ where: { matchId } });
    await prisma.setResult.createMany({
      data: sets.map((s: { setNumber: number; pointsA: number; pointsB: number }) => ({
        matchId,
        setNumber: s.setNumber,
        pointsA: s.pointsA,
        pointsB: s.pointsB,
        winnerId: s.pointsA > s.pointsB ? existingMatch.playerAId : existingMatch.playerBId,
      })),
    });
  }

  const updatedMatch = await prisma.match.update({
    where: { id: matchId },
    data: { status: isWO ? 'wo' : 'finalizado', finishedAt: new Date() },
    include: {
      playerA: { include: { category: true } },
      playerB: { include: { category: true } },
      table: { include: { venue: true } },
      phase: { include: { circuit: { include: { tournament: true } } } },
      result: true,
      sets: { orderBy: { setNumber: 'asc' } },
    },
  });

  const esPartidoDeSerie = existingMatch.serieId &&
    !existingMatch.serieId.includes('reduccion') &&
    !existingMatch.serieId.includes('repechaje') &&
    (existingMatch.phase?.type === 'clasificatorio' || existingMatch.phase?.type === 'segunda');

  const roundBase = Math.floor(existingMatch.round / 10) * 10 + 1;
  const posEnSerie = existingMatch.round - roundBase;
  const esUltimoPartidoSerie = posEnSerie === 4;

  if (!esPartidoDeSerie || esUltimoPartidoSerie) {
    if (updatedMatch.tableId) {
      const freedTable = await prisma.table.update({
        where: { id: updatedMatch.tableId },
        data: { status: 'libre' },
        include: { venue: true },
      });
      emitTableUpdate(io, freedTable);
    }
  }

  emitMatchUpdate(io, updatedMatch);

  const phaseType = existingMatch.phase?.type;

  // Generar siguiente partido de serie (clasificatorio y segunda)
  if (phaseType === 'clasificatorio' || phaseType === 'segunda') {
    await generarSiguientePartidoSerie(matchId);
  }

  // Rellenar repechaje si terminó cruce 16 o 17
  if (phaseType === 'clasificatorio' &&
    (existingMatch.serieId === 'clasif-reduccion-16' || existingMatch.serieId === 'clasif-reduccion-17')) {
    await rellenarRepechaje(matchId);
  }

  // Rellenar slot de Segunda si terminó cruce de reducción 1-15
  if (phaseType === 'clasificatorio') {
    const mCruce = existingMatch.serieId?.match(/^clasif-reduccion-(\d+)$/);
    if (mCruce && parseInt(mCruce[1]) <= 15) {
      await rellenarSlotSegunda(matchId);
    }
  }

  // Rellenar slot #16 de Segunda si terminó el repechaje
  if (phaseType === 'clasificatorio' && existingMatch.serieId === 'clasif-repechaje' && winnerId) {
    await rellenarSlotSegundaConRepechaje(winnerId);
  }

  res.json({ match: updatedMatch, result });
});

router.post('/auto-assign', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const { matchId, venueId } = req.body;

  const freeTable = await prisma.table.findFirst({
    where: { status: 'libre', ...(venueId ? { venueId: Number(venueId) } : {}) },
    orderBy: [{ venueId: 'asc' }, { number: 'asc' }],
  });

  if (!freeTable) return res.status(409).json({ error: 'No hay mesas libres disponibles' }) as any;

  await prisma.table.update({ where: { id: freeTable.id }, data: { status: 'ocupada' } });

  const match = await prisma.match.update({
    where: { id: matchId },
    data: { tableId: freeTable.id, status: 'asignado' },
    include: {
      playerA: { include: { category: true } },
      playerB: { include: { category: true } },
      table: { include: { venue: true } },
      phase: { include: { circuit: { include: { tournament: true } } } },
      result: true,
      sets: { orderBy: { setNumber: 'asc' } },
    },
  });

  emitMatchUpdate(io, match);
  emitTableUpdate(io, { ...freeTable, status: 'ocupada' });
  res.json(match);
});

export default router;
