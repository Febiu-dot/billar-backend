// Correccion de los ganadores de la reduccion en Segunda - Canelones Este, Circuito 2 (17/11/2026).
// El sistema ubicaba al ganador del cruce n de la reduccion en el cupo "Clasificado Clasif. #(directos + n)", pero la
// publicacion de la reduccion (y el reglamento que usan los delegados) dice lo contrario: el cruce n clasifica como
// el cupo (cupos - n + 1). Es decir el orden de los cupos de reduccion esta invertido: cruce 1 -> ultimo cupo, ultimo cruce -> primer cupo.
// Cada par de cupos (n, total + 1 - n) se intercambia. Se hace SOLO si los dos partidos de Segunda siguen sin jugar
// (pendiente/asignado, sin resultado ni sets); si alguno ya empezo o termino no se toca y se avisa en el log.
// Es idempotente: despues de aplicarse, los jugadores ya no estan donde se espera encontrarlos y no hace nada.
import prisma from '../services/prisma';

const CIRCUITO = { id: 42, tournamentId: 27, order: 2 };

export async function reubicarGanadoresReduccion(): Promise<void> {
  const circuito = await prisma.circuit.findUnique({ where: { id: CIRCUITO.id }, include: { phases: true } });
  if (!circuito || circuito.tournamentId !== CIRCUITO.tournamentId || circuito.order !== CIRCUITO.order) {
    console.log('ℹ️  Reduccion/Segunda: no existe el Circuito 2 del torneo 27, se omite');
    return;
  }
  const faseClasif = circuito.phases.find((p: any) => p.type === 'clasificatorio');
  const faseSegunda = circuito.phases.find((p: any) => p.type === 'segunda');
  if (!faseClasif || !faseSegunda) return;

  const cupos: number = (circuito.configTorneo as any)?.cuposDesdeClasif ?? 16;
  const reduccion = await prisma.match.findMany({
    where: { phaseId: faseClasif.id, serieId: { startsWith: 'clasif-reduccion-' } },
    include: { result: true },
  });
  const total = reduccion.length;
  const directos = Math.max(0, cupos - total);
  if (total < 2 || directos === 0) return; // sin reduccion, o esquema con repechaje (no aplica)

  const ganadorDe = (n: number): number | null => {
    const m = reduccion.find((x: any) => x.serieId === `clasif-reduccion-${n}`);
    return m?.result?.winnerId ?? null;
  };

  const segunda = await prisma.match.findMany({
    where: { phaseId: faseSegunda.id, serieId: { startsWith: 'segunda-serie-' } },
    include: { result: true, sets: true, playerA: true, playerB: true },
  });
  const numSeries = new Set(segunda.map((m: any) => m.serieId)).size;
  const N2 = numSeries * 4;
  const mitad = N2 / 2;
  const libres = segunda.filter((m: any) => m.playerA?.dni === 'FEBIU000' || m.playerB?.dni === 'FEBIU000').length;
  const S = N2 - cupos - libres; // jugadores de Segunda "propios"; los cupos de Clasificatorio van despues

  // Ubicacion (partido + lado) del cupo "Clasificado Clasif. #j" segun el armado en espejo de las series de Segunda.
  const ubicacion = (j: number): { match: any; lado: 'A' | 'B' } | null => {
    const idx = S + j - 1;
    let serie: number; let p: 1 | 2; let lado: 'A' | 'B';
    if (idx < mitad / 2) { serie = idx; p = 1; lado = 'A'; }
    else if (idx < mitad) { serie = mitad - 1 - idx; p = 2; lado = 'A'; }
    else if (idx < mitad + numSeries) { serie = idx - mitad; p = 2; lado = 'B'; }
    else { serie = N2 - 1 - idx; p = 1; lado = 'B'; }
    const m = segunda.find((x: any) => x.serieId === `segunda-serie-${serie + 1}` && x.round === serie * 10 + p);
    return m ? { match: m, lado } : null;
  };
  const jugadorEn = (u: { match: any; lado: 'A' | 'B' }): number | null => (u.lado === 'A' ? u.match.playerAId : u.match.playerBId);
  const sinJugar = (m: any): boolean => (m.status === 'pendiente' || m.status === 'asignado') && !m.result && (!m.sets || m.sets.length === 0);

  for (let n = 1; n <= Math.floor(total / 2); n++) {
    const n2 = total + 1 - n;
    if (n2 === n) continue;
    const w1 = ganadorDe(n); const w2 = ganadorDe(n2);
    if (!w1 || !w2) continue; // la reduccion todavia no termino
    const u1 = ubicacion(directos + n); const u2 = ubicacion(directos + n2); // donde los dejo el sistema (orden viejo)
    if (!u1 || !u2 || u1.match.id === u2.match.id) continue;
    if (jugadorEn(u1) !== w1 || jugadorEn(u2) !== w2) continue; // ya corregido o tocado a mano: no se toca
    if (!sinJugar(u1.match) || !sinJugar(u2.match)) {
      console.log(`⚠️  Reduccion/Segunda: cruces ${n} y ${n2} NO se intercambian porque un partido (${u1.match.id} o ${u2.match.id}) ya empezo o termino: corregir a mano`);
      continue;
    }
    await prisma.$transaction([
      prisma.match.update({ where: { id: u1.match.id }, data: u1.lado === 'A' ? { playerAId: w2 } : { playerBId: w2 } }),
      prisma.match.update({ where: { id: u2.match.id }, data: u2.lado === 'A' ? { playerAId: w1 } : { playerBId: w1 } }),
    ]);
    console.log(`🔁 Reduccion/Segunda: intercambiados los ganadores de los cruces ${n} y ${n2} (partidos ${u1.match.id} y ${u2.match.id})`);
  }
}
