import { Router, Response } from 'express';
import prisma from '../services/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { io } from '../index';
import { emitMatchUpdate, emitTableUpdate } from '../services/socketService';
import { generarReporteCruce, generarReporteSerie } from '../services/reportService';
import { calcularYGuardarAcumulado } from './acumulado';

const router = Router();

interface PlayerStats {
  wins: number;
  sets: number;
  ptsFor: number;
  ptsAgainst: number;
}

interface ClasificadoStats {
  playerId: number;
  puntos: number;
  setsGanados: number;
  tantosAFavor: number;
  tantosEnContra: number;
}

async function avanzarBracketMaster(matchId: number) {
  try {
    const match = await prisma.match.findUnique({ where: { id: matchId }, include: { result: true } });
    if (!match || !match.result?.winnerId) return;

    const round = match.round;
    const winnerId = match.result.winnerId;
    let slotLabel: string | null = null;

    if (round >= 1 && round <= 16) slotLabel = `Gan. Cruce Master ${round}`;
    else if (round >= 17 && round <= 24) slotLabel = `Gan. Octavos ${round}`;
    else if (round >= 25 && round <= 28) slotLabel = `Gan. Cuartos ${round}`;
    else if (round >= 29 && round <= 30) slotLabel = `Gan. Semifinal ${round}`;

    if (!slotLabel) return;

    const nextMatch = await prisma.match.findFirst({
      where: { phaseId: match.phaseId, OR: [{ slotA: slotLabel }, { slotB: slotLabel }] }
    });
    if (!nextMatch) return;

    const esSlotA = nextMatch.slotA === slotLabel;
    await prisma.match.update({
      where: { id: nextMatch.id },
      data: esSlotA ? { playerAId: winnerId, slotA: null } : { playerBId: winnerId, slotB: null }
    });

    const actualizado = await prisma.match.findUnique({ where: { id: nextMatch.id } });
    if (actualizado?.playerAId && actualizado?.playerBId) {
      await prisma.match.update({ where: { id: nextMatch.id }, data: { status: actualizado.tableId ? 'asignado' : 'pendiente' } });
      const full = await prisma.match.findUnique({
        where: { id: nextMatch.id },
        include: { playerA: { include: { category: true } }, playerB: { include: { category: true } }, table: { include: { venue: true } }, phase: { include: { circuit: { include: { tournament: true } } } }, result: true, sets: { orderBy: { setNumber: 'asc' } } }
      });
      if (full) emitMatchUpdate(io, full);
    }
  } catch (error) { console.error('Error avanzando bracket Master:', error); }
}

async function rellenarSlotMasterConGanadorPrimera(matchId: number) {
  try {
    const match = await prisma.match.findUnique({ where: { id: matchId }, include: { result: true } });
    if (!match || !match.result?.winnerId) return;

    const todosPrimera = await prisma.match.findMany({ where: { phaseId: match.phaseId }, orderBy: { round: 'asc' } });
    const pos = todosPrimera.findIndex(m => m.id === matchId) + 1;
    if (pos === 0) return;

    const slotLabel = `Clasificado Primera #${pos}`;
    const winnerId = match.result.winnerId;

    const masterMatch = await prisma.match.findFirst({ where: { OR: [{ slotA: slotLabel }, { slotB: slotLabel }] } });
    if (!masterMatch) return;

    const esSlotA = masterMatch.slotA === slotLabel;
    await prisma.match.update({ where: { id: masterMatch.id }, data: esSlotA ? { playerAId: winnerId, slotA: null } : { playerBId: winnerId, slotB: null } });

    const actualizado = await prisma.match.findUnique({ where: { id: masterMatch.id } });
    if (actualizado?.playerAId && actualizado?.playerBId) {
      await prisma.match.update({ where: { id: masterMatch.id }, data: { status: actualizado.tableId ? 'asignado' : 'pendiente' } });
      const full = await prisma.match.findUnique({
        where: { id: masterMatch.id },
        include: { playerA: { include: { category: true } }, playerB: { include: { category: true } }, table: { include: { venue: true } }, phase: { include: { circuit: { include: { tournament: true } } } }, result: true, sets: { orderBy: { setNumber: 'asc' } } }
      });
      if (full) emitMatchUpdate(io, full);
    }
  } catch (error) { console.error('Error rellenando slot de Master:', error); }
}

async function rellenarSlotsMaster(phaseId: number) {
  try {
    const matchesPrimera = await prisma.match.findMany({ where: { phaseId }, include: { result: true }, orderBy: { round: 'asc' } });
    if (matchesPrimera.length === 0) return;

    let pos = 1;
    for (const match of matchesPrimera) {
      if (!match.result?.winnerId) { pos++; continue; }
      const slotLabel = `Clasificado Primera #${pos}`;
      const winnerId = match.result.winnerId;
      const masterMatch = await prisma.match.findFirst({ where: { OR: [{ slotA: slotLabel }, { slotB: slotLabel }] } });
      if (!masterMatch) { pos++; continue; }

      const esSlotA = masterMatch.slotA === slotLabel;
      await prisma.match.update({ where: { id: masterMatch.id }, data: esSlotA ? { playerAId: winnerId, slotA: null } : { playerBId: winnerId, slotB: null } });

      const actualizado = await prisma.match.findUnique({ where: { id: masterMatch.id } });
      if (actualizado?.playerAId && actualizado?.playerBId) {
        await prisma.match.update({ where: { id: masterMatch.id }, data: { status: actualizado.tableId ? 'asignado' : 'pendiente' } });
        const full = await prisma.match.findUnique({
          where: { id: masterMatch.id },
          include: { playerA: { include: { category: true } }, playerB: { include: { category: true } }, table: { include: { venue: true } }, phase: { include: { circuit: { include: { tournament: true } } } }, result: true, sets: { orderBy: { setNumber: 'asc' } } }
        });
        if (full) emitMatchUpdate(io, full);
      }
      pos++;
    }
  } catch (error) { console.error('Error rellenando slots de Master:', error); }
}

async function rellenarSlotsPrimera(phaseId: number) {
  try {
    const todasLasSeries = await prisma.match.findMany({ where: { phaseId, serieId: { startsWith: 'segunda-serie-' } }, include: { result: true }, orderBy: { round: 'asc' } });

    const seriesMap: Record<string, any[]> = {};
    for (const m of todasLasSeries) {
      if (!m.serieId) continue;
      if (!seriesMap[m.serieId]) seriesMap[m.serieId] = [];
      seriesMap[m.serieId].push(m);
    }

    for (const serieId of Object.keys(seriesMap)) {
      const partidos = seriesMap[serieId];
      const roundBase = Math.min(...partidos.map((p: any) => p.round));
      const p5 = partidos.find((p: any) => p.round === roundBase + 4);
      if (!p5 || !p5.result?.winnerId) return;
    }

    const clasificados: ClasificadoStats[] = [];

    for (const serieId of Object.keys(seriesMap)) {
      const partidos = seriesMap[serieId];
      const roundBase = Math.min(...partidos.map((p: any) => p.round));

      const jugadoresIds: Set<number> = new Set();
      for (const p of partidos) {
        if (p.playerAId) jugadoresIds.add(p.playerAId);
        if (p.playerBId) jugadoresIds.add(p.playerBId);
      }

      const statsJugador: Record<number, PlayerStats> = {};
      for (const id of jugadoresIds) statsJugador[id] = { wins: 0, sets: 0, ptsFor: 0, ptsAgainst: 0 };

      for (const partido of partidos) {
        if (!partido.result) continue;
        const { winnerId, setsA, setsB, pointsA, pointsB } = partido.result;
        const pA = partido.playerAId; const pB = partido.playerBId;
        if (pA && statsJugador[pA]) { statsJugador[pA].wins += winnerId === pA ? 1 : 0; statsJugador[pA].sets += setsA; statsJugador[pA].ptsFor += pointsA; statsJugador[pA].ptsAgainst += pointsB; }
        if (pB && statsJugador[pB]) { statsJugador[pB].wins += winnerId === pB ? 1 : 0; statsJugador[pB].sets += setsB; statsJugador[pB].ptsFor += pointsB; statsJugador[pB].ptsAgainst += pointsA; }
      }

      const p3 = partidos.find((p: any) => p.round === roundBase + 2);
      const p5 = partidos.find((p: any) => p.round === roundBase + 4);

      if (p3?.result?.winnerId) {
        const s = statsJugador[p3.result.winnerId] ?? { wins: 0, sets: 0, ptsFor: 0, ptsAgainst: 0 };
        clasificados.push({ playerId: p3.result.winnerId, puntos: 8, setsGanados: s.sets, tantosAFavor: s.ptsFor, tantosEnContra: s.ptsAgainst });
      }
      if (p5?.result?.winnerId) {
        const s = statsJugador[p5.result.winnerId] ?? { wins: 0, sets: 0, ptsFor: 0, ptsAgainst: 0 };
        clasificados.push({ playerId: p5.result.winnerId, puntos: 6, setsGanados: s.sets, tantosAFavor: s.ptsFor, tantosEnContra: s.ptsAgainst });
      }
    }

    clasificados.sort((a, b) => {
      if (b.puntos !== a.puntos) return b.puntos - a.puntos;
      if (b.setsGanados !== a.setsGanados) return b.setsGanados - a.setsGanados;
      if (b.tantosAFavor !== a.tantosAFavor) return b.tantosAFavor - a.tantosAFavor;
      return a.tantosEnContra - b.tantosEnContra;
    });

    for (let i = 0; i < clasificados.length; i++) {
      const slotLabel = `Clasificado Segunda #${i + 1}`;
      const winnerId = clasificados[i].playerId;
      const primeraMatch = await prisma.match.findFirst({ where: { OR: [{ slotA: slotLabel }, { slotB: slotLabel }] } });
      if (!primeraMatch) continue;

      const esSlotA = primeraMatch.slotA === slotLabel;
      await prisma.match.update({ where: { id: primeraMatch.id }, data: esSlotA ? { playerAId: winnerId, slotA: null } : { playerBId: winnerId, slotB: null } });

      const actualizado = await prisma.match.findUnique({ where: { id: primeraMatch.id } });
      if (actualizado?.playerAId && actualizado?.playerBId) {
        await prisma.match.update({ where: { id: primeraMatch.id }, data: { status: actualizado.tableId ? 'asignado' : 'pendiente' } });
        const full = await prisma.match.findUnique({
          where: { id: primeraMatch.id },
          include: { playerA: { include: { category: true } }, playerB: { include: { category: true } }, table: { include: { venue: true } }, phase: { include: { circuit: { include: { tournament: true } } } }, result: true, sets: { orderBy: { setNumber: 'asc' } } }
        });
        if (full) emitMatchUpdate(io, full);
      }
    }
  } catch (error) { console.error('Error rellenando slots de Primera:', error); }
}

async function rellenarSlotSegunda(matchId: number) {
  try {
    const match = await prisma.match.findUnique({ where: { id: matchId }, include: { result: true } });
    if (!match || !match.result?.winnerId || !match.serieId) return;

    const mReduccion = match.serieId.match(/^clasif-reduccion-(\d+)$/);
    if (!mReduccion) return;
    const cruceNum = parseInt(mReduccion[1]);
    if (cruceNum > 15) return;

    const slotLabel = `Clasificado Clasif. #${cruceNum}`;
    const winnerId = match.result.winnerId;
    const segundaMatch = await prisma.match.findFirst({ where: { OR: [{ slotA: slotLabel }, { slotB: slotLabel }] } });
    if (!segundaMatch) return;

    const esSlotA = segundaMatch.slotA === slotLabel;
    await prisma.match.update({ where: { id: segundaMatch.id }, data: esSlotA ? { playerAId: winnerId, slotA: null } : { playerBId: winnerId, slotB: null } });

    const actualizado = await prisma.match.findUnique({ where: { id: segundaMatch.id } });
    if (actualizado?.playerAId && actualizado?.playerBId) {
      await prisma.match.update({ where: { id: segundaMatch.id }, data: { status: actualizado.tableId ? 'asignado' : 'pendiente' } });
      const full = await prisma.match.findUnique({
        where: { id: segundaMatch.id },
        include: { playerA: { include: { category: true } }, playerB: { include: { category: true } }, table: { include: { venue: true } }, phase: { include: { circuit: { include: { tournament: true } } } }, result: true, sets: { orderBy: { setNumber: 'asc' } } }
      });
      if (full) emitMatchUpdate(io, full);
    }
  } catch (error) { console.error('Error rellenando slot de Segunda:', error); }
}

async function rellenarSlotSegundaConRepechaje(winnerId: number) {
  try {
    const slotLabel = 'Clasificado Clasif. #16';
    const segundaMatch = await prisma.match.findFirst({ where: { OR: [{ slotA: slotLabel }, { slotB: slotLabel }] } });
    if (!segundaMatch) return;

    const esSlotA = segundaMatch.slotA === slotLabel;
    await prisma.match.update({ where: { id: segundaMatch.id }, data: esSlotA ? { playerAId: winnerId, slotA: null } : { playerBId: winnerId, slotB: null } });

    const actualizado = await prisma.match.findUnique({ where: { id: segundaMatch.id } });
    if (actualizado?.playerAId && actualizado?.playerBId) {
      await prisma.match.update({ where: { id: segundaMatch.id }, data: { status: actualizado.tableId ? 'asignado' : 'pendiente' } });
      const full = await prisma.match.findUnique({
        where: { id: segundaMatch.id },
        include: { playerA: { include: { category: true } }, playerB: { include: { category: true } }, table: { include: { venue: true } }, phase: { include: { circuit: { include: { tournament: true } } } }, result: true, sets: { orderBy: { setNumber: 'asc' } } }
      });
      if (full) emitMatchUpdate(io, full);
    }
  } catch (error) { console.error('Error rellenando slot de Segunda con repechaje:', error); }
}

async function rellenarRepechaje(matchId: number) {
  try {
    const match = await prisma.match.findUnique({ where: { id: matchId }, include: { result: true } });
    if (!match || !match.result?.winnerId || !match.serieId) return;

    const esCruce16 = match.serieId === 'clasif-reduccion-16';
    const esCruce17 = match.serieId === 'clasif-reduccion-17';
    if (!esCruce16 && !esCruce17) return;

    const repechaje = await prisma.match.findFirst({ where: { phaseId: match.phaseId, serieId: 'clasif-repechaje' } });
    if (!repechaje) return;

    const winnerId = match.result.winnerId;
    const dataUpdate = esCruce16 ? { playerAId: winnerId, slotA: null as null } : { playerBId: winnerId, slotB: null as null };
    await prisma.match.update({ where: { id: repechaje.id }, data: dataUpdate });

    const repechajeActualizado = await prisma.match.findUnique({ where: { id: repechaje.id } });
    if (repechajeActualizado?.playerAId && repechajeActualizado?.playerBId) {
      await prisma.match.update({ where: { id: repechaje.id }, data: { status: repechajeActualizado.tableId ? 'asignado' : 'pendiente' } });
      const full = await prisma.match.findUnique({
        where: { id: repechaje.id },
        include: { playerA: { include: { category: true } }, playerB: { include: { category: true } }, table: { include: { venue: true } }, phase: { include: { circuit: { include: { tournament: true } } } }, result: true, sets: { orderBy: { setNumber: 'asc' } } }
      });
      if (full) emitMatchUpdate(io, full);
    }
  } catch (error) { console.error('Error rellenando repechaje:', error); }
}

async function rellenarCrucesReduccion(phaseId: number) {
  try {
    const todasLasSeries = await prisma.match.findMany({ where: { phaseId, serieId: { startsWith: 'clasif-serie-' } }, include: { result: true, sets: true }, orderBy: { round: 'asc' } });

    const seriesMap: Record<string, any[]> = {};
    for (const m of todasLasSeries) {
      if (!m.serieId) continue;
      if (!seriesMap[m.serieId]) seriesMap[m.serieId] = [];
      seriesMap[m.serieId].push(m);
    }

    for (const serieId of Object.keys(seriesMap)) {
      const partidos = seriesMap[serieId];
      const p5 = partidos.find((p: any) => { const rb = Math.floor(p.round / 10) * 10 + 1; return p.round === rb + 4; });
      if (!p5 || !p5.result?.winnerId) return;
    }

    const clasificados: ClasificadoStats[] = [];

    for (const serieId of Object.keys(seriesMap)) {
      const partidos = seriesMap[serieId];
      const jugadoresIds: Set<number> = new Set();
      for (const p of partidos) { if (p.playerAId) jugadoresIds.add(p.playerAId); if (p.playerBId) jugadoresIds.add(p.playerBId); }

      const statsJugador: Record<number, PlayerStats> = {};
      for (const id of jugadoresIds) statsJugador[id] = { wins: 0, sets: 0, ptsFor: 0, ptsAgainst: 0 };

      for (const partido of partidos) {
        if (!partido.result) continue;
        const { winnerId, setsA, setsB, pointsA, pointsB } = partido.result;
        const pA = partido.playerAId; const pB = partido.playerBId;
        if (pA && statsJugador[pA]) { statsJugador[pA].wins += winnerId === pA ? 1 : 0; statsJugador[pA].sets += setsA; statsJugador[pA].ptsFor += pointsA; statsJugador[pA].ptsAgainst += pointsB; }
        if (pB && statsJugador[pB]) { statsJugador[pB].wins += winnerId === pB ? 1 : 0; statsJugador[pB].sets += setsB; statsJugador[pB].ptsFor += pointsB; statsJugador[pB].ptsAgainst += pointsA; }
      }

      const jugadoresOrdenados = Array.from(jugadoresIds).filter(id => statsJugador[id]).sort((a, b) => {
        const sa = statsJugador[a]; const sb = statsJugador[b];
        if (sb.wins !== sa.wins) return sb.wins - sa.wins;
        if (sb.sets !== sa.sets) return sb.sets - sa.sets;
        if (sb.ptsFor !== sa.ptsFor) return sb.ptsFor - sa.ptsFor;
        return sa.ptsAgainst - sb.ptsAgainst;
      });

      if (jugadoresOrdenados[0]) { const s = statsJugador[jugadoresOrdenados[0]]; clasificados.push({ playerId: jugadoresOrdenados[0], puntos: 8, setsGanados: s.sets, tantosAFavor: s.ptsFor, tantosEnContra: s.ptsAgainst }); }
      if (jugadoresOrdenados[1]) { const s = statsJugador[jugadoresOrdenados[1]]; clasificados.push({ playerId: jugadoresOrdenados[1], puntos: 6, setsGanados: s.sets, tantosAFavor: s.ptsFor, tantosEnContra: s.ptsAgainst }); }
    }

    clasificados.sort((a, b) => {
      if (b.puntos !== a.puntos) return b.puntos - a.puntos;
      if (b.setsGanados !== a.setsGanados) return b.setsGanados - a.setsGanados;
      if (b.tantosAFavor !== a.tantosAFavor) return b.tantosAFavor - a.tantosAFavor;
      return a.tantosEnContra - b.tantosEnContra;
    });

    const crucesReduccion = await prisma.match.findMany({ where: { phaseId, serieId: { startsWith: 'clasif-reduccion-' } }, orderBy: { round: 'asc' } });
    const N = clasificados.length;
    for (let i = 0; i < crucesReduccion.length && i < Math.floor(N / 2); i++) {
      const cruce = crucesReduccion[i]; const jugA = clasificados[i]; const jugB = clasificados[N - 1 - i];
      if (jugA && jugB) await prisma.match.update({ where: { id: cruce.id }, data: { playerAId: jugA.playerId, playerBId: jugB.playerId, slotA: null, slotB: null, status: cruce.tableId ? 'asignado' : 'pendiente' } });
    }

    const repechaje = await prisma.match.findFirst({ where: { phaseId, serieId: 'clasif-repechaje' } });
    if (repechaje && crucesReduccion.length >= 2) {
      const ult = crucesReduccion[crucesReduccion.length - 1]; const pen = crucesReduccion[crucesReduccion.length - 2];
      await prisma.match.update({ where: { id: repechaje.id }, data: { slotA: `Ganador Cruce ${pen.round}`, slotB: `Ganador Cruce ${ult.round}` } });
    }
  } catch (error) { console.error('Error rellenando cruces de reducción:', error); }
}

async function generarSiguientePartidoSerie(matchId: number) {
  try {
    const match = await prisma.match.findUnique({ where: { id: matchId }, include: { result: true, phase: true } });
    if (!match || !match.result?.winnerId) return;

    const phaseId = match.phaseId; const round = match.round;
    const roundBase = Math.floor(round / 10) * 10 + 1; const posEnSerie = round - roundBase;
    if (posEnSerie > 3) return;

    const partidos = await prisma.match.findMany({ where: { phaseId, serieId: match.serieId }, include: { result: true }, orderBy: { round: 'asc' } });
    const p1 = partidos.find(p => p.round === roundBase); const p2 = partidos.find(p => p.round === roundBase + 1);
    const p3 = partidos.find(p => p.round === roundBase + 2); const p4 = partidos.find(p => p.round === roundBase + 3);
    const tableId = p1?.tableId ?? null; const ruleSetId = p1?.ruleSetId ?? null;

    if (posEnSerie <= 1 && p1?.result?.winnerId && p2?.result?.winnerId && !p3) {
      const newP3 = await prisma.match.create({
        data: { phaseId, playerAId: p1.result!.winnerId!, playerBId: p2.result!.winnerId!, round: roundBase + 2, status: 'asignado', serieId: match.serieId, tableId, ruleSetId },
        include: { playerA: { include: { category: true } }, playerB: { include: { category: true } }, table: { include: { venue: true } }, phase: { include: { circuit: { include: { tournament: true } } } }, result: true, ruleSet: true, sets: { orderBy: { setNumber: 'asc' } } }
      });
      const p1LoserId = p1.playerAId === p1.result!.winnerId ? p1.playerBId : p1.playerAId;
      const p2LoserId = p2.playerAId === p2.result!.winnerId ? p2.playerBId : p2.playerAId;
      if (p1LoserId && p2LoserId) {
        const newP4 = await prisma.match.create({
          data: { phaseId, playerAId: p1LoserId, playerBId: p2LoserId, round: roundBase + 3, status: 'asignado', serieId: match.serieId, tableId, ruleSetId },
          include: { playerA: { include: { category: true } }, playerB: { include: { category: true } }, table: { include: { venue: true } }, phase: { include: { circuit: { include: { tournament: true } } } }, result: true, ruleSet: true, sets: { orderBy: { setNumber: 'asc' } } }
        });
        emitMatchUpdate(io, newP4);
      }
      emitMatchUpdate(io, newP3);
    }

    if (posEnSerie >= 2 && posEnSerie <= 3 && p3?.result?.winnerId && p4?.result?.winnerId && !partidos.find(p => p.round === roundBase + 4)) {
      const p3LoserId = p3!.playerAId === p3!.result!.winnerId ? p3!.playerBId : p3!.playerAId;
      if (p3LoserId && p4!.result!.winnerId) {
        const newP5 = await prisma.match.create({
          data: { phaseId, playerAId: p3LoserId, playerBId: p4!.result!.winnerId!, round: roundBase + 4, status: 'asignado', serieId: match.serieId, tableId, ruleSetId },
          include: { playerA: { include: { category: true } }, playerB: { include: { category: true } }, table: { include: { venue: true } }, phase: { include: { circuit: { include: { tournament: true } } } }, result: true, ruleSet: true, sets: { orderBy: { setNumber: 'asc' } } }
        });
        emitMatchUpdate(io, newP5);
      }
    }
  } catch (error) { console.error('Error generando siguiente partido de serie:', error); }
}

// -------------------------------------------------------
// ENDPOINTS
// -------------------------------------------------------

router.post('/trigger-reduccion/:phaseId', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try { await rellenarCrucesReduccion(parseInt(req.params.phaseId)); res.json({ message: 'Cruces de reducción rellenados correctamente' }); }
  catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.post('/trigger-segunda/:phaseId', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try { await rellenarSlotsPrimera(parseInt(req.params.phaseId)); res.json({ message: 'Slots de Primera rellenados correctamente' }); }
  catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.post('/trigger-primera/:phaseId', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try { await rellenarSlotsMaster(parseInt(req.params.phaseId)); res.json({ message: 'Slots de Master rellenados correctamente' }); }
  catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.post('/trigger-master/:phaseId', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const phaseId = parseInt(req.params.phaseId);
    const crucesTerminados = await prisma.match.findMany({ where: { phaseId, round: { gte: 1, lte: 16 }, status: 'finalizado' }, include: { result: true }, orderBy: { round: 'asc' } });
    for (const match of crucesTerminados) { if (match.result?.winnerId) await avanzarBracketMaster(match.id); }
    res.json({ message: `Octavos rellenados con ${crucesTerminados.length} ganadores` });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

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
      result: true, ruleSet: true,
      sets: { orderBy: { setNumber: 'asc' } },
    },
    orderBy: [{ phase: { order: 'asc' } }, { scheduledAt: 'asc' }, { round: 'asc' }, { createdAt: 'asc' }],
  });
  res.json(matches);
});

router.get('/active', async (_req, res: Response) => {
  const matches = await prisma.match.findMany({
    where: { status: { in: ['asignado', 'en_juego'] } },
    include: { playerA: { include: { category: true } }, playerB: { include: { category: true } }, table: { include: { venue: true } }, phase: { include: { circuit: { include: { tournament: true } } } }, result: true, sets: { orderBy: { setNumber: 'asc' } } },
    orderBy: { updatedAt: 'desc' },
  });
  res.json(matches);
});

router.get('/:id', async (req, res: Response) => {
  const match = await prisma.match.findUnique({
    where: { id: Number(req.params.id) },
    include: { playerA: { include: { category: true } }, playerB: { include: { category: true } }, table: { include: { venue: true } }, phase: { include: { circuit: { include: { tournament: true } } } }, result: true, ruleSet: true, sets: { orderBy: { setNumber: 'asc' } } },
  });
  if (!match) return res.status(404).json({ error: 'Partido no encontrado' }) as any;
  res.json(match);
});

router.put('/:id', authenticate, requireRole('admin', 'juez_sede'), async (req: AuthRequest, res: Response) => {
  const { scheduledAt } = req.body;
  const match = await prisma.match.update({
    where: { id: Number(req.params.id) },
    data: { scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined },
    include: { playerA: { include: { category: true } }, playerB: { include: { category: true } }, table: { include: { venue: true } }, phase: { include: { circuit: { include: { tournament: true } } } }, result: true, sets: { orderBy: { setNumber: 'asc' } } },
  });
  emitMatchUpdate(io, match);
  res.json(match);
});

router.put('/:id/assign', authenticate, requireRole('admin', 'juez_sede'), async (req: AuthRequest, res: Response) => {
  const { tableId } = req.body; const matchId = Number(req.params.id);
  await prisma.table.update({ where: { id: tableId }, data: { status: 'ocupada' } });
  const match = await prisma.match.update({
    where: { id: matchId }, data: { tableId, status: 'asignado' },
    include: { playerA: { include: { category: true } }, playerB: { include: { category: true } }, table: { include: { venue: true } }, phase: { include: { circuit: { include: { tournament: true } } } }, result: true, sets: { orderBy: { setNumber: 'asc' } } },
  });
  emitMatchUpdate(io, match);
  if (match.table) emitTableUpdate(io, match.table);
  res.json(match);
});

router.put('/:id/start', authenticate, requireRole('admin', 'juez_sede'), async (req: AuthRequest, res: Response) => {
  const match = await prisma.match.update({
    where: { id: Number(req.params.id) }, data: { status: 'en_juego', startedAt: new Date() },
    include: { playerA: { include: { category: true } }, playerB: { include: { category: true } }, table: { include: { venue: true } }, phase: { include: { circuit: { include: { tournament: true } } } }, result: true, sets: { orderBy: { setNumber: 'asc' } } },
  });
  emitMatchUpdate(io, match);
  res.json(match);
});

router.put('/:id/set', authenticate, requireRole('admin', 'juez_sede'), async (req: AuthRequest, res: Response) => {
  const matchId = Number(req.params.id); const { setNumber, pointsA, pointsB } = req.body;
  const existingMatch = await prisma.match.findUnique({ where: { id: matchId }, include: { ruleSet: true, sets: true } });
  if (!existingMatch) return res.status(404).json({ error: 'Partido no encontrado' }) as any;

  const winnerId = pointsA > pointsB ? existingMatch.playerAId : existingMatch.playerBId;
  await prisma.setResult.upsert({ where: { id: (existingMatch.sets.find(s => s.setNumber === setNumber)?.id ?? 0) }, create: { matchId, setNumber, pointsA, pointsB, winnerId }, update: { pointsA, pointsB, winnerId } });

  const allSets = await prisma.setResult.findMany({ where: { matchId }, orderBy: { setNumber: 'asc' } });
  const setsA = allSets.filter(s => s.pointsA > s.pointsB).length; const setsB = allSets.filter(s => s.pointsB > s.pointsA).length;
  const totalPtsA = allSets.reduce((acc, s) => acc + s.pointsA, 0); const totalPtsB = allSets.reduce((acc, s) => acc + s.pointsB, 0);
  await prisma.matchResult.upsert({ where: { matchId }, create: { matchId, setsA, setsB, pointsA: totalPtsA, pointsB: totalPtsB, isWO: false }, update: { setsA, setsB, pointsA: totalPtsA, pointsB: totalPtsB } });

  const updatedMatch = await prisma.match.findUnique({ where: { id: matchId }, include: { playerA: { include: { category: true } }, playerB: { include: { category: true } }, table: { include: { venue: true } }, phase: { include: { circuit: { include: { tournament: true } } } }, result: true, ruleSet: true, sets: { orderBy: { setNumber: 'asc' } } } });
  emitMatchUpdate(io, updatedMatch);
  res.json(updatedMatch);
});

router.put('/:id/result', authenticate, requireRole('admin', 'juez_sede'), async (req: AuthRequest, res: Response) => {
  const matchId = Number(req.params.id);
  const { setsA, setsB, pointsA, pointsB, isWO, woPlayerId, notes, sets } = req.body;

  const existingMatch = await prisma.match.findUnique({
    where: { id: matchId },
    include: { ruleSet: true, phase: { include: { circuit: { include: { tournament: true } } } } }
  });
  if (!existingMatch) return res.status(404).json({ error: 'Partido no encontrado' }) as any;

  const ruleSet = existingMatch.ruleSet;
  let finalSetsA = setsA, finalSetsB = setsB, finalPtsA = pointsA, finalPtsB = pointsB;
  let winnerId: number | null = null;

  if (isWO) {
    const absentId = woPlayerId;
    winnerId = absentId === existingMatch.playerAId ? existingMatch.playerBId : existingMatch.playerAId;
    if (ruleSet) {
      if (absentId === existingMatch.playerAId) { finalSetsA = ruleSet.woSetsLoser; finalSetsB = ruleSet.woSetsWinner; finalPtsA = ruleSet.woPtsLoser; finalPtsB = ruleSet.woPtsWinner; }
      else { finalSetsA = ruleSet.woSetsWinner; finalSetsB = ruleSet.woSetsLoser; finalPtsA = ruleSet.woPtsWinner; finalPtsB = ruleSet.woPtsLoser; }
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
    await prisma.setResult.createMany({ data: sets.map((s: any) => ({ matchId, setNumber: s.setNumber, pointsA: s.pointsA, pointsB: s.pointsB, winnerId: s.pointsA > s.pointsB ? existingMatch.playerAId : existingMatch.playerBId })) });
  }

  const updatedMatch = await prisma.match.update({
    where: { id: matchId }, data: { status: isWO ? 'wo' : 'finalizado', finishedAt: new Date() },
    include: { playerA: { include: { category: true } }, playerB: { include: { category: true } }, table: { include: { venue: true } }, phase: { include: { circuit: { include: { tournament: true } } } }, result: true, sets: { orderBy: { setNumber: 'asc' } } },
  });

  const esPartidoDeSerie = existingMatch.serieId !== null && !existingMatch.serieId.includes('reduccion') && !existingMatch.serieId.includes('repechaje') && (existingMatch.phase?.type === 'clasificatorio' || existingMatch.phase?.type === 'segunda');
  const roundBase = Math.floor(existingMatch.round / 10) * 10 + 1;
  const posEnSerie = existingMatch.round - roundBase;
  const esUltimoPartidoSerie = posEnSerie === 4;

  if (!esPartidoDeSerie || esUltimoPartidoSerie) {
    if (updatedMatch.tableId) {
      const freedTable = await prisma.table.update({ where: { id: updatedMatch.tableId }, data: { status: 'libre' }, include: { venue: true } });
      emitTableUpdate(io, freedTable);
    }
  }

  emitMatchUpdate(io, updatedMatch);

  const phaseType = existingMatch.phase?.type;

  if (phaseType === 'clasificatorio' || phaseType === 'segunda') await generarSiguientePartidoSerie(matchId);
  if (phaseType === 'clasificatorio' && existingMatch.serieId?.startsWith('clasif-serie-') && posEnSerie === 4) await rellenarCrucesReduccion(existingMatch.phaseId);
  if (phaseType === 'segunda' && existingMatch.serieId?.startsWith('segunda-serie-') && posEnSerie === 4) await rellenarSlotsPrimera(existingMatch.phaseId);
  if (phaseType === 'primera') await rellenarSlotMasterConGanadorPrimera(matchId);
  if (phaseType === 'master') await avanzarBracketMaster(matchId);
  if (phaseType === 'clasificatorio' && (existingMatch.serieId === 'clasif-reduccion-16' || existingMatch.serieId === 'clasif-reduccion-17')) await rellenarRepechaje(matchId);
  if (phaseType === 'clasificatorio' && existingMatch.serieId) {
    const mCruce = existingMatch.serieId.match(/^clasif-reduccion-(\d+)$/);
    if (mCruce && parseInt(mCruce[1]) <= 15) await rellenarSlotSegunda(matchId);
  }
  if (phaseType === 'clasificatorio' && existingMatch.serieId === 'clasif-repechaje' && winnerId !== null) await rellenarSlotSegundaConRepechaje(winnerId);

  // ── TRIGGER ACUMULADO ──────────────────────────────────────────
  // Si es un partido de la fase Master, verificar si es el último
  // y recalcular el ranking acumulado del torneo
  if (phaseType === 'master') {
    try {
      const phaseId = existingMatch.phaseId;
      const totalMaster   = await prisma.match.count({ where: { phaseId } });
      const finishedMaster = await prisma.match.count({
        where: { phaseId, status: { in: ['finalizado', 'wo'] } }
      });
      if (totalMaster > 0 && totalMaster === finishedMaster) {
        const tournamentId = existingMatch.phase?.circuit?.tournament?.id;
        if (tournamentId) {
          await calcularYGuardarAcumulado(tournamentId);
        }
      }
    } catch (acumError) {
      console.error('Error calculando acumulado (no crítico):', acumError);
    }
  }
  // ──────────────────────────────────────────────────────────────

  try {
    if ((phaseType === 'clasificatorio' || phaseType === 'segunda') && esPartidoDeSerie && posEnSerie === 4 && existingMatch.serieId) {
      await generarReporteSerie(existingMatch.phaseId, existingMatch.serieId);
    } else if (phaseType === 'primera' || phaseType === 'master' || (phaseType === 'clasificatorio' && !esPartidoDeSerie)) {
      await generarReporteCruce(matchId);
    }
  } catch (reportError) {
    console.error('Error generando reporte (no crítico):', reportError);
  }

  res.json({ match: updatedMatch, result });
});

router.post('/auto-assign', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const { matchId, venueId } = req.body;
  const freeTable = await prisma.table.findFirst({ where: { status: 'libre', ...(venueId ? { venueId: Number(venueId) } : {}) }, orderBy: [{ venueId: 'asc' }, { number: 'asc' }] });
  if (!freeTable) return res.status(409).json({ error: 'No hay mesas libres disponibles' }) as any;

  await prisma.table.update({ where: { id: freeTable.id }, data: { status: 'ocupada' } });
  const match = await prisma.match.update({
    where: { id: matchId }, data: { tableId: freeTable.id, status: 'asignado' },
    include: { playerA: { include: { category: true } }, playerB: { include: { category: true } }, table: { include: { venue: true } }, phase: { include: { circuit: { include: { tournament: true } } } }, result: true, sets: { orderBy: { setNumber: 'asc' } } },
  });
  emitMatchUpdate(io, match);
  emitTableUpdate(io, { ...freeTable, status: 'ocupada' });
  res.json(match);
});

export default router;
