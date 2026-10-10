// Ranking de los clasificados de una etapa de series (1° y 2° de cada serie).
// Criterio oficial FEBIU: 1) puntos  2) diferencia de sets  3) promedio de tantos (a favor / en contra).
// Los 1° de serie tienen 8 puntos y los 2° tienen 6, asi que primero quedan todos los 1° y despues todos los 2°.
// Se usa en la publicacion "Ranking de Segunda" y para llenar los cruces de Primera.

export interface FilaRankingSerie {
  playerId: number;
  player: any;
  serie: number;
  puestoEnSerie: number; // 1 o 2
  puntos: number;
  setsGanados: number;
  setsPerdidos: number;
  tantos: number;
  tantosContra: number;
}

export function promedioTantos(f: { tantos: number; tantosContra: number }): number {
  if (f.tantosContra > 0) return f.tantos / f.tantosContra;
  return f.tantos > 0 ? 99999 : 0;
}

// Devuelve -1 / 0 / 1 segun el criterio oficial (0 = empate total en los 3 criterios)
export function compararFilas(a: FilaRankingSerie, b: FilaRankingSerie): number {
  if (b.puntos !== a.puntos) return b.puntos - a.puntos;
  const difA = a.setsGanados - a.setsPerdidos;
  const difB = b.setsGanados - b.setsPerdidos;
  if (difB !== difA) return difB - difA;
  const pa = promedioTantos(a);
  const pb = promedioTantos(b);
  if (pb !== pa) return pb - pa;
  return 0;
}

export function ordenarFilasRanking(filas: FilaRankingSerie[]): FilaRankingSerie[] {
  // Si empatan en los 3 criterios se deja por numero de serie (orden estable); el empate se avisa aparte.
  return [...filas].sort((a: FilaRankingSerie, b: FilaRankingSerie) => compararFilas(a, b) || a.serie - b.serie);
}

export function calcularRankingSeries(
  matches: any[],
  prefijo: string
): { filas: FilaRankingSerie[]; totalSeries: number; pendientes: number } {
  const porSerie: Record<string, any[]> = {};
  for (const m of matches) {
    if (typeof m.serieId !== 'string' || !m.serieId.startsWith(prefijo)) continue;
    if (!porSerie[m.serieId]) porSerie[m.serieId] = [];
    porSerie[m.serieId].push(m);
  }

  const ids: string[] = Object.keys(porSerie);
  const filas: FilaRankingSerie[] = [];
  let pendientes = 0;

  for (const sid of ids) {
    const ms: any[] = porSerie[sid];
    const roundBase = Math.min(...ms.map((m: any) => m.round));
    const p3 = ms.find((m: any) => m.round === roundBase + 2); // ganador = 1° de la serie
    const p5 = ms.find((m: any) => m.round === roundBase + 4); // ganador = 2° de la serie
    const primero: number | null = p3?.result?.winnerId ?? null;
    const segundo: number | null = p5?.result?.winnerId ?? null;
    if (!primero || !segundo) { pendientes++; continue; }

    // Sets y tantos de cada jugador en TODOS los partidos de su serie
    const acc: Record<number, { player: any; sg: number; sp: number; tf: number; tc: number }> = {};
    const get = (id: number, player: any) => {
      if (!acc[id]) acc[id] = { player: player ?? null, sg: 0, sp: 0, tf: 0, tc: 0 };
      else if (!acc[id].player && player) acc[id].player = player;
      return acc[id];
    };
    for (const m of ms) {
      if (!m.result) continue;
      let sA = 0, sB = 0, tA = 0, tB = 0;
      if (m.sets && m.sets.length > 0) {
        for (const st of m.sets) {
          tA += st.pointsA; tB += st.pointsB;
          if (st.pointsA > st.pointsB) sA++; else if (st.pointsB > st.pointsA) sB++;
        }
      } else {
        sA = m.result.setsA ?? 0; sB = m.result.setsB ?? 0;
        tA = m.result.pointsA ?? 0; tB = m.result.pointsB ?? 0;
      }
      if (m.playerAId) { const a = get(m.playerAId, m.playerA); a.sg += sA; a.sp += sB; a.tf += tA; a.tc += tB; }
      if (m.playerBId) { const b = get(m.playerBId, m.playerB); b.sg += sB; b.sp += sA; b.tf += tB; b.tc += tA; }
    }

    const serieNum = parseInt(sid.match(/(\d+)$/)?.[1] ?? '0');
    const clasificados: [number, number, number][] = [[primero, 8, 1], [segundo, 6, 2]];
    for (const [pid, pts, puesto] of clasificados) {
      const x = acc[pid] ?? { player: null, sg: 0, sp: 0, tf: 0, tc: 0 };
      filas.push({
        playerId: pid, player: x.player, serie: serieNum, puestoEnSerie: puesto,
        puntos: pts, setsGanados: x.sg, setsPerdidos: x.sp, tantos: x.tf, tantosContra: x.tc,
      });
    }
  }

  return { filas, totalSeries: ids.length, pendientes };
}
