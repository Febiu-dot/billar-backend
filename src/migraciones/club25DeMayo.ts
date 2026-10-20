// Correccion del club de Flores - 20/10/2026.
// La sede se habia cargado como "25 de agosto" pero el nombre correcto es "25 de mayo".
// La sede ya fue renombrada; esto pasa a "25 de mayo" a los jugadores de Flores que quedaron en "25 de agosto".
// Es idempotente: despues de aplicarse no encuentra nada para cambiar. Solo toca jugadores del departamento Flores.
import prisma from '../services/prisma';

const CLUB_VIEJO = '25 de agosto';
const CLUB_NUEVO = '25 de Mayo'; // igual que el nombre de la sede

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

export async function corregirClub25DeMayo(): Promise<void> {
  const dep = await prisma.departamento.findFirst({ where: { nombre: 'Flores' } });
  if (!dep) { console.log('ℹ️  Club 25 de mayo: no existe el departamento Flores, se omite'); return; }

  const jugadores = await prisma.player.findMany({
    where: { departamentoId: dep.id, club: { not: null } },
    select: { id: true, firstName: true, lastName: true, club: true },
  });

  let cambiados = 0;
  for (const p of jugadores) {
    const n = norm(p.club as string);
    // "25 de agosto" (error) o "25 de mayo" mal escrito en minuscula: ambos quedan como "25 de Mayo"
    if (n !== norm(CLUB_VIEJO) && !(n === norm(CLUB_NUEVO) && p.club !== CLUB_NUEVO)) continue;
    await prisma.player.update({ where: { id: p.id }, data: { club: CLUB_NUEVO } });
    cambiados++;
    console.log(`✏️  Club 25 de mayo: ${p.lastName}, ${p.firstName}: "${p.club}" → "${CLUB_NUEVO}"`);
  }

  // Aviso (no se toca): jugadores de otros departamentos que figuren en "25 de agosto".
  const otros = await prisma.player.count({
    where: { departamentoId: { not: dep.id }, club: { equals: CLUB_VIEJO, mode: 'insensitive' } },
  });
  if (otros > 0) console.log(`ℹ️  Club 25 de mayo: ${otros} jugadores de otros departamentos figuran en "${CLUB_VIEJO}"; no se tocan`);

  if (cambiados > 0) console.log(`✅ Club 25 de mayo: ${cambiados} jugadores de Flores pasados de "${CLUB_VIEJO}" a "${CLUB_NUEVO}"`);
}
