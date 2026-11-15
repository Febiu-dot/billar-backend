// Correccion del W.O. - 15/11/2026.
// Regla oficial: un W.O. cuenta como ganar sin perder ningun set: setsToWin sets x pointsPerSet tantos a favor, 0 en contra
// (series al mejor de 3: 2-0 / 120; cruces al mejor de 5: 3-0 / 180).
// El reglamento "Cruces (mejor de 5)" tenia cargado 5-0 / 300, lo que inflaba sets y tantos de quien ganaba por W.O.
//
// 1) Deja los valores de W.O. de TODOS los reglamentos iguales a setsToWin / setsToWin x pointsPerSet (vale para lo que se cargue de ahora en adelante).
// 2) Corrige los W.O. ya cargados SOLO en el Circuito 2 del torneo 30 (Montevideo). El Circuito 1 se deja como esta.
// Es idempotente: despues de aplicarse no encuentra nada para cambiar.
import prisma from '../services/prisma';
import { sincronizarPuntosCircuito } from '../services/puntosCircuito';

const CIRCUITO_A_CORREGIR = { id: 41, tournamentId: 30, order: 2 };

export async function corregirWOTresCero(): Promise<void> {
  // 1) Reglamentos
  const reglas = await prisma.ruleSet.findMany();
  for (const r of reglas) {
    const sets = r.setsToWin;
    const pts = r.setsToWin * r.pointsPerSet;
    if (r.woSetsWinner !== sets || r.woPtsWinner !== pts || r.woSetsLoser !== 0 || r.woPtsLoser !== 0) {
      await prisma.ruleSet.update({ where: { id: r.id }, data: { woSetsWinner: sets, woSetsLoser: 0, woPtsWinner: pts, woPtsLoser: 0 } });
      console.log(`✏️  W.O. reglamento "${r.name}": ${r.woSetsWinner}-${r.woSetsLoser} / ${r.woPtsWinner} → ${sets}-0 / ${pts}`);
    }
  }

  // 2) Partidos ya cargados del Circuito 2 (torneo 30)
  const circuito = await prisma.circuit.findUnique({ where: { id: CIRCUITO_A_CORREGIR.id }, select: { id: true, tournamentId: true, order: true } });
  if (!circuito || circuito.tournamentId !== CIRCUITO_A_CORREGIR.tournamentId || circuito.order !== CIRCUITO_A_CORREGIR.order) {
    console.log('ℹ️  W.O. 3-0: no existe el Circuito 2 del torneo 30, se omite');
    return;
  }
  const partidos = await prisma.match.findMany({
    where: { phase: { circuitId: circuito.id }, result: { is: { isWO: true } } },
    include: { result: true, ruleSet: true },
  });
  let corregidos = 0;
  for (const m of partidos) {
    const res = m.result;
    if (!res || !m.ruleSet || !res.woPlayerId || !res.winnerId) continue; // doble W.O. o sin datos: no se toca
    const sets = m.ruleSet.setsToWin;
    const pts = m.ruleSet.setsToWin * m.ruleSet.pointsPerSet;
    const gana = res.winnerId === m.playerAId ? 'A' : res.winnerId === m.playerBId ? 'B' : null;
    if (!gana) continue;
    const nuevo = gana === 'A'
      ? { setsA: sets, setsB: 0, pointsA: pts, pointsB: 0 }
      : { setsA: 0, setsB: sets, pointsA: 0, pointsB: pts };
    if (res.setsA === nuevo.setsA && res.setsB === nuevo.setsB && res.pointsA === nuevo.pointsA && res.pointsB === nuevo.pointsB) continue;
    await prisma.matchResult.update({ where: { matchId: m.id }, data: nuevo });
    corregidos++;
    console.log(`✏️  W.O. partido ${m.id} (circuito ${circuito.id}): ${res.setsA}-${res.setsB} / ${res.pointsA}-${res.pointsB} → ${nuevo.setsA}-${nuevo.setsB} / ${nuevo.pointsA}-${nuevo.pointsB}`);
  }

  // Deja RankingEntry del circuito alineado con los partidos corregidos
  if (corregidos > 0) {
    const r = await sincronizarPuntosCircuito(circuito.id);
    console.log(`✏️  W.O. 3-0: ${corregidos} partidos corregidos; ranking del circuito ${circuito.id} resincronizado (${r.cambios} jugadores con cambios)`);
  }
}
