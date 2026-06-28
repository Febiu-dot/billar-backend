import { Router, Response } from 'express';
import prisma from '../services/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { io } from '../index';
import { emitMatchUpdate, emitTableUpdate } from '../services/socketService';
import { generarReporteCruce, generarReporteSerie } from '../services/reportService';
import { calcularYGuardarAcumulado } from './rankingAcumulado';

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

async function getCircuitInfo(phaseId: number): Promise<{ circuitId: number; cuposDesdeClasif: number; esNacional: boolean; formato: string }> {
  try {
    const phase = await prisma.phase.findUnique({ where: { id: phaseId }, include: { circuit: true } });
    const config = (phase?.circuit as any)?.configTorneo as any;
    return { circuitId: phase?.circuitId ?? 0, cuposDesdeClasif: config?.cuposDesdeClasif ?? 16, esNacional: config?.tipo === 'nacional' || config?.tipo === 'panamericano', formato: config?.formato ?? '32' };
  } catch { return { circuitId: 0, cuposDesdeClasif: 16, esNacional: false, formato: '32' }; }
}

async function sumarPuntosRanking(playerId: number, circuitId: number, puntos: number) {
  if (!playerId || !circuitId || puntos === 0) return;
  try { await prisma.rankingEntry.updateMany({ where: { playerId, circuitId }, data: { points: { increment: puntos } } }); }
  catch (e) { console.error('Error sumando puntos ranking:', e); }
}

async function asignarPuntosSerie(phaseId: number, serieId: string) {
  try {
    if (serieId.includes('reduccion') || serieId.includes('repechaje')) return;
    const { circuitId } = await getCircuitInfo(phaseId);
    if (!circuitId) return;
    const partidos = await prisma.match.findMany({ where: { phaseId, serieId }, include: { result: true }, orderBy: { round: 'asc' } });
    const roundBase = Math.min(...partidos.map(p => p.round));
    const p3 = partidos.find(p => p.round === roundBase + 2);
    const p4 = partidos.find(p => p.round === roundBase + 3);
    const p5 = partidos.find(p => p.round === roundBase + 4);
    if (!p5?.result) return;
    const primero = p3?.result?.winnerId;
    const segundo = p5?.result?.winnerId;
    const tercero = p5 ? (p5.playerAId === p5.result?.winnerId ? p5.playerBId : p5.playerAId) : null;
    const cuarto  = p4?.result ? (p4.playerAId === p4.result?.winnerId ? p4.playerBId : p4.playerAId) : null;
    if (primero) await sumarPuntosRanking(primero, circuitId, 8);
    if (segundo) await sumarPuntosRanking(segundo, circuitId, 6);
    if (tercero) await sumarPuntosRanking(tercero, circuitId, 4);
    if (cuarto)  await sumarPuntosRanking(cuarto,  circuitId, 2);
  } catch (e) { console.error('Error asignando puntos de serie:', e); }
}

async function asignarPuntosCruce(matchId: number) {
  try {
    const match = await prisma.match.findUnique({ where: { id: matchId }, include: { result: true, phase: true } });
    if (!match || !match.result) return;
    if (match.serieId?.includes('reduccion') || match.serieId?.includes('repechaje')) return;
    const { circuitId } = await getCircuitInfo(match.phaseId);
    if (!circuitId) return;
    const isWO = match.result.isWO;
    const winnerId = match.result.winnerId;
    const loserId  = match.playerAId === winnerId ? match.playerBId : match.playerAId;
    const esFinal = match.serieId === 'master-final' || match.serieId === 'nac-final';
    if (isWO) return;
    const ptsGanador  = esFinal ? 7 : 5;
    const ptsPerdedor = esFinal ? 2 : 1;
    if (winnerId) await sumarPuntosRanking(winnerId, circuitId, ptsGanador);
    if (loserId)  await sumarPuntosRanking(loserId,  circuitId, ptsPerdedor);
  } catch (e) { console.error('Error asignando puntos de cruce:', e); }
}

const NAC_BRACKET: Record<string, { winner?: { to: string; slot: 'A' | 'B' } }> = {
  'nac-oct-1': { winner: { to: 'nac-cua-1', slot: 'A' } },
  'nac-oct-2': { winner: { to: 'nac-cua-1', slot: 'B' } },
  'nac-oct-3': { winner: { to: 'nac-cua-2', slot: 'A' } },
  'nac-oct-4': { winner: { to: 'nac-cua-2', slot: 'B' } },
  'nac-oct-5': { winner: { to: 'nac-cua-3', slot: 'A' } },
  'nac-oct-6': { winner: { to: 'nac-cua-3', slot: 'B' } },
  'nac-oct-7': { winner: { to: 'nac-cua-4', slot: 'A' } },
  'nac-oct-8': { winner: { to: 'nac-cua-4', slot: 'B' } },
  'nac-cua-1': { winner: { to: 'nac-semi-1', slot: 'A' } },
  'nac-cua-2': { winner: { to: 'nac-semi-1', slot: 'B' } },
  'nac-cua-3': { winner: { to: 'nac-semi-2', slot: 'A' } },
  'nac-cua-4': { winner: { to: 'nac-semi-2', slot: 'B' } },
  'nac-semi-1': { winner: { to: 'nac-final', slot: 'A' } },
  'nac-semi-2': { winner: { to: 'nac-final', slot: 'B' } },
  'nac-final': {},
};

async function checkAndEmitMatch(matchId: number) {
  try {
    const match = await prisma.match.findUnique({ where: { id: matchId } });
    if (match?.playerAId && match?.playerBId) {
      const full = await prisma.match.findUnique({
        where: { id: matchId },
        include: { playerA: { include: { category: true } }, playerB: { include: { category: true } }, table: { include: { venue: true } }, phase: { include: { circuit: { include: { tournament: true } } } }, result: true, sets: { orderBy: { setNumber: 'asc' } } }
      });
      if (full) emitMatchUpdate(io, full);
    }
  } catch (e) { console.error('Error en checkAndEmitMatch:', e); }
}

async function avanzarBracketNacional(matchId: number) {
  try {
    const match = await prisma.match.findUnique({ where: { id: matchId }, include: { result: true } });
    if (!match || !match.result?.winnerId || !match.serieId) return;
    const routing = NAC_BRACKET[match.serieId];
    if (!routing) return;
    const winnerId = match.result.winnerId;
    if (routing.winner) { await fillNacSlot(match.phaseId, routing.winner.to, routing.winner.slot, winnerId); }
  } catch (error) { console.error('Error avanzando bracket Nacional:', error); }
}

async function fillNacSlot(phaseId: number, serieId: string, slot: 'A' | 'B', playerId: number) {
  try {
    const targetMatch = await prisma.match.findFirst({ where: { phaseId, serieId } });
    if (!targetMatch) return;
    const update = slot === 'A' ? { playerAId: playerId, slotA: null as null } : { playerBId: playerId, slotB: null as null };
    await prisma.match.update({ where: { id: targetMatch.id }, data: update });
    await checkAndEmitMatch(targetMatch.id);
  } catch (error) { console.error('Error filling Nacional slot:', error); }
}

async function propagarSerieNacional(matchId: number) {
  try {
    const match = await prisma.match.findUnique({ where: { id: matchId }, include: { result: true } });
    if (!match || !match.result?.winnerId || !match.serieId) return;
    const round     = match.round;
    const roundBase = Math.floor(round / 10) * 10 + 1;
    const pos       = round - roundBase;
    const winnerId = match.result.winnerId;
    const loserId  = match.playerAId === winnerId ? match.playerBId : match.playerAId;
    const phaseId = match.phaseId;
    const serieId = match.serieId;
    if (pos === 0) {
      const p3 = await prisma.match.findFirst({ where: { phaseId, serieId, round: roundBase + 2 } });
      const p4 = await prisma.match.findFirst({ where: { phaseId, serieId, round: roundBase + 3 } });
      if (p3) { await prisma.match.update({ where: { id: p3.id }, data: { playerAId: winnerId, slotA: null } }); await checkAndEmitMatch(p3.id); }
      if (p4 && loserId) { await prisma.match.update({ where: { id: p4.id }, data: { playerAId: loserId, slotA: null } }); await checkAndEmitMatch(p4.id); }
    }
    if (pos === 1) {
      const p3 = await prisma.match.findFirst({ where: { phaseId, serieId, round: roundBase + 2 } });
      const p4 = await prisma.match.findFirst({ where: { phaseId, serieId, round: roundBase + 3 } });
      if (p3) { await prisma.match.update({ where: { id: p3.id }, data: { playerBId: winnerId, slotB: null } }); await checkAndEmitMatch(p3.id); }
      if (p4 && loserId) { await prisma.match.update({ where: { id: p4.id }, data: { playerBId: loserId, slotB: null } }); await checkAndEmitMatch(p4.id); }
    }
    if (pos === 2) {
      const p5 = await prisma.match.findFirst({ where: { phaseId, serieId, round: roundBase + 4 } });
      if (p5 && loserId) { await prisma.match.update({ where: { id: p5.id }, data: { playerAId: loserId, slotA: null } }); await checkAndEmitMatch(p5.id); }
    }
    if (pos === 3) {
      const p5 = await prisma.match.findFirst({ where: { phaseId, serieId, round: roundBase + 4 } });
      if (p5) { await prisma.match.update({ where: { id: p5.id }, data: { playerBId: winnerId, slotB: null } }); await checkAndEmitMatch(p5.id); }
    }
  } catch (error) { console.error('Error propagando serie Nacional:', error); }
}

// ── FIX: query sin filtro de prefijo — usa todos los partidos de la fase ──
async function rellenarBracketNacionalOctavos(clasificatorioPhaseId: number) {
  try {
    const todasLasSeries = await prisma.match.findMany({
      where: { phaseId: clasificatorioPhaseId, serieId: { not: null } },
      include: { result: true },
      orderBy: { round: 'asc' }
    });

    const seriesMap: Record<string, any[]> = {};
    for (const m of todasLasSeries) {
      if (!m.serieId) continue;
      if (!seriesMap[m.serieId]) seriesMap[m.serieId] = [];
      seriesMap[m.serieId].push(m);
    }

    const serieIds = Object.keys(seriesMap);
    if (serieIds.length < 8) return;

    for (const serieId of serieIds) {
      const partidos = seriesMap[serieId];
      const roundBase = Math.min(...partidos.map(p => p.round));
      const p5 = partidos.find(p => p.round === roundBase + 4);
      if (!p5 || !p5.result?.winnerId) return;
    }

    const clasificatorioPhase = await prisma.phase.findUnique({ where: { id: clasificatorioPhaseId }, include: { circuit: { include: { phases: true } } } });
    const masterPhase = clasificatorioPhase?.circuit?.phases.find((p: any) => p.type === 'master');
    if (!masterPhase) return;

    interface Clasificado { playerId: number; puntos: number; setsGanados: number; tantos: number; }
    const clasificados: Clasificado[] = [];

    for (const serieId of serieIds) {
      const partidos = seriesMap[serieId];
      const roundBase = Math.min(...partidos.map(p => p.round));
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
      const p3 = partidos.find(p => p.round === roundBase + 2);
      const p5 = partidos.find(p => p.round === roundBase + 4);
      if (p3?.result?.winnerId) { const s = statsJugador[p3.result.winnerId] ?? { wins: 0, sets: 0, ptsFor: 0, ptsAgainst: 0 }; clasificados.push({ playerId: p3.result.winnerId, puntos: 8, setsGanados: s.sets, tantos: s.ptsFor }); }
      if (p5?.result?.winnerId) { const s = statsJugador[p5.result.winnerId] ?? { wins: 0, sets: 0, ptsFor: 0, ptsAgainst: 0 }; clasificados.push({ playerId: p5.result.winnerId, puntos: 6, setsGanados: s.sets, tantos: s.ptsFor }); }
    }

    clasificados.sort((a, b) => { if (b.puntos !== a.puntos) return b.puntos - a.puntos; if (b.setsGanados !== a.setsGanados) return b.setsGanados - a.setsGanados; return b.tantos - a.tantos; });
    if (clasificados.length < 16) { console.error(`Solo ${clasificados.length} clasificados, se necesitan 16`); return; }

    const seedingMap: [number, number][] = [[0,15],[7,8],[4,11],[3,12],[2,13],[5,10],[6,9],[1,14]];
    for (let i = 0; i < 8; i++) {
      const [idxAlto, idxBajo] = seedingMap[i];
      const seedAlto = clasificados[idxAlto]; const seedBajo = clasificados[idxBajo];
      if (!seedAlto || !seedBajo) continue;
      const bracketMatch = await prisma.match.findFirst({ where: { phaseId: masterPhase.id, serieId: `nac-oct-${i + 1}` } });
      if (!bracketMatch) continue;
      await prisma.match.update({ where: { id: bracketMatch.id }, data: { playerAId: seedAlto.playerId, playerBId: seedBajo.playerId, slotA: null, slotB: null, status: 'pendiente' } });
      await checkAndEmitMatch(bracketMatch.id);
    }
  } catch (error) { console.error('Error rellenando bracket Nacional octavos:', error); }
}

// ── FORMATO 16: 4 series → 8 clasificados → bracket arranca en CUARTOS ──
// Seeding protegido de 8: cua-1 = 1v8, cua-2 = 4v5, cua-3 = 3v6, cua-4 = 2v7
// (los seeds #1 y #2 solo pueden cruzarse en la final)
async function rellenarBracketR16Cuartos(clasificatorioPhaseId: number) {
  try {
    const todasLasSeries = await prisma.match.findMany({
      where: { phaseId: clasificatorioPhaseId, serieId: { not: null } },
      include: { result: true },
      orderBy: { round: 'asc' }
    });

    const seriesMap: Record<string, any[]> = {};
    for (const m of todasLasSeries) {
      if (!m.serieId) continue;
      if (!seriesMap[m.serieId]) seriesMap[m.serieId] = [];
      seriesMap[m.serieId].push(m);
    }

    const serieIds = Object.keys(seriesMap);
    if (serieIds.length < 4) return;

    for (const serieId of serieIds) {
      const partidos = seriesMap[serieId];
      const roundBase = Math.min(...partidos.map(p => p.round));
      const p5 = partidos.find(p => p.round === roundBase + 4);
      if (!p5 || !p5.result?.winnerId) return;
    }

    const clasificatorioPhase = await prisma.phase.findUnique({ where: { id: clasificatorioPhaseId }, include: { circuit: { include: { phases: true } } } });
    const masterPhase = clasificatorioPhase?.circuit?.phases.find((p: any) => p.type === 'master');
    if (!masterPhase) return;

    interface Clasificado { playerId: number; puntos: number; setsGanados: number; tantos: number; }
    const clasificados: Clasificado[] = [];

    for (const serieId of serieIds) {
      const partidos = seriesMap[serieId];
      const roundBase = Math.min(...partidos.map(p => p.round));
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
      const p3 = partidos.find(p => p.round === roundBase + 2);
      const p5 = partidos.find(p => p.round === roundBase + 4);
      if (p3?.result?.winnerId) { const s = statsJugador[p3.result.winnerId] ?? { wins: 0, sets: 0, ptsFor: 0, ptsAgainst: 0 }; clasificados.push({ playerId: p3.result.winnerId, puntos: 8, setsGanados: s.sets, tantos: s.ptsFor }); }
      if (p5?.result?.winnerId) { const s = statsJugador[p5.result.winnerId] ?? { wins: 0, sets: 0, ptsFor: 0, ptsAgainst: 0 }; clasificados.push({ playerId: p5.result.winnerId, puntos: 6, setsGanados: s.sets, tantos: s.ptsFor }); }
    }

    clasificados.sort((a, b) => { if (b.puntos !== a.puntos) return b.puntos - a.puntos; if (b.setsGanados !== a.setsGanados) return b.setsGanados - a.setsGanados; return b.tantos - a.tantos; });
    if (clasificados.length < 8) { console.error(`Solo ${clasificados.length} clasificados, se necesitan 8`); return; }

    // cua-1 = seed1 vs seed8 | cua-2 = seed4 vs seed5 | cua-3 = seed3 vs seed6 | cua-4 = seed2 vs seed7
    const seedingMap: [number, number][] = [[0,7],[3,4],[2,5],[1,6]];
    for (let i = 0; i < 4; i++) {
      const [idxAlto, idxBajo] = seedingMap[i];
      const seedAlto = clasificados[idxAlto]; const seedBajo = clasificados[idxBajo];
      if (!seedAlto || !seedBajo) continue;
      const bracketMatch = await prisma.match.findFirst({ where: { phaseId: masterPhase.id, serieId: `nac-cua-${i + 1}` } });
      if (!bracketMatch) continue;
      await prisma.match.update({ where: { id: bracketMatch.id }, data: { playerAId: seedAlto.playerId, playerBId: seedBajo.playerId, slotA: null, slotB: null, status: 'pendiente' } });
      await checkAndEmitMatch(bracketMatch.id);
    }
  } catch (error) { console.error('Error rellenando bracket R16 cuartos:', error); }
}

async function getCuposDesdeClasif(phaseId: number): Promise<number> {
  const { cuposDesdeClasif } = await getCircuitInfo(phaseId);
  return cuposDesdeClasif;
}

async function avanzarBracketMaster(matchId: number) {
  try {
    const match = await prisma.match.findUnique({ where: { id: matchId }, include: { result: true } });
    if (!match || !match.result?.winnerId) return;
    const round = match.round; const winnerId = match.result.winnerId;
    let slotLabel: string | null = null;
    if (round >= 1 && round <= 16) slotLabel = `Gan. Cruce Master ${round}`;
    else if (round >= 17 && round <= 24) slotLabel = `Gan. Octavos ${round}`;
    else if (round >= 25 && round <= 28) slotLabel = `Gan. Cuartos ${round}`;
    else if (round >= 29 && round <= 30) slotLabel = `Gan. Semifinal ${round}`;
    if (!slotLabel) return;
    const nextMatch = await prisma.match.findFirst({ where: { phaseId: match.phaseId, OR: [{ slotA: slotLabel }, { slotB: slotLabel }] } });
    if (!nextMatch) return;
    const esSlotA = nextMatch.slotA === slotLabel;
    await prisma.match.update({ where: { id: nextMatch.id }, data: esSlotA ? { playerAId: winnerId, slotA: null } : { playerBId: winnerId, slotB: null } });
    const actualizado = await prisma.match.findUnique({ where: { id: nextMatch.id } });
    if (actualizado?.playerAId && actualizado?.playerBId) {
      await prisma.match.update({ where: { id: nextMatch.id }, data: { status: actualizado.tableId ? 'asignado' : 'pendiente' } });
      await checkAndEmitMatch(nextMatch.id);
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
    const slotLabel = `Clasificado Primera #${pos}`; const winnerId = match.result.winnerId;
    const masterMatch = await prisma.match.findFirst({ where: { OR: [{ slotA: slotLabel }, { slotB: slotLabel }] } });
    if (!masterMatch) return;
    const esSlotA = masterMatch.slotA === slotLabel;
    await prisma.match.update({ where: { id: masterMatch.id }, data: esSlotA ? { playerAId: winnerId, slotA: null } : { playerBId: winnerId, slotB: null } });
    const actualizado = await prisma.match.findUnique({ where: { id: masterMatch.id } });
    if (actualizado?.playerAId && actualizado?.playerBId) {
      await prisma.match.update({ where: { id: masterMatch.id }, data: { status: actualizado.tableId ? 'asignado' : 'pendiente' } });
      await checkAndEmitMatch(masterMatch.id);
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
      const slotLabel = `Clasificado Primera #${pos}`; const winnerId = match.result.winnerId;
      const masterMatch = await prisma.match.findFirst({ where: { OR: [{ slotA: slotLabel }, { slotB: slotLabel }] } });
      if (!masterMatch) { pos++; continue; }
      const esSlotA = masterMatch.slotA === slotLabel;
      await prisma.match.update({ where: { id: masterMatch.id }, data: esSlotA ? { playerAId: winnerId, slotA: null } : { playerBId: winnerId, slotB: null } });
      const actualizado = await prisma.match.findUnique({ where: { id: masterMatch.id } });
      if (actualizado?.playerAId && actualizado?.playerBId) {
        await prisma.match.update({ where: { id: masterMatch.id }, data: { status: actualizado.tableId ? 'asignado' : 'pendiente' } });
        await checkAndEmitMatch(masterMatch.id);
      }
      pos++;
    }
  } catch (error) { console.error('Error rellenando slots de Master:', error); }
}

async function rellenarSlotsPrimera(phaseId: number) {
  try {
    const todasLasSeries = await prisma.match.findMany({ where: { phaseId, serieId: { startsWith: 'segunda-serie-' } }, include: { result: true }, orderBy: { round: 'asc' } });
    const seriesMap: Record<string, any[]> = {};
    for (const m of todasLasSeries) { if (!m.serieId) continue; if (!seriesMap[m.serieId]) seriesMap[m.serieId] = []; seriesMap[m.serieId].push(m); }
    for (const serieId of Object.keys(seriesMap)) {
      const partidos = seriesMap[serieId]; const roundBase = Math.min(...partidos.map((p: any) => p.round));
      const p5 = partidos.find((p: any) => p.round === roundBase + 4);
      if (!p5 || !p5.result?.winnerId) return;
    }
    const clasificados: ClasificadoStats[] = [];
    for (const serieId of Object.keys(seriesMap)) {
      const partidos = seriesMap[serieId]; const roundBase = Math.min(...partidos.map((p: any) => p.round));
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
      const p3 = partidos.find((p: any) => p.round === roundBase + 2); const p5 = partidos.find((p: any) => p.round === roundBase + 4);
      if (p3?.result?.winnerId) { const s = statsJugador[p3.result.winnerId] ?? { wins: 0, sets: 0, ptsFor: 0, ptsAgainst: 0 }; clasificados.push({ playerId: p3.result.winnerId, puntos: 8, setsGanados: s.sets, tantosAFavor: s.ptsFor, tantosEnContra: s.ptsAgainst }); }
      if (p5?.result?.winnerId) { const s = statsJugador[p5.result.winnerId] ?? { wins: 0, sets: 0, ptsFor: 0, ptsAgainst: 0 }; clasificados.push({ playerId: p5.result.winnerId, puntos: 6, setsGanados: s.sets, tantosAFavor: s.ptsFor, tantosEnContra: s.ptsAgainst }); }
    }
    clasificados.sort((a, b) => { if (b.puntos !== a.puntos) return b.puntos - a.puntos; if (b.setsGanados !== a.setsGanados) return b.setsGanados - a.setsGanados; if (b.tantosAFavor !== a.tantosAFavor) return b.tantosAFavor - a.tantosAFavor; return a.tantosEnContra - b.tantosEnContra; });
    for (let i = 0; i < clasificados.length; i++) {
      const slotLabel = `Clasificado Segunda #${i + 1}`; const winnerId = clasificados[i].playerId;
      const primeraMatch = await prisma.match.findFirst({ where: { OR: [{ slotA: slotLabel }, { slotB: slotLabel }] } });
      if (!primeraMatch) continue;
      const esSlotA = primeraMatch.slotA === slotLabel;
      await prisma.match.update({ where: { id: primeraMatch.id }, data: esSlotA ? { playerAId: winnerId, slotA: null } : { playerBId: winnerId, slotB: null } });
      const actualizado = await prisma.match.findUnique({ where: { id: primeraMatch.id } });
      if (actualizado?.playerAId && actualizado?.playerBId) {
        await prisma.match.update({ where: { id: primeraMatch.id }, data: { status: actualizado.tableId ? 'asignado' : 'pendiente' } });
        await checkAndEmitMatch(primeraMatch.id);
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
    const cuposDesdeClasif = await getCuposDesdeClasif(match.phaseId);
    if (cruceNum > cuposDesdeClasif - 1) return;
    const slotLabel = `Clasificado Clasif. #${cruceNum}`; const winnerId = match.result.winnerId;
    const segundaMatch = await prisma.match.findFirst({ where: { OR: [{ slotA: slotLabel }, { slotB: slotLabel }] } });
    if (!segundaMatch) return;
    const esSlotA = segundaMatch.slotA === slotLabel;
    await prisma.match.update({ where: { id: segundaMatch.id }, data: esSlotA ? { playerAId: winnerId, slotA: null } : { playerBId: winnerId, slotB: null } });
    const actualizado = await prisma.match.findUnique({ where: { id: segundaMatch.id } });
    if (actualizado?.playerAId && actualizado?.playerBId) {
      await prisma.match.update({ where: { id: segundaMatch.id }, data: { status: actualizado.tableId ? 'asignado' : 'pendiente' } });
      await checkAndEmitMatch(segundaMatch.id);
    }
  } catch (error) { console.error('Error rellenando slot de Segunda:', error); }
}

async function rellenarSlotSegundaConRepechaje(winnerId: number, phaseId: number) {
  try {
    const cuposDesdeClasif = await getCuposDesdeClasif(phaseId);
    const slotLabel = `Clasificado Clasif. #${cuposDesdeClasif}`;
    const segundaMatch = await prisma.match.findFirst({ where: { OR: [{ slotA: slotLabel }, { slotB: slotLabel }] } });
    if (!segundaMatch) return;
    const esSlotA = segundaMatch.slotA === slotLabel;
    await prisma.match.update({ where: { id: segundaMatch.id }, data: esSlotA ? { playerAId: winnerId, slotA: null } : { playerBId: winnerId, slotB: null } });
    const actualizado = await prisma.match.findUnique({ where: { id: segundaMatch.id } });
    if (actualizado?.playerAId && actualizado?.playerBId) {
      await prisma.match.update({ where: { id: segundaMatch.id }, data: { status: actualizado.tableId ? 'asignado' : 'pendiente' } });
      await checkAndEmitMatch(segundaMatch.id);
    }
  } catch (error) { console.error('Error rellenando slot de Segunda con repechaje:', error); }
}

async function rellenarRepechaje(matchId: number) {
  try {
    const match = await prisma.match.findUnique({ where: { id: matchId }, include: { result: true } });
    if (!match || !match.result?.winnerId || !match.serieId) return;
    const mReduccion = match.serieId.match(/^clasif-reduccion-(\d+)$/);
    if (!mReduccion) return;
    const cruceNum = parseInt(mReduccion[1]);
    const cuposDesdeClasif = await getCuposDesdeClasif(match.phaseId);
    const esCruceRepechajeA = cruceNum === cuposDesdeClasif; const esCruceRepechajeB = cruceNum === cuposDesdeClasif + 1;
    if (!esCruceRepechajeA && !esCruceRepechajeB) return;
    const repechaje = await prisma.match.findFirst({ where: { phaseId: match.phaseId, serieId: 'clasif-repechaje' } });
    if (!repechaje) return;
    const winnerId = match.result.winnerId;
    const dataUpdate = esCruceRepechajeA ? { playerAId: winnerId, slotA: null as null } : { playerBId: winnerId, slotB: null as null };
    await prisma.match.update({ where: { id: repechaje.id }, data: dataUpdate });
    const repechajeActualizado = await prisma.match.findUnique({ where: { id: repechaje.id } });
    if (repechajeActualizado?.playerAId && repechajeActualizado?.playerBId) {
      await prisma.match.update({ where: { id: repechaje.id }, data: { status: repechajeActualizado.tableId ? 'asignado' : 'pendiente' } });
      await checkAndEmitMatch(repechaje.id);
    }
  } catch (error) { console.error('Error rellenando repechaje:', error); }
}

async function rellenarCrucesReduccion(phaseId: number) {
  try {
    const todasLasSeries = await prisma.match.findMany({ where: { phaseId, serieId: { startsWith: 'clasif-serie-' } }, include: { result: true, sets: true }, orderBy: { round: 'asc' } });
    const seriesMap: Record<string, any[]> = {};
    for (const m of todasLasSeries) { if (!m.serieId) continue; if (!seriesMap[m.serieId]) seriesMap[m.serieId] = []; seriesMap[m.serieId].push(m); }
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
        if (sb.wins !== sa.wins) return sb.wins - sa.wins; if (sb.sets !== sa.sets) return sb.sets - sa.sets;
        if (sb.ptsFor !== sa.ptsFor) return sb.ptsFor - sa.ptsFor; return sa.ptsAgainst - sb.ptsAgainst;
      });
      if (jugadoresOrdenados[0]) { const s = statsJugador[jugadoresOrdenados[0]]; clasificados.push({ playerId: jugadoresOrdenados[0], puntos: 8, setsGanados: s.sets, tantosAFavor: s.ptsFor, tantosEnContra: s.ptsAgainst }); }
      if (jugadoresOrdenados[1]) { const s = statsJugador[jugadoresOrdenados[1]]; clasificados.push({ playerId: jugadoresOrdenados[1], puntos: 6, setsGanados: s.sets, tantosAFavor: s.ptsFor, tantosEnContra: s.ptsAgainst }); }
    }
    clasificados.sort((a, b) => { if (b.puntos !== a.puntos) return b.puntos - a.puntos; if (b.setsGanados !== a.setsGanados) return b.setsGanados - a.setsGanados; if (b.tantosAFavor !== a.tantosAFavor) return b.tantosAFavor - a.tantosAFavor; return a.tantosEnContra - b.tantosEnContra; });
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

// ── Repara slots de series nacionales/panamericanas sin depender del orden de carga ──
// Para cada serie: P5.slotA = perdedor del P3, P5.slotB = ganador del P4.
async function repararSeriesNacionales(phaseId: number) {
  const matches = await prisma.match.findMany({
    where: { phaseId, serieId: { not: null } },
    include: { result: true },
    orderBy: { round: 'asc' }
  });
  const seriesMap: Record<string, any[]> = {};
  for (const m of matches) {
    const sid = m.serieId as string;
    if (!/^nac-serie-/.test(sid) && !/^[A-Z]+-G\d+$/.test(sid)) continue;
    if (!seriesMap[sid]) seriesMap[sid] = [];
    seriesMap[sid].push(m);
  }
  let reparados = 0;
  for (const partidos of Object.values(seriesMap)) {
    const roundBase = Math.min(...partidos.map((p: any) => p.round));
    const p3 = partidos.find((p: any) => p.round === roundBase + 2);
    const p4 = partidos.find((p: any) => p.round === roundBase + 3);
    const p5 = partidos.find((p: any) => p.round === roundBase + 4);
    if (!p5) continue;

    const data: any = {};
    if (p3?.result?.winnerId) {
      const p3LoserId = p3.playerAId === p3.result.winnerId ? p3.playerBId : p3.playerAId;
      if (p3LoserId && p5.playerAId !== p3LoserId) { data.playerAId = p3LoserId; data.slotA = null; }
    }
    if (p4?.result?.winnerId) {
      if (p5.playerBId !== p4.result.winnerId) { data.playerBId = p4.result.winnerId; data.slotB = null; }
    }
    if (Object.keys(data).length > 0) {
      await prisma.match.update({ where: { id: p5.id }, data });
      await checkAndEmitMatch(p5.id);
      reparados++;
    }
  }
  return reparados;
}async function generarSiguientePartidoSerie(matchId: number) {
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

router.post('/regenerar-bracket/:circuitId', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const circuitId = parseInt(req.params.circuitId);
  try {
    const circuit = await prisma.circuit.findUnique({ where: { id: circuitId }, include: { phases: true } });
    if (!circuit) { res.status(404).json({ error: 'Circuito no encontrado' }); return; }
    const phaseMaster = circuit.phases.find((p: any) => p.type === 'master');
    if (!phaseMaster) { res.status(400).json({ error: 'No existe la fase Master en este circuito' }); return; }
    const cfg = (circuit as any).configTorneo as any;
    const formato = cfg?.formato ?? '32';
    const ruleSetCruces = cfg?.ruleSetCruces ?? 2;
    const rankingEntries = await prisma.rankingEntry.findMany({
      where: { circuitId, position: { not: null } }, include: { player: true },
      orderBy: { position: 'asc' }
    });

    // ── FORMATO 16: bracket de 8 que arranca en cuartos ────────────────
    if (formato === '16') {
      if (rankingEntries.length < 8) { res.status(400).json({ error: `Solo ${rankingEntries.length} jugadores en el ranking. Se necesitan 8.` }); return; }
      const top8 = rankingEntries.slice(0, 8);
      await prisma.setResult.deleteMany({ where: { match: { phaseId: phaseMaster.id } } });
      await prisma.matchResult.deleteMany({ where: { match: { phaseId: phaseMaster.id } } });
      await prisma.match.deleteMany({ where: { phaseId: phaseMaster.id } });
      const protegido8: [number, number][] = [[0,7],[3,4],[2,5],[1,6]];
      const bracketData: any[] = [];
      for (let i = 0; i < 4; i++) {
        const [a, b] = protegido8[i];
        bracketData.push({ phaseId: phaseMaster.id, playerAId: top8[a].playerId, playerBId: top8[b].playerId, slotA: null, slotB: null, round: 111 + i, status: 'pendiente', serieId: `nac-cua-${i + 1}`, ruleSetId: ruleSetCruces });
      }
      bracketData.push({ phaseId: phaseMaster.id, playerAId: null, playerBId: null, slotA: 'Gan. NAC-CUA-1', slotB: 'Gan. NAC-CUA-2', round: 121, status: 'pendiente', serieId: 'nac-semi-1', ruleSetId: ruleSetCruces });
      bracketData.push({ phaseId: phaseMaster.id, playerAId: null, playerBId: null, slotA: 'Gan. NAC-CUA-3', slotB: 'Gan. NAC-CUA-4', round: 122, status: 'pendiente', serieId: 'nac-semi-2', ruleSetId: ruleSetCruces });
      bracketData.push({ phaseId: phaseMaster.id, playerAId: null, playerBId: null, slotA: 'Gan. NAC-SEMI-1', slotB: 'Gan. NAC-SEMI-2', round: 131, status: 'pendiente', serieId: 'nac-final', ruleSetId: ruleSetCruces });
      await prisma.match.createMany({ data: bracketData });
      res.json({ ok: true, message: `Bracket de 8 generado con el top 8 del ranking`, partidos: bracketData.length, seeding: top8.map((e, i) => ({ seed: i+1, nombre: `${e.player.lastName}, ${e.player.firstName}`, puntos: e.points })) });
      return;
    }

    // ── FORMATO 32 (nacional estándar): bracket de 16 ──────────────────
    if (rankingEntries.length < 16) { res.status(400).json({ error: `Solo ${rankingEntries.length} jugadores en el ranking. Se necesitan 16.` }); return; }
    const top16 = rankingEntries.slice(0, 16);
    await prisma.setResult.deleteMany({ where: { match: { phaseId: phaseMaster.id } } });
    await prisma.matchResult.deleteMany({ where: { match: { phaseId: phaseMaster.id } } });
    await prisma.match.deleteMany({ where: { phaseId: phaseMaster.id } });
    const protegido: [number, number][] = [[0,15],[7,8],[4,11],[3,12],[2,13],[5,10],[6,9],[1,14]];
    const bracketData: any[] = [];
    for (let i = 0; i < 8; i++) {
      const [a, b] = protegido[i];
      bracketData.push({ phaseId: phaseMaster.id, playerAId: top16[a].playerId, playerBId: top16[b].playerId, slotA: null, slotB: null, round: 101 + i, status: 'pendiente', serieId: `nac-oct-${i + 1}`, ruleSetId: ruleSetCruces });
    }
    for (let i = 0; i < 4; i++) {
      bracketData.push({ phaseId: phaseMaster.id, playerAId: null, playerBId: null, slotA: `Gan. NAC-OCT-${i*2+1}`, slotB: `Gan. NAC-OCT-${i*2+2}`, round: 111+i, status: 'pendiente', serieId: `nac-cua-${i+1}`, ruleSetId: ruleSetCruces });
    }
    bracketData.push({ phaseId: phaseMaster.id, playerAId: null, playerBId: null, slotA: 'Gan. NAC-CUA-1', slotB: 'Gan. NAC-CUA-2', round: 121, status: 'pendiente', serieId: 'nac-semi-1', ruleSetId: ruleSetCruces });
    bracketData.push({ phaseId: phaseMaster.id, playerAId: null, playerBId: null, slotA: 'Gan. NAC-CUA-3', slotB: 'Gan. NAC-CUA-4', round: 122, status: 'pendiente', serieId: 'nac-semi-2', ruleSetId: ruleSetCruces });
    bracketData.push({ phaseId: phaseMaster.id, playerAId: null, playerBId: null, slotA: 'Gan. NAC-SEMI-1', slotB: 'Gan. NAC-SEMI-2', round: 131, status: 'pendiente', serieId: 'nac-final', ruleSetId: ruleSetCruces });
    await prisma.match.createMany({ data: bracketData });
    res.json({ ok: true, message: `Bracket generado con el top 16 del ranking`, partidos: bracketData.length, seeding: top16.map((e, i) => ({ seed: i+1, nombre: `${e.player.lastName}, ${e.player.firstName}`, puntos: e.points })) });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.post('/trigger-nac-bracket/:phaseId', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try { await rellenarBracketNacionalOctavos(parseInt(req.params.phaseId)); res.json({ message: 'Bracket Nacional octavos rellenado correctamente' }); }
  catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.post('/trigger-r16-bracket/:phaseId', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try { await rellenarBracketR16Cuartos(parseInt(req.params.phaseId)); res.json({ message: 'Bracket R16 cuartos rellenado correctamente' }); }
  catch (error: any) { res.status(500).json({ error: error.message }); }
});router.post('/trigger-reparar-series/:phaseId', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const n = await repararSeriesNacionales(parseInt(req.params.phaseId));
    res.json({ ok: true, message: `Series reparadas: ${n}` });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// ── Endpoint de recálculo de puntos de series nacionales ──────────────
router.post('/recalcular-puntos-series/:circuitId', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const circuitId = parseInt(req.params.circuitId);
  try {
    const circuit = await prisma.circuit.findUnique({ where: { id: circuitId }, include: { phases: true } });
    if (!circuit) { res.status(404).json({ error: 'Circuito no encontrado' }); return; }
    const phaseClasif = circuit.phases.find((p: any) => p.type === 'clasificatorio');
    if (!phaseClasif) { res.status(400).json({ error: 'No existe la fase clasificatorio' }); return; }

    await prisma.rankingEntry.updateMany({
      where: { circuitId },
      data: { points: 0, matchesPlayed: 0, matchesWon: 0, setsWon: 0, setsLost: 0, pointsFor: 0, pointsAgainst: 0 }
    });

    const allMatches = await prisma.match.findMany({
      where: { phaseId: phaseClasif.id, serieId: { not: null } },
      include: { result: true },
      orderBy: { round: 'asc' }
    });

    const seriesMap: Record<string, any[]> = {};
    for (const m of allMatches) { if (!m.serieId) continue; if (!seriesMap[m.serieId]) seriesMap[m.serieId] = []; seriesMap[m.serieId].push(m); }

    let seriesCalculadas = 0;
    for (const [serieId, partidos] of Object.entries(seriesMap)) {
      const roundBase = Math.min(...partidos.map((p: any) => p.round));
      const p5 = partidos.find((p: any) => p.round === roundBase + 4);
      if (!p5?.result?.winnerId) continue;
      await asignarPuntosSerie(phaseClasif.id, serieId);
      seriesCalculadas++;
    }

    res.json({ ok: true, message: `Puntos recalculados para ${seriesCalculadas} series`, circuitId });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.get('/', async (req, res: Response) => {
  const { phaseId, status, tableId, venueId, circuitId, tournamentId } = req.query;
  const matches = await prisma.match.findMany({
    where: {
      ...(phaseId      ? { phaseId: Number(phaseId) }   : {}),
      ...(status       ? { status: status as any }       : {}),
      ...(tableId      ? { tableId: Number(tableId) }    : {}),
      ...(venueId      ? { table: { venueId: Number(venueId) } } : {}),
      ...(circuitId    ? { phase: { circuitId: Number(circuitId) } } : {}),
      ...(tournamentId ? { phase: { circuit: { tournamentId: Number(tournamentId) } } } : {}),
    },
    include: { playerA: { include: { category: true } }, playerB: { include: { category: true } }, table: { include: { venue: true } }, phase: { include: { circuit: { include: { tournament: true } } } }, result: true, ruleSet: true, sets: { orderBy: { setNumber: 'asc' } } },
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
  const { circuitId: circId } = await getCircuitInfo(existingMatch.phaseId);
  const eraFinalizado = existingMatch.status === 'finalizado' || existingMatch.status === 'wo';
  if (circId && winnerId && existingMatch.playerAId && existingMatch.playerBId && !eraFinalizado) {
    const setsWonA = finalSetsA; const setsWonB = finalSetsB;
    const setsLostA = finalSetsB; const setsLostB = finalSetsA;
    const ptsForA = finalPtsA; const ptsForB = finalPtsB;
    const ptsAgainstA = finalPtsB; const ptsAgainstB = finalPtsA;
    const wonA = winnerId === existingMatch.playerAId ? 1 : 0;
    const wonB = winnerId === existingMatch.playerBId ? 1 : 0;
    await prisma.rankingEntry.updateMany({
      where: { playerId: existingMatch.playerAId, circuitId: circId },
      data: { matchesPlayed: { increment: 1 }, matchesWon: { increment: wonA }, setsWon: { increment: setsWonA }, setsLost: { increment: setsLostA }, pointsFor: { increment: ptsForA }, pointsAgainst: { increment: ptsAgainstA } }
    });
    await prisma.rankingEntry.updateMany({
      where: { playerId: existingMatch.playerBId, circuitId: circId },
      data: { matchesPlayed: { increment: 1 }, matchesWon: { increment: wonB }, setsWon: { increment: setsWonB }, setsLost: { increment: setsLostB }, pointsFor: { increment: ptsForB }, pointsAgainst: { increment: ptsAgainstB } }
    });
  }
  if (circId && eraFinalizado) {
    const circuit = await prisma.circuit.findUnique({ where: { id: circId }, select: { configTorneo: true } });
    const tipoTorneo = (circuit?.configTorneo as any)?.tipo;
    const esNac = tipoTorneo === 'nacional' || tipoTorneo === 'panamericano';
    await prisma.rankingEntry.updateMany({
      where: { circuitId: circId },
      data: { matchesPlayed: 0, matchesWon: 0, setsWon: 0, setsLost: 0, pointsFor: 0, pointsAgainst: 0 }
    });
    const allMatches = await prisma.match.findMany({
      where: {
        phase: { circuitId: circId },
        status: { in: ['finalizado', 'wo'] },
        ...(esNac ? { serieId: { startsWith: 'nac-serie-' } } : {})
      },
      include: { result: true }
    });
    for (const m of allMatches) {
      if (!m.result || !m.playerAId || !m.playerBId) continue;
      const { setsA, setsB, pointsA, pointsB, winnerId: wId } = m.result;
      const wA = wId === m.playerAId ? 1 : 0;
      const wB = wId === m.playerBId ? 1 : 0;
      await prisma.rankingEntry.updateMany({
        where: { playerId: m.playerAId, circuitId: circId },
        data: { matchesPlayed: { increment: 1 }, matchesWon: { increment: wA }, setsWon: { increment: setsA }, setsLost: { increment: setsB }, pointsFor: { increment: pointsA ?? 0 }, pointsAgainst: { increment: pointsB ?? 0 } }
      });
      await prisma.rankingEntry.updateMany({
        where: { playerId: m.playerBId, circuitId: circId },
        data: { matchesPlayed: { increment: 1 }, matchesWon: { increment: wB }, setsWon: { increment: setsB }, setsLost: { increment: setsA }, pointsFor: { increment: pointsB ?? 0 }, pointsAgainst: { increment: pointsA ?? 0 } }
      });
    }
  }

  const phaseType = existingMatch.phase?.type;
  const serieId   = existingMatch.serieId ?? '';
  const { formato: formatoTorneo } = await getCircuitInfo(existingMatch.phaseId);

  const esNacionalSerie   = serieId.startsWith('nac-serie-') || /^[A-Z]+-G\d+$/.test(serieId);
  const esNacionalBracket = serieId.startsWith('nac-') && !esNacionalSerie;
  const esPartidoDeSerie = serieId !== '' &&
    !serieId.includes('reduccion') && !serieId.includes('repechaje') &&
    !esNacionalBracket && !esNacionalSerie &&
    (phaseType === 'clasificatorio' || phaseType === 'segunda');
  const esPartidoNacionalSerie = esNacionalSerie && phaseType === 'clasificatorio';
  const roundBase      = Math.floor(existingMatch.round / 10) * 10 + 1;
  const posEnSerie     = existingMatch.round - roundBase;
  const esUltimoPartido = posEnSerie === 4;

  if (updatedMatch.tableId) {
    const freedTable = await prisma.table.update({ where: { id: updatedMatch.tableId }, data: { status: 'libre' }, include: { venue: true } });
    emitTableUpdate(io, freedTable);
  }
  emitMatchUpdate(io, updatedMatch);

  if (esPartidoDeSerie) { await generarSiguientePartidoSerie(matchId); }
  if (esNacionalSerie)  { await propagarSerieNacional(matchId); }
  if (phaseType === 'clasificatorio' && serieId.startsWith('clasif-serie-') && posEnSerie === 4) { await rellenarCrucesReduccion(existingMatch.phaseId); }
  if (phaseType === 'segunda' && serieId.startsWith('segunda-serie-') && posEnSerie === 4) { await rellenarSlotsPrimera(existingMatch.phaseId); }
  if (phaseType === 'primera') { await rellenarSlotMasterConGanadorPrimera(matchId); }
  if (phaseType === 'master' && !esNacionalBracket) { await avanzarBracketMaster(matchId); }
  if (phaseType === 'clasificatorio' && serieId) {
    const mCruce = serieId.match(/^clasif-reduccion-(\d+)$/);
    if (mCruce) { await rellenarRepechaje(matchId); await rellenarSlotSegunda(matchId); }
  }
  if (phaseType === 'clasificatorio' && serieId === 'clasif-repechaje' && winnerId !== null) { await rellenarSlotSegundaConRepechaje(winnerId, existingMatch.phaseId); }
  if (esPartidoNacionalSerie && posEnSerie === 4) {
    if (formatoTorneo === '16') { await rellenarBracketR16Cuartos(existingMatch.phaseId); }
    else { await rellenarBracketNacionalOctavos(existingMatch.phaseId); }
  }
  if (phaseType === 'master' && esNacionalBracket) { await avanzarBracketNacional(matchId); }

  if ((esPartidoDeSerie || esPartidoNacionalSerie) && esUltimoPartido) { await asignarPuntosSerie(existingMatch.phaseId, serieId); }
  if (phaseType === 'primera' || (phaseType === 'master' && !esNacionalBracket) || (phaseType === 'master' && esNacionalBracket) || (phaseType === 'clasificatorio' && serieId.startsWith('clasif-reduccion-')) || (phaseType === 'clasificatorio' && serieId === 'clasif-repechaje')) {
    await asignarPuntosCruce(matchId);
  }

  if (phaseType === 'master') {
    try {
      const phaseId        = existingMatch.phaseId;
      const totalMaster    = await prisma.match.count({ where: { phaseId } });
      const finishedMaster = await prisma.match.count({ where: { phaseId, status: { in: ['finalizado', 'wo'] } } });
      if (totalMaster > 0 && totalMaster === finishedMaster) {
        const tournamentId = existingMatch.phase?.circuit?.tournament?.id;
        if (tournamentId) await calcularYGuardarAcumulado(tournamentId);
      }
    } catch (acumError) { console.error('Error calculando acumulado (no crítico):', acumError); }
  }

  try {
    if ((phaseType === 'clasificatorio' || phaseType === 'segunda') && (esPartidoDeSerie || esPartidoNacionalSerie) && posEnSerie === 4 && serieId) {
      await generarReporteSerie(existingMatch.phaseId, serieId);
    } else if (phaseType === 'primera' || phaseType === 'master' || (phaseType === 'clasificatorio' && !esPartidoDeSerie && !esPartidoNacionalSerie)) {
      await generarReporteCruce(matchId);
    }
  } catch (reportError) { console.error('Error generando reporte (no crítico):', reportError); }

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
