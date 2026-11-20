import prisma from './prisma';
import { io } from '../index';
import { emitMatchUpdate, emitTableUpdate } from './socketService';

const INCLUDE_MATCH = {
  playerA: { include: { category: true } },
  playerB: { include: { category: true } },
  table: { include: { venue: true } },
  phase: { include: { circuit: { include: { tournament: true } } } },
  result: true,
  sets: { orderBy: { setNumber: 'asc' as const } },
};

// Cuando una mesa queda libre, se la da al partido que sigue en la cola "Mesa libre" de esa sede.
// El orden de la cola es: horario cargado (los sin horario van al final) y despues el orden de creacion.
// Solo entran partidos pendientes con los dos jugadores ya definidos y de torneos activos.
// Nunca rompe el flujo que lo llama: cualquier error se registra y se sigue.
export async function asignarMesaLibreSiguiente(tableId: number | null | undefined): Promise<void> {
  try {
    if (!tableId) return;
    const mesa = await prisma.table.findUnique({ where: { id: tableId }, include: { venue: true } });
    if (!mesa || mesa.status === 'fuera_de_servicio') return;

    // la mesa debe estar realmente libre: sin otro partido asignado o en juego
    const ocupada = await prisma.match.findFirst({ where: { tableId: mesa.id, status: { in: ['asignado', 'en_juego'] } } });
    if (ocupada) return;

    const candidatos = await prisma.match.findMany({
      where: {
        mesaLibreSedeId: mesa.venueId,
        status: 'pendiente',
        tableId: null,
        playerAId: { not: null },
        playerBId: { not: null },
        phase: { circuit: { tournament: { active: true } } },
      },
      orderBy: [{ scheduledAt: { sort: 'asc', nulls: 'last' } }, { round: 'asc' }, { id: 'asc' }],
      take: 1,
    });
    const siguiente = candidatos[0];
    if (!siguiente) return;

    const ocupadaMesa = await prisma.table.update({ where: { id: mesa.id }, data: { status: 'ocupada' }, include: { venue: true } });
    const match = await prisma.match.update({
      where: { id: siguiente.id },
      data: { tableId: mesa.id, status: 'asignado', mesaLibreSedeId: null },
      include: INCLUDE_MATCH,
    });
    emitTableUpdate(io, ocupadaMesa);
    emitMatchUpdate(io, match);
  } catch (e) {
    console.error('Error asignando mesa libre al siguiente partido (no critico):', e);
  }
}
