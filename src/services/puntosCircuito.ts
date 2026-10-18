// Puntos del ranking de un circuito DEPARTAMENTAL.
//
// Regla oficial FEBIU (17/10/2026):
//   Series de clasificatorio y de Segunda: 1° = 8 · 2° = 6 · 3° = 4 · 4° = 2
//   Cruces de reduccion / repechaje:        0 puntos
//   Cruces de Primera, cruces Master, octavos, cuartos, semifinales: ganador 5 · perdedor 1
//   Final: campeon 7 · subcampeon 2
//   Puntos por ESPERA (jugadores que ingresan directo a una etapa posterior):
//     al disputarse el clasificatorio: +8 a quienes esperan (Segunda, Primera, Master)
//     al disputarse las series de Segunda: +8 a quienes siguen esperando (Primera, Master)
//     al disputarse los cruces de Primera: +5 a los Master
//   => entra a Segunda con 8, a Primera con 16, a Master con 21.
//
// IMPORTANTE: los puntos se CALCULAN desde cero a partir de los partidos (no se suman de a poco).
// Asi nunca se duplican, aunque se cargue, corrija o recalcule un resultado.
// W.O.: el ganador por W.O. suma los puntos de ganador; el ausente no suma (18/10).
//
// Nacional / Panamericano NO usan esta regla (conservan su calculo propio).

import prisma from './prisma';

const LIBRE_DNI = 'FEBIU000';
const ORDEN_FASES = ['clasificatorio', 'segunda', 'primera', 'master'] as const;
type TipoFase = typeof ORDEN_FASES[number];

export const PUNTOS_ESPERA: Record<'clasificatorio' | 'segunda' | 'primera', number> = {
  clasificatorio: 8, // lo reciben quienes ingresan en Segunda, Primera o Master
  segunda: 8,        // lo reciben quienes ingresan en Primera o Master
  primera: 5,        // lo reciben quienes ingresan en Master
};

export function esConfigNacional(config: any): boolean {
  return config?.tipo === 'nacional' || config?.tipo === 'panamericano';
}

export interface PuntosJugador { resultados: number; espera: number; total: number; }

// Puntos por resultados. `matches` = partidos finalizados/wo del circuito, con `result` y `phase`.
export function puntosPorResultados(matches: any[]): Map<number, number> {
  const pts = new Map<number, number>();
  const add = (playerId: number | null | undefined, n: number) => {
    if (!playerId) return;
    pts.set(playerId, (pts.get(playerId) ?? 0) + n);
  };
  const perdedor = (m: any, winnerId: number) => (m.playerAId === winnerId ? m.playerBId : m.playerAId);

  // Series (clasificatorio y Segunda): P3 = 1°, P5 = 2°/3°, P4 = 4°
  const porSerie: Record<string, any[]> = {};
  for (const m of matches) {
    if (!m.serieId) continue;
    if (!m.serieId.startsWith('clasif-serie-') && !m.serieId.startsWith('segunda-serie-')) continue;
    (porSerie[m.serieId] ??= []).push(m);
  }
  for (const ms of Object.values(porSerie)) {
    const base = Math.min(...ms.map((m: any) => m.round));
    const p3 = ms.find((m: any) => m.round === base + 2);
    const p4 = ms.find((m: any) => m.round === base + 3);
    const p5 = ms.find((m: any) => m.round === base + 4);
    if (p3?.result?.winnerId) add(p3.result.winnerId, 8);
    if (p4?.result?.winnerId) add(perdedor(p4, p4.result.winnerId), 2);
    if (p5?.result?.winnerId) {
      add(p5.result.winnerId, 6);
      add(perdedor(p5, p5.result.winnerId), 4);
    }
  }

  // Cruces de Primera y de Master (octavos, cuartos, semis): 5 / 1. Final: 7 / 2. Reduccion y repechaje: 0.
  for (const m of matches) {
    const tipo = m.phase?.type;
    if (tipo !== 'primera' && tipo !== 'master') continue;
    if (!m.result?.winnerId) continue;
    const esFinal = tipo === 'master' && m.serieId === 'master-final';
    // W.O.: quien avanza suma los puntos de ganador (igual que en las series); el que no se presenta no suma.
    add(m.result.winnerId, esFinal ? 7 : 5);
    if (!m.result.isWO) add(perdedor(m, m.result.winnerId), esFinal ? 2 : 1);
  }
  return pts;
}

// Puntos por espera. Cada etapa se considera "disputada" cuando ya hay al menos un partido
// terminado en ella (sin contar los W.O. automaticos del jugador LIBRE).
// El jugador ingresa en la primera etapa en la que aparece en un partido.
export function puntosPorEspera(fases: any[]): Map<number, number> {
  const pts = new Map<number, number>();
  const matchesDe = (tipo: TipoFase): any[] =>
    fases.filter((f: any) => f.type === tipo).flatMap((f: any) => f.matches ?? []);
  const esLibre = (m: any) => m.playerA?.dni === LIBRE_DNI || m.playerB?.dni === LIBRE_DNI;
  const disputada = (tipo: TipoFase) =>
    matchesDe(tipo).some((m: any) => (m.status === 'finalizado' || m.status === 'wo') && !esLibre(m));

  // Etapa de ingreso de cada jugador (indice en ORDEN_FASES)
  const ingreso = new Map<number, number>();
  ORDEN_FASES.forEach((tipo, idx) => {
    for (const m of matchesDe(tipo)) {
      const lados: [number | null, any][] = [[m.playerAId, m.playerA], [m.playerBId, m.playerB]];
      for (const [pid, jugador] of lados) {
        if (!pid || jugador?.dni === LIBRE_DNI) continue;
        if (!ingreso.has(pid)) ingreso.set(pid, idx);
      }
    }
  });

  const dClasif = disputada('clasificatorio');
  const dSegunda = disputada('segunda');
  const dPrimera = disputada('primera');
  for (const [pid, idx] of ingreso) {
    let n = 0;
    if (idx >= 1 && dClasif)  n += PUNTOS_ESPERA.clasificatorio;
    if (idx >= 2 && dSegunda) n += PUNTOS_ESPERA.segunda;
    if (idx >= 3 && dPrimera) n += PUNTOS_ESPERA.primera;
    if (n > 0) pts.set(pid, n);
  }
  return pts;
}

// Calculo completo de un circuito departamental. Devuelve null si es Nacional/Panamericano.
export async function calcularPuntosCircuito(circuitId: number): Promise<Map<number, PuntosJugador> | null> {
  const circuit = await prisma.circuit.findUnique({ where: { id: circuitId }, select: { configTorneo: true } });
  if (!circuit || esConfigNacional(circuit.configTorneo)) return null;

  const fases = await prisma.phase.findMany({
    where: { circuitId },
    include: {
      matches: {
        include: { result: true, phase: true, playerA: { select: { dni: true } }, playerB: { select: { dni: true } } },
      },
    },
  });
  const terminados = fases
    .flatMap((f: any) => f.matches)
    .filter((m: any) => (m.status === 'finalizado' || m.status === 'wo') && m.result);

  const res = puntosPorResultados(terminados);
  const esp = puntosPorEspera(fases);

  const out = new Map<number, PuntosJugador>();
  const ids = new Set<number>([...res.keys(), ...esp.keys()]);
  for (const id of ids) {
    const r = res.get(id) ?? 0;
    const e = esp.get(id) ?? 0;
    out.set(id, { resultados: r, espera: e, total: r + e });
  }
  return out;
}

// Deja RankingEntry.points = total calculado (resultados + espera). Idempotente: se puede llamar
// todas las veces que haga falta. No toca nada en Nacional/Panamericano.
export async function sincronizarPuntosCircuito(circuitId: number): Promise<{ aplicado: boolean; cambios: number }> {
  try {
    const calculo = await calcularPuntosCircuito(circuitId);
    if (!calculo) return { aplicado: false, cambios: 0 };
    const entradas = await prisma.rankingEntry.findMany({ where: { circuitId } });
    let cambios = 0;
    for (const e of entradas) {
      const total = calculo.get(e.playerId)?.total ?? 0;
      if (e.points !== total) {
        await prisma.rankingEntry.update({ where: { id: e.id }, data: { points: total } });
        cambios++;
      }
    }
    return { aplicado: true, cambios };
  } catch (err) {
    console.error('Error sincronizando puntos del circuito', circuitId, err);
    return { aplicado: false, cambios: 0 };
  }
}
