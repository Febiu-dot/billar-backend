import { Router, Response } from 'express';
import prisma from '../services/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { io } from '../index';
import { emitMatchUpdate, emitTableUpdate } from '../services/socketService';
import { generarReporteCruce, generarReporteSerie } from '../services/reportService';
import { calcularYGuardarAcumulado } from './rankingAcumulado';
import { calcularRankingSeries, ordenarFilasRanking } from '../services/rankingSerie';

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
  setsPerdidos?: number;
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

// Busca el partido que espera un lugar ("Clasificado Clasif. #7", etc.) SOLO dentro del
// mismo circuito/torneo que la fase de origen. Sin este límite, dos torneos con los mismos
// textos de lugar se pisarían entre sí (ej. Montevideo y Canelones Este).
async function buscarPorSlot(phaseIdOrigen: number, slotLabel: string) {
  const { circuitId } = await getCircuitInfo(phaseIdOrigen);
  if (!circuitId) return null;
  return prisma.match.findFirst({
    where: { phase: { circuitId }, OR: [{ slotA: slotLabel }, { slotB: slotLabel }] },
    orderBy: { id: 'asc' },
  });
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
    const roundBase = Math.min(...partidos.map((p: any) => p.round));
    const p3 = partidos.find((p: any) => p.round === roundBase + 2);
    const p4 = partidos.find((p: any) => p.round === roundBase + 3);
    const p5 = partidos.find((p: any) => p.round === roundBase + 4);
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

async function asignarPuntosCruce(matchId: number, anterior?: { winnerId: number | null; isWO: boolean }) {
  try {
    const match = await prisma.match.findUnique({ where: { id: matchId }, include: { result: true, phase: true } });
    if (!match || !match.result) return;
    if (match.serieId?.includes('reduccion') || match.serieId?.includes('repechaje')) return;
    const { circuitId, esNacional } = await getCircuitInfo(match.phaseId);
    if (!circuitId) return;
    const isWO = match.result.isWO;
    const winnerId = match.result.winnerId;
    const loserId  = match.playerAId === winnerId ? match.playerBId : match.playerAId;
    const esFinal = match.serieId === 'master-final' || match.serieId === 'nac-final';
    const ptsGanador  = esNacional ? (esFinal ? 5 : 3) : (esFinal ? 7 : 5);
    const ptsPerdedor = esFinal ? 2 : 1;
    // Si es una CORRECCION de un cruce ya finalizado, primero se le quitan los puntos que se dieron con el resultado anterior
    if (anterior && anterior.winnerId && !anterior.isWO) {
      const loserAnt = match.playerAId === anterior.winnerId ? match.playerBId : match.playerAId;
      await sumarPuntosRanking(anterior.winnerId, circuitId, -ptsGanador);
      if (loserAnt) await sumarPuntosRanking(loserAnt, circuitId, -ptsPerdedor);
    }
    if (isWO) return;
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
    // Sincronizar RankingEntry con jugadores reales + recalcular stats y posiciones
    const circuitIdOct = clasificatorioPhase?.circuit?.id;
    if (circuitIdOct) await sincronizarYRecalcularRanking(circuitIdOct);
  } catch (error) { console.error('Error rellenando bracket Nacional octavos:', error); }
}

// ── Sincroniza RankingEntry con jugadores reales de las series nac-serie-* ──
// Se llama automáticamente al armarse el bracket. Reemplaza provisorios Qualy
// por los jugadores reales y recalcula stats + posiciones. Sin intervención manual.
async function sincronizarYRecalcularRanking(circuitId: number) {
  try {
    // 1. Jugadores reales que jugaron series
    const seriesMatches = await prisma.match.findMany({
      where: { phase: { circuitId }, serieId: { startsWith: 'nac-serie-' }, status: { in: ['finalizado', 'wo', 'pendiente', 'en_juego'] } },
      select: { playerAId: true, playerBId: true }
    });
    const jugadoresRealesSet: Set<number> = new Set();
    for (const m of seriesMatches) {
      if (m.playerAId) jugadoresRealesSet.add(m.playerAId);
      if (m.playerBId) jugadoresRealesSet.add(m.playerBId);
    }
    const jugadoresReales = Array.from(jugadoresRealesSet);

    // 2. Filas actuales del RankingEntry
    const entradas = await prisma.rankingEntry.findMany({ where: { circuitId } });
    const playerIdsEnRanking = entradas.map((e: any) => e.playerId);

    // 3. Provisorios = en RankingEntry pero no jugaron ninguna serie
    const provisorios = entradas.filter((e: any) => !jugadoresRealesSet.has(e.playerId));
    // 4. Reales sin fila = jugaron series pero no tienen RankingEntry
    const sinFila = jugadoresReales.filter((id: number) => !playerIdsEnRanking.includes(id));

    // 5. Reemplazar par a par
    for (let i = 0; i < Math.min(provisorios.length, sinFila.length); i++) {
      await prisma.rankingEntry.update({ where: { id: provisorios[i].id }, data: { playerId: sinFila[i] } });
    }
    // 6. Borrar sobrantes
    for (const s of provisorios.slice(sinFila.length)) {
      await prisma.rankingEntry.delete({ where: { id: s.id } });
    }

    // 7. Recalcular puntos de series (8/6/4/2)
    const circuit = await prisma.circuit.findUnique({ where: { id: circuitId }, select: { configTorneo: true } });
    const ruleSetSeries = (circuit?.configTorneo as any)?.ruleSetSeries ?? 1;
    const ruleSet = await prisma.ruleSet.findUnique({ where: { id: ruleSetSeries } });
    const setsToWin = ruleSet?.setsToWin ?? 2;

    await prisma.rankingEntry.updateMany({ where: { circuitId }, data: { points: 0 } });

    const phases = await prisma.phase.findMany({ where: { circuitId } });
    for (const phase of phases) {
      const serieIds = await prisma.match.groupBy({ by: ['serieId'], where: { phaseId: phase.id, serieId: { startsWith: 'nac-serie-' } } });
      for (const { serieId } of serieIds) {
        if (!serieId) continue;
        const partidos = await prisma.match.findMany({ where: { phaseId: phase.id, serieId }, include: { result: true }, orderBy: { round: 'asc' } });
        const roundBase = Math.min(...partidos.map((p: any) => p.round));
        const p3 = partidos.find((p: any) => p.round === roundBase + 2);
        const p4 = partidos.find((p: any) => p.round === roundBase + 3);
        const p5 = partidos.find((p: any) => p.round === roundBase + 4);
        if (!p5?.result) continue;
        const primero = p3?.result?.winnerId;
        const segundo = p5?.result?.winnerId;
        const tercero = p5 ? (p5.playerAId === p5.result?.winnerId ? p5.playerBId : p5.playerAId) : null;
        const cuarto  = p4?.result ? (p4.playerAId === p4.result?.winnerId ? p4.playerBId : p4.playerAId) : null;
        if (primero) await prisma.rankingEntry.updateMany({ where: { playerId: primero, circuitId }, data: { points: { increment: 8 } } });
        if (segundo)  await prisma.rankingEntry.updateMany({ where: { playerId: segundo,  circuitId }, data: { points: { increment: 6 } } });
        if (tercero)  await prisma.rankingEntry.updateMany({ where: { playerId: tercero,  circuitId }, data: { points: { increment: 4 } } });
        if (cuarto)   await prisma.rankingEntry.updateMany({ where: { playerId: cuarto,   circuitId }, data: { points: { increment: 2 } } });
      }
    }

    // 8. Recalcular stats desde partidos reales
    await prisma.rankingEntry.updateMany({ where: { circuitId }, data: { matchesPlayed: 0, matchesWon: 0, setsWon: 0, setsLost: 0, pointsFor: 0, pointsAgainst: 0 } });
    const matchesFinalizados = await prisma.match.findMany({
      where: { phase: { circuitId }, status: { in: ['finalizado', 'wo'] }, serieId: { startsWith: 'nac-serie-' } },
      include: { result: true }
    });
    for (const m of matchesFinalizados) {
      if (!m.result || !m.playerAId || !m.playerBId) continue;
      const { setsA, setsB, pointsA, pointsB, winnerId } = m.result;
      const wonA = winnerId === m.playerAId ? 1 : 0;
      const wonB = winnerId === m.playerBId ? 1 : 0;
      await prisma.rankingEntry.updateMany({ where: { playerId: m.playerAId, circuitId }, data: { matchesPlayed: { increment: 1 }, matchesWon: { increment: wonA }, setsWon: { increment: setsA }, setsLost: { increment: setsB }, pointsFor: { increment: pointsA ?? 0 }, pointsAgainst: { increment: pointsB ?? 0 } } });
      await prisma.rankingEntry.updateMany({ where: { playerId: m.playerBId, circuitId }, data: { matchesPlayed: { increment: 1 }, matchesWon: { increment: wonB }, setsWon: { increment: setsB }, setsLost: { increment: setsA }, pointsFor: { increment: pointsB ?? 0 }, pointsAgainst: { increment: pointsA ?? 0 } } });
    }

    // 9. Recalcular posiciones
    const entradasFinal = await prisma.rankingEntry.findMany({ where: { circuitId } });
    const sorted = [...entradasFinal].sort((a: any, b: any) => {
      if (b.points !== a.points) return b.points - a.points;
      const aSets = (a.setsWon + a.setsLost) > 0 ? a.setsWon / (a.setsWon + a.setsLost) : 0;
      const bSets = (b.setsWon + b.setsLost) > 0 ? b.setsWon / (b.setsWon + b.setsLost) : 0;
      if (bSets !== aSets) return bSets - aSets;
      const aPts = (a.pointsFor + a.pointsAgainst) > 0 ? a.pointsFor / (a.pointsFor + a.pointsAgainst) : 0;
      const bPts = (b.pointsFor + b.pointsAgainst) > 0 ? b.pointsFor / (b.pointsFor + b.pointsAgainst) : 0;
      return bPts - aPts;
    });
    for (let i = 0; i < sorted.length; i++) {
      await prisma.rankingEntry.update({ where: { id: sorted[i].id }, data: { position: i + 1 } });
    }
    console.log(`[sincronizarYRecalcularRanking] circuit ${circuitId}: ${provisorios.length} provisorios reemplazados, ranking recalculado.`);
  } catch (e) { console.error('Error en sincronizarYRecalcularRanking:', e); }
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

    if (clasificados.length < 8) { console.error(`Solo ${clasificados.length} clasificados, se necesitan 8`); return; }

    // Sincronizar RankingEntry ANTES de armar el bracket para usar posiciones correctas
    const circuitIdR16 = clasificatorioPhase?.circuit?.id;
    if (circuitIdR16) await sincronizarYRecalcularRanking(circuitIdR16);

    // Usar el RankingEntry ya calculado para el seeding (mismo criterio que muestra el ranking)
    const rankingEntriesR16 = await prisma.rankingEntry.findMany({
      where: { circuitId: circuitIdR16 },
      orderBy: { position: 'asc' }
    });
    const top8 = rankingEntriesR16.slice(0, 8);
    if (top8.length < 8) { console.error(`Solo ${top8.length} en ranking, se necesitan 8`); return; }

    // cua-1 = seed1 vs seed8 | cua-2 = seed4 vs seed5 | cua-3 = seed3 vs seed6 | cua-4 = seed2 vs seed7
    const seedingMap: [number, number][] = [[0,7],[3,4],[2,5],[1,6]];
    for (let i = 0; i < 4; i++) {
      const [idxAlto, idxBajo] = seedingMap[i];
      const seedAlto = top8[idxAlto]; const seedBajo = top8[idxBajo];
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
    const pos = todosPrimera.findIndex((m: any) => m.id === matchId) + 1;
    if (pos === 0) return;
    const slotLabel = `Clasificado Primera #${pos}`; const winnerId = match.result.winnerId;
    const masterMatch = await buscarPorSlot(match.phaseId, slotLabel);
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
      const masterMatch = await buscarPorSlot(phaseId, slotLabel);
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
    const todasLasSeries = await prisma.match.findMany({ where: { phaseId, serieId: { startsWith: 'segunda-serie-' } }, include: { result: true, sets: true }, orderBy: { round: 'asc' } });
    // Espera a que terminen TODAS las series de Segunda; ranking con el criterio oficial
    // (puntos > diferencia de sets > promedio de tantos): primero todos los 1°, despues todos los 2°.
    const { filas, pendientes } = calcularRankingSeries(todasLasSeries, 'segunda-serie-');
    if (pendientes > 0 || filas.length === 0) return;
    const clasificados = ordenarFilasRanking(filas);
    for (let i = 0; i < clasificados.length; i++) {
      const slotLabel = `Clasificado Segunda #${i + 1}`; const winnerId = clasificados[i].playerId;
      const primeraMatch = await buscarPorSlot(phaseId, slotLabel);
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
    const totalReduccion = await prisma.match.count({ where: { phaseId: match.phaseId, serieId: { startsWith: 'clasif-reduccion-' } } });
    const directos = Math.max(0, cuposDesdeClasif - totalReduccion);

    let slotLabel: string;
    if (directos > 0) {
      // Esquema hibrido (top N clasifica directo + reduccion para el resto):
      // cada cruce de reduccion completa un cupo propio, sin repechaje.
      slotLabel = `Clasificado Clasif. #${directos + cruceNum}`;
    } else {
      // Esquema original: cruces 1..(cuposDesdeClasif-1) clasifican directo;
      // el ultimo cruce va a repechaje (lo maneja rellenarRepechaje aparte).
      if (cruceNum > cuposDesdeClasif - 1) return;
      slotLabel = `Clasificado Clasif. #${cruceNum}`;
    }
    const winnerId = match.result.winnerId;
    const segundaMatch = await buscarPorSlot(match.phaseId, slotLabel);
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
    const segundaMatch = await buscarPorSlot(phaseId, slotLabel);
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
    // 1º = ganador del P3 (final de ganadores); 2º = ganador del P5. Se define por ESTRUCTURA de la serie
    // (antes se ordenaba por victorias y habia empates 2-2 entre ganador P3 y ganador P5 que daban 1º/2º invertidos).
    const calcular = (modo: 'estructural' | 'legacy', orden: 'oficial' | 'previo' = 'oficial'): ClasificadoStats[] => {
      const out: ClasificadoStats[] = [];
      for (const serieId of Object.keys(seriesMap)) {
        const partidos = seriesMap[serieId];
        const roundBase = Math.min(...partidos.map((p: any) => p.round));
        const jugadoresIds: Set<number> = new Set();
        for (const p of partidos) { if (p.playerAId) jugadoresIds.add(p.playerAId); if (p.playerBId) jugadoresIds.add(p.playerBId); }
        const statsJugador: Record<number, PlayerStats & { setsLost: number }> = {};
        for (const id of jugadoresIds) statsJugador[id] = { wins: 0, sets: 0, setsLost: 0, ptsFor: 0, ptsAgainst: 0 };
        // Mismo criterio que el ranking oficial (rankings.ts addSetsAndTantos): si hay detalle de sets se usa; si no, el resultado.
        for (const partido of partidos) {
          if (!partido.result) continue;
          const pA = partido.playerAId; const pB = partido.playerBId;
          let sA = 0, sB = 0, tA = 0, tB = 0;
          if (partido.sets && partido.sets.length > 0) {
            for (const st of partido.sets) { tA += st.pointsA; tB += st.pointsB; if (st.pointsA > st.pointsB) sA++; else if (st.pointsB > st.pointsA) sB++; }
          } else { sA = partido.result.setsA; sB = partido.result.setsB; tA = partido.result.pointsA; tB = partido.result.pointsB; }
          const winnerId = partido.result.winnerId;
          if (pA && statsJugador[pA]) { statsJugador[pA].wins += winnerId === pA ? 1 : 0; statsJugador[pA].sets += sA; statsJugador[pA].setsLost += sB; statsJugador[pA].ptsFor += tA; statsJugador[pA].ptsAgainst += tB; }
          if (pB && statsJugador[pB]) { statsJugador[pB].wins += winnerId === pB ? 1 : 0; statsJugador[pB].sets += sB; statsJugador[pB].setsLost += sA; statsJugador[pB].ptsFor += tB; statsJugador[pB].ptsAgainst += tA; }
        }
        let primero: number | undefined; let segundo: number | undefined;
        if (modo === 'estructural') {
          primero = partidos.find((p: any) => p.round === roundBase + 2)?.result?.winnerId ?? undefined;
          segundo = partidos.find((p: any) => p.round === roundBase + 4)?.result?.winnerId ?? undefined;
        } else {
          const ord = Array.from(jugadoresIds).filter(id => statsJugador[id]).sort((a, b) => {
            const sa = statsJugador[a]; const sb = statsJugador[b];
            if (sb.wins !== sa.wins) return sb.wins - sa.wins; if (sb.sets !== sa.sets) return sb.sets - sa.sets;
            if (sb.ptsFor !== sa.ptsFor) return sb.ptsFor - sa.ptsFor; return sa.ptsAgainst - sb.ptsAgainst;
          });
          primero = ord[0]; segundo = ord[1];
        }
        if (primero && statsJugador[primero]) { const s = statsJugador[primero]; out.push({ playerId: primero, puntos: 8, setsGanados: s.sets, setsPerdidos: s.setsLost, tantosAFavor: s.ptsFor, tantosEnContra: s.ptsAgainst }); }
        if (segundo && statsJugador[segundo]) { const s = statsJugador[segundo]; out.push({ playerId: segundo, puntos: 6, setsGanados: s.sets, setsPerdidos: s.setsLost, tantosAFavor: s.ptsFor, tantosEnContra: s.ptsAgainst }); }
      }
      // Orden oficial (igual a sortAlternativa4 de rankings.ts): puntos > diferencia de sets > promedio de tantos (favor/contra).
      const prom = (x: ClasificadoStats) => x.tantosEnContra > 0 ? x.tantosAFavor / x.tantosEnContra : (x.tantosAFavor > 0 ? 99999 : 0);
      // Orden usado por versiones anteriores (solo para reconocer y reparar lo ya cargado).
      if (orden === 'previo') return out.sort((a, b) => { if (b.puntos !== a.puntos) return b.puntos - a.puntos; if (b.setsGanados !== a.setsGanados) return b.setsGanados - a.setsGanados; if (b.tantosAFavor !== a.tantosAFavor) return b.tantosAFavor - a.tantosAFavor; return a.tantosEnContra - b.tantosEnContra; });
      return out.sort((a, b) => { if (b.puntos !== a.puntos) return b.puntos - a.puntos; const dA = a.setsGanados - (a.setsPerdidos ?? 0); const dB = b.setsGanados - (b.setsPerdidos ?? 0); if (dB !== dA) return dB - dA; return prom(b) - prom(a); });
    };
    const clasificados = calcular('estructural');
    const previos = [calcular('estructural', 'previo'), calcular('legacy', 'previo')];
    const crucesReduccion = await prisma.match.findMany({ where: { phaseId, serieId: { startsWith: 'clasif-reduccion-' } }, orderBy: { round: 'asc' } });
    const N = clasificados.length;
    const cuposDesdeClasif = await getCuposDesdeClasif(phaseId);
    // "directos": los mejor ubicados del ranking clasifican SIN jugar reduccion.
    // Ej: 22 clasificados, cupos=16, 6 cruces de reduccion -> directos = 16-6 = 10 (puestos 1-10).
    const directos = Math.max(0, cuposDesdeClasif - crucesReduccion.length);

    // Ubicar destinos de los directos: por slot-label (primera vez) o por el jugador que dejo una corrida
    // anterior (reparacion). Se ubican todos ANTES de modificar para evitar pisarse.
    const fasesSegunda = await prisma.phase.findMany({ where: { type: 'segunda', circuit: { phases: { some: { id: phaseId } } } }, select: { id: true } });
    const idsSegunda = fasesSegunda.map((f: any) => f.id);
    const destinos: { matchId: number; lado: 'A' | 'B'; jugadorId: number }[] = [];
    for (let i = 0; i < directos; i++) {
      const jug = clasificados[i]; if (!jug) continue;
      const slotLabel = `Clasificado Clasif. #${i + 1}`;
      const porSlot = await buscarPorSlot(phaseId, slotLabel);
      if (porSlot) { destinos.push({ matchId: porSlot.id, lado: porSlot.slotA === slotLabel ? 'A' : 'B', jugadorId: jug.playerId }); continue; }
      if (idsSegunda.length === 0) continue;
      for (const lista of previos) {
        const viejo = lista[i]?.playerId;
        if (!viejo || viejo === jug.playerId) continue;
        const m = await prisma.match.findFirst({ where: { phaseId: { in: idsSegunda }, status: { in: ['pendiente', 'asignado'] }, OR: [{ playerAId: viejo }, { playerBId: viejo }] }, orderBy: { id: 'asc' } });
        if (m) { destinos.push({ matchId: m.id, lado: m.playerAId === viejo ? 'A' : 'B', jugadorId: jug.playerId }); break; }
      }
    }
    for (const d of destinos) {
      await prisma.match.update({ where: { id: d.matchId }, data: d.lado === 'A' ? { playerAId: d.jugadorId, slotA: null } : { playerBId: d.jugadorId, slotB: null } });
    }
    for (const d of destinos) {
      const actualizado = await prisma.match.findUnique({ where: { id: d.matchId } });
      if (actualizado?.playerAId && actualizado?.playerBId) {
        await prisma.match.update({ where: { id: d.matchId }, data: { status: actualizado.tableId ? 'asignado' : 'pendiente' } });
        await checkAndEmitMatch(d.matchId);
      }
    }

    // El resto (puestos directos+1 .. N) juega la reduccion, en espejo entre ellos.
    for (let i = 0; i < crucesReduccion.length; i++) {
      const cruce = crucesReduccion[i]; const jugA = clasificados[directos + i]; const jugB = clasificados[N - 1 - i];
      if (jugA && jugB) {
        await prisma.match.update({ where: { id: cruce.id }, data: { playerAId: jugA.playerId, playerBId: jugB.playerId, slotA: null, slotB: null, status: cruce.tableId ? 'asignado' : 'pendiente' } });
        await checkAndEmitMatch(cruce.id);
      }
    }

    // Repechaje: solo existe en el esquema original (directos=0, sin bypass directo).
    if (directos === 0) {
      const repechaje = await prisma.match.findFirst({ where: { phaseId, serieId: 'clasif-repechaje' } });
      if (repechaje && crucesReduccion.length >= 2) {
        const ult = crucesReduccion[crucesReduccion.length - 1]; const pen = crucesReduccion[crucesReduccion.length - 2];
        await prisma.match.update({ where: { id: repechaje.id }, data: { slotA: `Ganador Cruce ${pen.round}`, slotB: `Ganador Cruce ${ult.round}` } });
      }
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
    const p1 = partidos.find((p: any) => p.round === roundBase); const p2 = partidos.find((p: any) => p.round === roundBase + 1);
    const p3 = partidos.find((p: any) => p.round === roundBase + 2); const p4 = partidos.find((p: any) => p.round === roundBase + 3);
    // Los partidos 3/4/5 se crean PENDIENTES y sin mesa: el juez de la sede (o el admin)
    // les asigna mesa desde su panel. La sede se hereda por serieId (ver GET /matches?venueId).
    const ruleSetId = p1?.ruleSetId ?? null;
    if (posEnSerie <= 1 && p1?.result?.winnerId && p2?.result?.winnerId && !p3) {
      const newP3 = await prisma.match.create({
        data: { phaseId, playerAId: p1.result!.winnerId!, playerBId: p2.result!.winnerId!, round: roundBase + 2, status: 'pendiente', serieId: match.serieId, tableId: null, ruleSetId },
        include: { playerA: { include: { category: true } }, playerB: { include: { category: true } }, table: { include: { venue: true } }, phase: { include: { circuit: { include: { tournament: true } } } }, result: true, ruleSet: true, sets: { orderBy: { setNumber: 'asc' } } }
      });
      const p1LoserId = p1.playerAId === p1.result!.winnerId ? p1.playerBId : p1.playerAId;
      const p2LoserId = p2.playerAId === p2.result!.winnerId ? p2.playerBId : p2.playerAId;
      if (p1LoserId && p2LoserId) {
        const newP4 = await prisma.match.create({
          data: { phaseId, playerAId: p1LoserId, playerBId: p2LoserId, round: roundBase + 3, status: 'pendiente', serieId: match.serieId, tableId: null, ruleSetId },
          include: { playerA: { include: { category: true } }, playerB: { include: { category: true } }, table: { include: { venue: true } }, phase: { include: { circuit: { include: { tournament: true } } } }, result: true, ruleSet: true, sets: { orderBy: { setNumber: 'asc' } } }
        });
        emitMatchUpdate(io, newP4);
      }
      emitMatchUpdate(io, newP3);
    }
    if (posEnSerie >= 2 && posEnSerie <= 3 && p3?.result?.winnerId && p4?.result?.winnerId && !partidos.find((p: any) => p.round === roundBase + 4)) {
      const p3LoserId = p3!.playerAId === p3!.result!.winnerId ? p3!.playerBId : p3!.playerAId;
      if (p3LoserId && p4!.result!.winnerId) {
        const newP5 = await prisma.match.create({
          data: { phaseId, playerAId: p3LoserId, playerBId: p4!.result!.winnerId!, round: roundBase + 4, status: 'pendiente', serieId: match.serieId, tableId: null, ruleSetId },
          include: { playerA: { include: { category: true } }, playerB: { include: { category: true } }, table: { include: { venue: true } }, phase: { include: { circuit: { include: { tournament: true } } } }, result: true, ruleSet: true, sets: { orderBy: { setNumber: 'asc' } } }
        });
        emitMatchUpdate(io, newP5);
      }
    }
  } catch (error) { console.error('Error generando siguiente partido de serie:', error); }
}

// Cuando se CORRIGE el ganador de un CRUCE ya finalizado (reduccion, repechaje, Primera, Master, brackets), el ganador anterior
// ya fue colocado en el cruce siguiente (el "slot" ya se vacio, por eso la propagacion normal no lo vuelve a tocar).
// Aca se reemplaza al ganador anterior por el nuevo en los partidos del circuito que sigan SIN JUGAR (pendiente/asignado, sin sets ni resultado).
// Si el partido siguiente ya empezo o termino no se toca y se devuelve un aviso. Nunca lanza error.
async function repropagarCruce(matchId: number, ganadorAnterior: number, ganadorNuevo: number, finalizadoAntes: Date | null, aplicar = true): Promise<{ avisos: string[]; cambios: any[] }> {
  const avisos: string[] = [];
  const cambios: any[] = [];
  try {
    const match = await prisma.match.findUnique({ where: { id: matchId }, include: { phase: true } });
    if (!match || !match.phase?.circuitId) return { avisos, cambios };
    const candidatos = await prisma.match.findMany({
      where: { id: { not: matchId }, phase: { circuitId: match.phase.circuitId }, OR: [{ playerAId: ganadorAnterior }, { playerBId: ganadorAnterior }] },
      include: { result: true, sets: true }
    });
    for (const c of candidatos) {
      const sinJugar = (c.status === 'pendiente' || c.status === 'asignado') && !c.result && (!c.sets || c.sets.length === 0);
      if (sinJugar) {
        // No tocar si el nuevo ganador ya esta en ese mismo partido (seria un partido contra si mismo)
        if (c.playerAId === ganadorNuevo || c.playerBId === ganadorNuevo) continue;
        const data = c.playerAId === ganadorAnterior ? { playerAId: ganadorNuevo } : { playerBId: ganadorNuevo };
        cambios.push({ partidoId: c.id, faseId: c.phaseId, ronda: c.round, serieId: c.serieId, lado: c.playerAId === ganadorAnterior ? 'A' : 'B', quitar: ganadorAnterior, poner: ganadorNuevo });
        if (!aplicar) continue;
        const upd = await prisma.match.update({
          where: { id: c.id }, data,
          include: { playerA: { include: { category: true } }, playerB: { include: { category: true } }, table: { include: { venue: true } }, phase: { include: { circuit: { include: { tournament: true } } } }, result: true, ruleSet: true, sets: { orderBy: { setNumber: 'asc' } } }
        });
        emitMatchUpdate(io, upd);
        console.log(`🔁 Cruce corregido: partido ${c.id} (fase ${c.phaseId}, ronda ${c.round}) ahora tiene al nuevo ganador del partido ${matchId}`);
      } else if (c.status === 'en_juego' || (c.result && finalizadoAntes && c.startedAt && c.startedAt >= finalizadoAntes)) {
        avisos.push(`El partido ${c.id} (ronda ${c.round}) ya empezó o terminó con el ganador anterior: hay que corregirlo a mano.`);
      }
    }
  } catch (error) { console.error('Error re-propagando cruce (no crítico):', error); avisos.push('No se pudo actualizar automáticamente el cruce siguiente.'); }
  return { avisos, cambios };
}

// Igual que reparar-cruce pero buscando por apellido del GANADOR (toma su partido finalizado mas reciente).
// Ej: POST /matches/reparar-cruce-jugador?q=lapaz  (solo muestra)  ->  agregar &aplicar=true para aplicar.
router.post('/reparar-cruce-jugador', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 3) return res.status(400).json({ error: 'Falta ?q= con el apellido del ganador (mínimo 3 letras)' }) as any;
    const recientes = await prisma.match.findMany({
      where: { status: { in: ['finalizado', 'wo'] }, result: { is: { winnerId: { not: null } } } },
      include: { result: true, playerA: true, playerB: true, phase: true },
      orderBy: { finishedAt: 'desc' }, take: 300
    });
    const norm = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const candidatos = recientes.filter((m: any) => {
      const g = m.result.winnerId === m.playerAId ? m.playerA : m.playerB;
      return g && norm(`${g.firstName} ${g.lastName}`).includes(norm(q));
    }).slice(0, 3);
    if (candidatos.length === 0) return res.status(404).json({ error: 'No encontré partidos finalizados ganados por ese jugador' }) as any;
    const m: any = candidatos[0];
    const ganador = m.result.winnerId;
    const perdedor = m.playerAId === ganador ? m.playerBId : m.playerAId;
    const nombre = (p: any) => p ? `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() : '';
    const aplicar = req.query.aplicar === 'true';
    const r = await repropagarCruce(m.id, perdedor, ganador, m.finishedAt, aplicar);
    const detalle = [];
    for (const c of r.cambios) {
      const cm: any = await prisma.match.findUnique({ where: { id: c.partidoId }, include: { playerA: true, playerB: true, phase: true } });
      detalle.push({ ...c, fase: cm?.phase?.name, jugadorA: nombre(cm?.playerA), jugadorB: nombre(cm?.playerB) });
    }
    res.json({
      aplicado: aplicar,
      partidoCorregido: { id: m.id, fase: m.phase?.name, ronda: m.round, jugadorA: nombre(m.playerA), jugadorB: nombre(m.playerB), ganador: nombre(m.playerAId === ganador ? m.playerA : m.playerB), finalizado: m.finishedAt },
      cruceAReemplazar: detalle,
      avisos: r.avisos,
      otrosCandidatos: candidatos.slice(1).map((x: any) => ({ id: x.id, fase: x.phase?.name, jugadorA: nombre(x.playerA), jugadorB: nombre(x.playerB), finalizado: x.finishedAt })),
    });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Repara a mano un cruce siguiente que quedo armado con el PERDEDOR de este partido (ya corregido).
// Sin ?aplicar=true solo muestra que cambiaria. Con ?aplicar=true lo cambia por el ganador actual.
router.post('/reparar-cruce/:matchId', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const matchId = Number(req.params.matchId);
    const m = await prisma.match.findUnique({ where: { id: matchId }, include: { result: true, playerA: true, playerB: true } });
    if (!m || !m.result?.winnerId) return res.status(400).json({ error: 'El partido no existe o no tiene ganador cargado' }) as any;
    const ganador = m.result.winnerId;
    const perdedor = m.playerAId === ganador ? m.playerBId : m.playerAId;
    if (!perdedor) return res.status(400).json({ error: 'El partido no tiene dos jugadores' }) as any;
    const aplicar = req.query.aplicar === 'true';
    const r = await repropagarCruce(matchId, perdedor, ganador, m.finishedAt, aplicar);
    const nombre = (p: any) => p ? `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() : '';
    res.json({ aplicado: aplicar, ganador: nombre(m.playerAId === ganador ? m.playerA : m.playerB), perdedor: nombre(m.playerAId === ganador ? m.playerB : m.playerA), cambios: r.cambios, avisos: r.avisos });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Cuando se CORRIGE el resultado de un partido ya finalizado de una serie, los partidos siguientes (P3/P4/P5) que
// ya estaban armados con el ganador anterior se actualizan solos, siempre que todavia no se hayan jugado:
//   P3 = ganador P1 vs ganador P2    P4 = perdedor P1 vs perdedor P2    P5 = perdedor P3 vs ganador P4
// Solo toca partidos pendientes/asignados SIN sets ni resultado. Si el partido siguiente ya empezo o termino no lo toca
// y devuelve un aviso (para resolverlo a mano con reparar-serie). Nunca lanza error.
async function repropagarSerie(matchId: number): Promise<string[]> {
  const avisos: string[] = [];
  try {
    const match = await prisma.match.findUnique({ where: { id: matchId } });
    if (!match || !match.serieId) return avisos;
    const roundBase = Math.floor(match.round / 10) * 10 + 1;
    const partidos = await prisma.match.findMany({
      where: { phaseId: match.phaseId, serieId: match.serieId },
      include: { result: true, sets: true }
    });
    const por = (n: number) => partidos.find((p: any) => p.round === roundBase + n);
    const ganador = (m: any): number | null => m?.result?.winnerId ?? null;
    const perdedor = (m: any): number | null => {
      const w = ganador(m); if (!w || !m) return null;
      return m.playerAId === w ? m.playerBId : m.playerAId;
    };
    const p1 = por(0), p2 = por(1), p3 = por(2), p4 = por(3), p5 = por(4);
    const esperados: Array<{ m: any; nombre: string; a: number | null; b: number | null }> = [
      { m: p3, nombre: 'partido 3', a: ganador(p1), b: ganador(p2) },
      { m: p4, nombre: 'partido 4', a: perdedor(p1), b: perdedor(p2) },
    ];
    for (const e of esperados) {
      if (!e.m || !e.a || !e.b) continue;
      if (e.m.playerAId === e.a && e.m.playerBId === e.b) continue;
      if (e.m.playerAId === e.b && e.m.playerBId === e.a) continue;
      const sinJugar = (e.m.status === 'pendiente' || e.m.status === 'asignado') && !e.m.result && (!e.m.sets || e.m.sets.length === 0);
      if (!sinJugar) { avisos.push(`El ${e.nombre} de la serie ya se jugó o está en juego y quedó con jugadores que no corresponden: corregilo con reparar-serie (partido ${e.m.id}).`); continue; }
      const upd = await prisma.match.update({
        where: { id: e.m.id }, data: { playerAId: e.a, playerBId: e.b },
        include: { playerA: { include: { category: true } }, playerB: { include: { category: true } }, table: { include: { venue: true } }, phase: { include: { circuit: { include: { tournament: true } } } }, result: true, ruleSet: true, sets: { orderBy: { setNumber: 'asc' } } }
      });
      emitMatchUpdate(io, upd);
      console.log(`🔁 Serie ${match.serieId}: ${e.nombre} (id ${e.m.id}) actualizado por resultado corregido`);
    }
    // P5 depende de P3 y P4 (solo existe si ambos terminaron)
    if (p5 && ganador(p3) && ganador(p4)) {
      const a = perdedor(p3), b = ganador(p4);
      if (a && b && !((p5.playerAId === a && p5.playerBId === b) || (p5.playerAId === b && p5.playerBId === a))) {
        const sinJugar = (p5.status === 'pendiente' || p5.status === 'asignado') && !p5.result && (!p5.sets || p5.sets.length === 0);
        if (!sinJugar) { avisos.push(`El partido 5 de la serie ya se jugó o está en juego y quedó con jugadores que no corresponden: corregilo a mano (partido ${p5.id}).`); }
        else {
          const upd = await prisma.match.update({
            where: { id: p5.id }, data: { playerAId: a, playerBId: b },
            include: { playerA: { include: { category: true } }, playerB: { include: { category: true } }, table: { include: { venue: true } }, phase: { include: { circuit: { include: { tournament: true } } } }, result: true, ruleSet: true, sets: { orderBy: { setNumber: 'asc' } } }
          });
          emitMatchUpdate(io, upd);
          console.log(`🔁 Serie ${match.serieId}: partido 5 (id ${p5.id}) actualizado por resultado corregido`);
        }
      }
    } else if (p5 && (!ganador(p3) || !ganador(p4))) {
      avisos.push(`El partido 5 de la serie existe pero uno de sus partidos previos ya no tiene ganador: revisalo (partido ${p5.id}).`);
    }
  } catch (error) { console.error('Error re-propagando serie (no crítico):', error); avisos.push('No se pudo actualizar automáticamente los partidos siguientes de la serie.'); }
  return avisos;
}

// Repara los partidos 3 y 4 de una serie (clasif-serie-N / segunda-serie-N) que se armaron con un resultado
// equivocado del P1/P2 que despues se corrigio (la app arma P3/P4 una sola vez, apenas se cargan P1 y P2).
//   P3 = ganador P1 vs ganador P2      P4 = perdedor P1 vs perdedor P2   (con los resultados ACTUALES)
// Sin ?aplicar=true solo muestra el plan. Con ?aplicar=true cambia los jugadores.
// Si el partido a corregir ya tiene sets o resultado, hace falta ademas ?descartarResultado=true (los borra).
// Se niega a actuar si ya existe el P5 de la serie. Recibe el id de CUALQUIER partido de la serie.
router.post('/reparar-serie/:matchId', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const aplicar = req.query.aplicar === 'true';
    const descartar = req.query.descartarResultado === 'true';
    const conservar = req.query.conservarResultado === 'true';
    if (descartar && conservar) { res.status(400).json({ error: 'Elegir una sola opcion: descartarResultado o conservarResultado.' }); return; }
    const base: any = await prisma.match.findUnique({ where: { id: Number(req.params.matchId) } });
    if (!base || !base.serieId) { res.status(404).json({ error: 'Partido no encontrado o sin serie.' }); return; }
    const sid: string = base.serieId;
    if (!(sid.startsWith('clasif-serie-') || sid.startsWith('segunda-serie-'))) { res.status(400).json({ error: 'Solo sirve para series del clasificatorio o de Segunda (clasif-serie-N / segunda-serie-N).' }); return; }

    const partidos: any[] = await prisma.match.findMany({
      where: { phaseId: base.phaseId, serieId: sid },
      include: { result: true, sets: true, playerA: true, playerB: true }, orderBy: { round: 'asc' }
    });
    const rb = Math.min(...partidos.map((m: any) => m.round));
    const P = (n: number) => partidos.find((m: any) => m.round === rb + n);
    const p1 = P(0), p2 = P(1), p3 = P(2), p4 = P(3), p5 = P(4);
    if (!p1?.result?.winnerId || !p2?.result?.winnerId) { res.status(409).json({ error: 'El P1 y el P2 de esta serie todavia no tienen ganador.' }); return; }
    if (!p3 || !p4) { res.status(409).json({ error: 'Esta serie todavia no tiene P3 y P4 generados; no hay nada para reparar.' }); return; }

    const perdedor = (m: any): number | null => (m.playerAId === m.result.winnerId ? m.playerBId : m.playerAId);
    const nombre = (j: any) => (j ? `${j.lastName}, ${j.firstName}` : '—');
    const jug: Record<number, any> = {};
    for (const m of partidos) { if (m.playerA) jug[m.playerA.id] = m.playerA; if (m.playerB) jug[m.playerB.id] = m.playerB; }
    const nom = (id: number | null) => (id && jug[id] ? nombre(jug[id]) : '—');

    const esperados = [
      { etiqueta: 'P3', m: p3, A: p1.result.winnerId as number, B: p2.result.winnerId as number },
      { etiqueta: 'P4', m: p4, A: perdedor(p1) as number, B: perdedor(p2) as number },
    ];
    const plan = esperados.map((e: any) => {
      const tieneSets = e.m.sets.length > 0; const tieneResultado = !!e.m.result;
      const cambia = e.m.playerAId !== e.A || e.m.playerBId !== e.B;
      return {
        etiqueta: e.etiqueta, partidoId: e.m.id, estado: e.m.status, mesa: e.m.tableId,
        antes: `${nom(e.m.playerAId)} vs ${nom(e.m.playerBId)}`,
        despues: `${nom(e.A)} vs ${nom(e.B)}`,
        cambia, tieneSets, tieneResultado,
        resultadoActual: tieneResultado ? `${e.m.result.setsA}-${e.m.result.setsB} (ganador ${nom(e.m.result.winnerId)})` : null,
        debeDescartar: cambia && (tieneSets || tieneResultado),
        A: e.A, B: e.B,
      };
    });
    const cambios = plan.filter((x: any) => x.cambia);
    const texto: string[] = [];
    for (const x of plan) {
      if (!x.cambia) { texto.push(`${x.etiqueta} (partido ${x.partidoId}): ya esta bien -> ${x.antes}`); continue; }
      texto.push(`${x.etiqueta} (partido ${x.partidoId}, ${x.estado}${x.mesa ? ', mesa ' + x.mesa : ''}): ${x.antes}  ==>  ${x.despues}`);
      if (x.debeDescartar) texto.push(`   OJO: este partido ya tiene ${x.resultadoActual ? 'resultado ' + x.resultadoActual : 'sets cargados'}. Opciones: conservarResultado=true (cambia solo el nombre del jugador y MANTIENE los sets/resultado, pasando al jugador nuevo lo que era del reemplazado) o descartarResultado=true (BORRA los sets/resultado).`);
    }
    if (cambios.length === 0) { res.json({ aplicado: false, texto: [...texto, 'Nada para corregir.'], plan }); return; }
    if (p5) { res.status(409).json({ error: 'Ya existe el P5 de esta serie, que depende de P3 y P4. No se toco nada: hay que revisarlo a mano.', texto, plan }); return; }
    const faltaDecision = cambios.some((x: any) => x.debeDescartar) && !descartar && !conservar;
    if (!aplicar) { res.json({ aplicado: false, requiereDecision: cambios.some((x: any) => x.debeDescartar), texto, plan }); return; }
    if (faltaDecision) { res.status(409).json({ error: 'Hay partidos con resultado o sets. No se toco nada; repetir con conservarResultado=true (mantiene los sets/resultado) o descartarResultado=true (los borra).', texto, plan }); return; }

    const mesasTocadas: Set<number> = new Set();
    for (const x of cambios) {
      const dm: any = partidos.find((m: any) => m.id === x.partidoId);
      if (dm.tableId) mesasTocadas.add(dm.tableId);
      if (x.debeDescartar && conservar) {
        // Cambia solo los jugadores y mantiene sets y resultado: lo que era del jugador reemplazado pasa al nuevo (por lado A/B)
        const mapa = (id: number | null): number | null => (id === dm.playerAId ? x.A : id === dm.playerBId ? x.B : id);
        await prisma.match.update({ where: { id: x.partidoId }, data: { playerAId: x.A, playerBId: x.B, slotA: null, slotB: null } });
        if (dm.result) {
          await prisma.matchResult.update({ where: { matchId: x.partidoId }, data: { winnerId: dm.result.winnerId == null ? null : mapa(dm.result.winnerId), woPlayerId: dm.result.woPlayerId == null ? null : mapa(dm.result.woPlayerId) } });
        }
        for (const st of dm.sets) {
          await prisma.setResult.update({ where: { id: st.id }, data: { winnerId: st.pointsA > st.pointsB ? x.A : x.B } });
        }
      } else if (x.debeDescartar) {
        await prisma.setResult.deleteMany({ where: { matchId: x.partidoId } });
        await prisma.matchResult.deleteMany({ where: { matchId: x.partidoId } });
        await prisma.match.update({ where: { id: x.partidoId }, data: { playerAId: x.A, playerBId: x.B, slotA: null, slotB: null, status: 'pendiente', tableId: null, startedAt: null, finishedAt: null } });
      } else {
        await prisma.match.update({ where: { id: x.partidoId }, data: { playerAId: x.A, playerBId: x.B, slotA: null, slotB: null } });
      }
    }

    // Si se descarto algun resultado, rehacer las estadisticas del circuito (misma logica que al editar un resultado)
    if (cambios.some((x: any) => x.debeDescartar && (descartar || x.estado === 'finalizado' || x.estado === 'wo'))) {
      const { circuitId: circId } = await getCircuitInfo(base.phaseId);
      if (circId) {
        const circuit = await prisma.circuit.findUnique({ where: { id: circId }, select: { configTorneo: true } });
        const tipoT = (circuit?.configTorneo as any)?.tipo;
        const esNac = tipoT === 'nacional' || tipoT === 'panamericano';
        await prisma.rankingEntry.updateMany({ where: { circuitId: circId }, data: { matchesPlayed: 0, matchesWon: 0, setsWon: 0, setsLost: 0, pointsFor: 0, pointsAgainst: 0 } });
        const fin: any[] = await prisma.match.findMany({
          where: { phase: { circuitId: circId }, status: { in: ['finalizado', 'wo'] }, ...(esNac ? { serieId: { startsWith: 'nac-serie-' } } : {}) },
          include: { result: true }
        });
        for (const m of fin) {
          if (!m.result || !m.playerAId || !m.playerBId) continue;
          const { setsA, setsB, pointsA, pointsB, winnerId: wId } = m.result;
          await prisma.rankingEntry.updateMany({ where: { playerId: m.playerAId, circuitId: circId }, data: { matchesPlayed: { increment: 1 }, matchesWon: { increment: wId === m.playerAId ? 1 : 0 }, setsWon: { increment: setsA }, setsLost: { increment: setsB }, pointsFor: { increment: pointsA ?? 0 }, pointsAgainst: { increment: pointsB ?? 0 } } });
          await prisma.rankingEntry.updateMany({ where: { playerId: m.playerBId, circuitId: circId }, data: { matchesPlayed: { increment: 1 }, matchesWon: { increment: wId === m.playerBId ? 1 : 0 }, setsWon: { increment: setsB }, setsLost: { increment: setsA }, pointsFor: { increment: pointsB ?? 0 }, pointsAgainst: { increment: pointsA ?? 0 } } });
        }
      }
    }

    // Mesas: si al cerrar el partido equivocado se libero una mesa donde hay otro partido en curso, dejarla ocupada
    for (const tid of Array.from(mesasTocadas)) {
      const activo = await prisma.match.findFirst({ where: { tableId: tid, status: { in: ['asignado', 'en_juego'] } } });
      if (activo) {
        const mesa = await prisma.table.update({ where: { id: tid }, data: { status: 'ocupada' }, include: { venue: true } });
        emitTableUpdate(io, mesa);
      }
    }
    for (const x of cambios) {
      const full: any = await prisma.match.findUnique({
        where: { id: x.partidoId },
        include: { playerA: { include: { category: true } }, playerB: { include: { category: true } }, table: { include: { venue: true } }, phase: { include: { circuit: { include: { tournament: true } } } }, result: true, sets: { orderBy: { setNumber: 'asc' } } }
      });
      if (full) emitMatchUpdate(io, full);
    }
    res.json({ aplicado: true, texto: [...texto, `Listo: se corrigieron ${cambios.length} partidos.`], plan });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});
router.post('/trigger-reduccion/:phaseId', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try { await rellenarCrucesReduccion(parseInt(req.params.phaseId)); res.json({ message: 'Cruces de reducción rellenados correctamente' }); }
  catch (error: any) { res.status(500).json({ error: error.message }); }
});
router.post('/trigger-segunda/:phaseId', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try { await rellenarSlotsPrimera(parseInt(req.params.phaseId)); res.json({ message: 'Slots de Primera rellenados correctamente' }); }
  catch (error: any) { res.status(500).json({ error: error.message }); }
});
// Corrige en los cruces de Primera el orden de los clasificados de Segunda segun el ranking oficial
// (puntos > diferencia de sets > promedio de tantos). Solo reordena a los MISMOS jugadores entre
// sus lugares; si hay algo raro (otros jugadores, cruces ya jugados) no toca nada y avisa.
// Sin ?aplicar=true solo muestra el plan (no cambia nada).
router.post('/reordenar-primera/:circuitId', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const circuitId = parseInt(req.params.circuitId);
    const aplicar = req.query.aplicar === 'true';
    const fases = await prisma.phase.findMany({ where: { circuitId } });
    const fSegunda = fases.find((f: any) => f.type === 'segunda');
    const fPrimera = fases.find((f: any) => f.type === 'primera');
    if (!fSegunda || !fPrimera) { res.status(404).json({ error: 'Este circuito no tiene fase de Segunda y de Primera.' }); return; }

    const matchesSegunda = await prisma.match.findMany({
      where: { phaseId: fSegunda.id, serieId: { startsWith: 'segunda-serie-' } },
      include: { result: true, sets: true, playerA: true, playerB: true }, orderBy: { round: 'asc' }
    });
    const { filas, pendientes } = calcularRankingSeries(matchesSegunda, 'segunda-serie-');
    if (pendientes > 0 || filas.length === 0) { res.status(409).json({ error: 'Todavia no terminaron todas las series de Segunda.' }); return; }
    const oficial = ordenarFilasRanking(filas);

    const cruces = await prisma.match.findMany({
      where: { phaseId: fPrimera.id, serieId: { startsWith: 'primera-cruce-' } },
      include: { result: true, playerA: true, playerB: true }, orderBy: { round: 'asc' }
    });
    const M = cruces.length; const total = 2 * M; const n = oficial.length; const p = total - n;
    if (M === 0 || p < 0) { res.status(409).json({ error: 'Los cruces de Primera no tienen la forma esperada. No se toco nada.' }); return; }

    const nombre = (j: any) => (j ? `${j.lastName}, ${j.firstName}` : '—');
    const plan = oficial.map((f: any, i: number) => {
      const idx = p + i;
      const lado = idx < M ? 'A' : 'B';
      const cruce: any = lado === 'A' ? cruces[idx] : cruces[total - 1 - idx];
      const actualJ: any = lado === 'A' ? cruce.playerA : cruce.playerB;
      return {
        puesto: i + 1, cruceId: cruce.id, cruceNumero: lado === 'A' ? idx + 1 : total - idx, lado,
        actual: { id: actualJ?.id ?? null, nombre: nombre(actualJ) },
        oficial: { id: f.playerId, nombre: nombre(f.player) },
        rival: nombre(lado === 'A' ? cruce.playerB : cruce.playerA),
        cambia: (actualJ?.id ?? null) !== f.playerId,
        yaJugado: !!cruce.result || !['pendiente', 'asignado'].includes(cruce.status),
      };
    });

    // Seguridad 1: en esos lugares tienen que estar exactamente los mismos clasificados
    const idsActuales: Set<number> = new Set(); const idsOficiales: Set<number> = new Set();
    for (const it of plan) { if (it.actual.id) idsActuales.add(it.actual.id); idsOficiales.add(it.oficial.id); }
    const mismos = idsActuales.size === n && idsOficiales.size === n && Array.from(idsOficiales).every((id: number) => idsActuales.has(id));
    if (!mismos) { res.status(409).json({ error: 'Los jugadores que hoy estan en los cruces de Primera no coinciden con los clasificados de Segunda. No se toco nada: hay que revisarlo a mano.', plan }); return; }

    const cambios = plan.filter((it: any) => it.cambia).sort((a: any, b: any) => a.cruceNumero - b.cruceNumero);
    // Seguridad 2: no tocar cruces que ya empezaron o tienen resultado
    const bloqueados = cambios.filter((it: any) => it.yaJugado);
    if (bloqueados.length > 0) { res.status(409).json({ error: 'Hay cruces de Primera que ya empezaron o tienen resultado. No se toco nada.', bloqueados, plan }); return; }

    if (!aplicar || cambios.length === 0) { res.json({ aplicado: false, cambios: cambios.length, plan: cambios }); return; }

    const porCruce: Record<number, any> = {};
    for (const it of cambios) {
      if (!porCruce[it.cruceId]) porCruce[it.cruceId] = {};
      if (it.lado === 'A') porCruce[it.cruceId].playerAId = it.oficial.id; else porCruce[it.cruceId].playerBId = it.oficial.id;
    }
    const ids: number[] = Object.keys(porCruce).map((k: string) => parseInt(k));
    await prisma.$transaction(ids.map((id: number) => prisma.match.update({ where: { id }, data: porCruce[id] })));
    for (const id of ids) await checkAndEmitMatch(id);
    res.json({ aplicado: true, cambios: cambios.length, plan: cambios });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
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
      res.json({ ok: true, message: `Bracket de 8 generado con el top 8 del ranking`, partidos: bracketData.length, seeding: top8.map((e: any, i: any) => ({ seed: i+1, nombre: `${e.player.lastName}, ${e.player.firstName}`, puntos: e.points })) });
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
    res.json({ ok: true, message: `Bracket generado con el top 16 del ranking`, partidos: bracketData.length, seeding: top16.map((e: any, i: any) => ({ seed: i+1, nombre: `${e.player.lastName}, ${e.player.firstName}`, puntos: e.points })) });
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

  // venueId: matchea por la mesa ya asignada (partidos ya en mesa) O por
  // pertenecer a una SERIE que ya tiene otro partido con mesa de esa sede
  // (así el partido 3/4/5 de una serie, generado sin mesa aún, hereda la
  // sede correcta). El herencia es por SERIE, no por fase completa: una
  // fase departamental/nacional puede agrupar series de VARIAS sedes a la
  // vez, así que heredar a nivel de fase mezclaría partidos de otras sedes.
  // La herencia se limita a la misma FASE: los serieId ("clasif-serie-1") se repiten entre
  // torneos distintos, así que se compara el par (fase, serie), nunca solo el serieId.
  let seriesDeLaSede: any[] = [];
  if (venueId) {
    const conMesaEnSede = await prisma.match.findMany({
      where: { table: { venueId: Number(venueId) }, serieId: { not: null }, phase: { circuit: { tournament: { active: true } } } },
      select: { phaseId: true, serieId: true },
      distinct: ['phaseId', 'serieId'],
    });
    const porFase: Record<number, string[]> = {};
    for (const m of conMesaEnSede) { if (!m.serieId) continue; if (!porFase[m.phaseId]) porFase[m.phaseId] = []; porFase[m.phaseId].push(m.serieId); }
    seriesDeLaSede = Object.entries(porFase).map(([ph, ids]) => ({ phaseId: Number(ph), serieId: { in: ids } }));
  }

  const matches = await prisma.match.findMany({
    where: {
      ...(phaseId      ? { phaseId: Number(phaseId) }   : {}),
      ...(status       ? { status: status as any }       : {}),
      ...(tableId      ? { tableId: Number(tableId) }    : {}),
      ...(venueId      ? { OR: [{ table: { venueId: Number(venueId) } }, ...seriesDeLaSede] } : {}),
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

// Sustituye un jugador provisorio (slot tipo "Qualy 1") por un jugador real,
// SIN tocar mesa, hora, fase ni serie del partido. lado: 'A' | 'B'.
// playerId=null deja el lugar vacio y vuelve a poner el slot si se envia slotLabel.
router.put('/:id/jugador', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const { lado, playerId, slotLabel } = req.body;
  const matchId = Number(req.params.id);
  if (lado !== 'A' && lado !== 'B') return res.status(400).json({ error: 'lado debe ser A o B' });

  let data: any;
  if (playerId) {
    const jug = await prisma.player.findUnique({ where: { id: Number(playerId) } });
    if (!jug) return res.status(404).json({ error: 'jugador no encontrado' });
    data = lado === 'A'
      ? { playerAId: Number(playerId), slotA: null }
      : { playerBId: Number(playerId), slotB: null };
  } else {
    // limpiar: vuelve a placeholder
    data = lado === 'A'
      ? { playerAId: null, slotA: (slotLabel ?? null) }
      : { playerBId: null, slotB: (slotLabel ?? null) };
  }

  const match = await prisma.match.update({
    where: { id: matchId }, data,
    include: { playerA: { include: { category: true } }, playerB: { include: { category: true } }, table: { include: { venue: true } }, phase: { include: { circuit: { include: { tournament: true } } } }, result: true, sets: { orderBy: { setNumber: 'asc' } } },
  });
  emitMatchUpdate(io, match);
  res.json(match);
});

router.put('/:id/assign', authenticate, requireRole('admin', 'juez_sede'), async (req: AuthRequest, res: Response) => {
  const { tableId } = req.body; const matchId = Number(req.params.id);

  const table = await prisma.table.findUnique({ where: { id: Number(tableId) } });
  if (!table) return res.status(404).json({ error: 'Mesa no encontrada' }) as any;

  // un juez_sede solo puede asignar mesas de SU sede
  if (req.user?.role === 'juez_sede' && req.user.venueId && table.venueId !== req.user.venueId) {
    return res.status(403).json({ error: 'Esa mesa no pertenece a tu sede' }) as any;
  }

  await prisma.table.update({ where: { id: table.id }, data: { status: 'ocupada' } });

  // La herencia de sede para los próximos partidos de la misma serie
  // (generados sin mesa aún) se resuelve al leer /matches?venueId=X por
  // serieId, no guardando la sede a nivel de fase (una fase puede agrupar
  // series de varias sedes a la vez).

  const match = await prisma.match.update({
    where: { id: matchId }, data: { tableId: table.id, status: 'asignado' },
    include: { playerA: { include: { category: true } }, playerB: { include: { category: true } }, table: { include: { venue: true } }, phase: { include: { circuit: { include: { tournament: true } } } }, result: true, sets: { orderBy: { setNumber: 'asc' } } },
  });
  emitMatchUpdate(io, match);
  if (match.table) emitTableUpdate(io, match.table);
  res.json(match);
});

// Anula la asignacion de mesa de un partido: lo vuelve a 'pendiente' sin tableId
// y libera la mesa (solo si no quedo otro partido ocupandola). No borra el partido.
router.put('/:id/desasignar', authenticate, requireRole('admin', 'juez_sede'), async (req: AuthRequest, res: Response) => {
  const matchId = Number(req.params.id);
  const actual = await prisma.match.findUnique({ where: { id: matchId }, include: { table: true } });
  if (!actual) return res.status(404).json({ error: 'Partido no encontrado' }) as any;
  if (actual.status === 'en_juego' || actual.status === 'finalizado') {
    return res.status(409).json({ error: 'No se puede quitar la mesa de un partido en juego o finalizado' }) as any;
  }
  // un juez_sede solo puede desasignar partidos de mesas de SU sede
  if (req.user?.role === 'juez_sede' && req.user.venueId && actual.table && actual.table.venueId !== req.user.venueId) {
    return res.status(403).json({ error: 'Ese partido no pertenece a tu sede' }) as any;
  }
  const tableIdPrev = actual.tableId;

  const match = await prisma.match.update({
    where: { id: matchId }, data: { tableId: null, status: 'pendiente' },
    include: { playerA: { include: { category: true } }, playerB: { include: { category: true } }, table: { include: { venue: true } }, phase: { include: { circuit: { include: { tournament: true } } } }, result: true, sets: { orderBy: { setNumber: 'asc' } } },
  });

  // liberar la mesa solo si no quedo otro partido asignado/en juego en ella
  if (tableIdPrev) {
    const otro = await prisma.match.findFirst({
      where: { tableId: tableIdPrev, status: { in: ['asignado', 'en_juego'] } },
    });
    if (!otro) {
      const libre = await prisma.table.update({ where: { id: tableIdPrev }, data: { status: 'libre' } });
      emitTableUpdate(io, libre);
    }
  }

  emitMatchUpdate(io, match);
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
  const matchId = Number(req.params.id); const { setNumber } = req.body;
  const existingMatch = await prisma.match.findUnique({ where: { id: matchId }, include: { ruleSet: true, sets: true } });
  if (!existingMatch) return res.status(404).json({ error: 'Partido no encontrado' }) as any;
  // El tope de tantos por set es siempre el del reglamento (60): si la planilla trae 61, 62... se guarda 60
  const tope = existingMatch.ruleSet?.pointsPerSet ?? 60;
  const pointsA = Math.min(Number(req.body.pointsA) || 0, tope); const pointsB = Math.min(Number(req.body.pointsB) || 0, tope);
  const winnerId = pointsA > pointsB ? existingMatch.playerAId : existingMatch.playerBId;
  await prisma.setResult.upsert({ where: { id: (existingMatch.sets.find((s: any) => s.setNumber === setNumber)?.id ?? 0) }, create: { matchId, setNumber, pointsA, pointsB, winnerId }, update: { pointsA, pointsB, winnerId } });
  const allSets = await prisma.setResult.findMany({ where: { matchId }, orderBy: { setNumber: 'asc' } });
  const setsA = allSets.filter((s: any) => s.pointsA > s.pointsB).length; const setsB = allSets.filter((s: any) => s.pointsB > s.pointsA).length;
  const totalPtsA = allSets.reduce((acc: any, s: any) => acc + s.pointsA, 0); const totalPtsB = allSets.reduce((acc: any, s: any) => acc + s.pointsB, 0);
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
  const resultadoAnterior = await prisma.matchResult.findUnique({ where: { matchId }, select: { winnerId: true, isWO: true } });
  const ganadorAnterior = resultadoAnterior?.winnerId ?? null;
  const result = await prisma.matchResult.upsert({
    where: { matchId },
    create: { matchId, setsA: finalSetsA, setsB: finalSetsB, pointsA: finalPtsA, pointsB: finalPtsB, winnerId, isWO: !!isWO, woPlayerId, notes },
    update: { setsA: finalSetsA, setsB: finalSetsB, pointsA: finalPtsA, pointsB: finalPtsB, winnerId, isWO: !!isWO, woPlayerId, notes },
  });
  if (!isWO && sets && Array.isArray(sets) && sets.length > 0) {
    const tope = ruleSet?.pointsPerSet ?? 60; // tope de tantos por set (60): 61, 62... se guardan como 60
    const setsOk = sets.map((s: any) => ({ ...s, pointsA: Math.min(Number(s.pointsA) || 0, tope), pointsB: Math.min(Number(s.pointsB) || 0, tope) }));
    await prisma.setResult.deleteMany({ where: { matchId } });
    await prisma.setResult.createMany({ data: setsOk.map((s: any) => ({ matchId, setNumber: s.setNumber, pointsA: s.pointsA, pointsB: s.pointsB, winnerId: s.pointsA > s.pointsB ? existingMatch.playerAId : existingMatch.playerBId })) });
    const totA = setsOk.reduce((a: number, s: any) => a + s.pointsA, 0); const totB = setsOk.reduce((a: number, s: any) => a + s.pointsB, 0);
    await prisma.matchResult.update({ where: { matchId }, data: { pointsA: totA, pointsB: totB } });
    finalPtsA = totA; finalPtsB = totB;
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
  let avisosSerie: string[] = [];
  if (esPartidoDeSerie && eraFinalizado && ganadorAnterior !== winnerId) { avisosSerie = await repropagarSerie(matchId); }
  if (!esPartidoDeSerie && !esNacionalSerie && eraFinalizado && ganadorAnterior && winnerId && ganadorAnterior !== winnerId) { avisosSerie = (await repropagarCruce(matchId, ganadorAnterior, winnerId, existingMatch.finishedAt)).avisos; }
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
    await asignarPuntosCruce(matchId, eraFinalizado && resultadoAnterior ? { winnerId: resultadoAnterior.winnerId, isWO: resultadoAnterior.isWO } : undefined);
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

  res.json({ match: updatedMatch, result, ...(avisosSerie.length ? { avisos: avisosSerie } : {}) });
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
