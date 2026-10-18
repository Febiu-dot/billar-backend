// Alta de la sala "La Sala" (Maldonado) - 18/10/2026.
// Pasa a La Sala (y aplica la categoria 2026) a los jugadores de la planilla "Jugadores_Maldonado_2026",
// y da de alta a los jugadores nuevos con su CI interna MAL0xx.
// Es de UNA SOLA VEZ: solo toca a quien todavia no figura en "La Sala"; despues de aplicarse no vuelve a pisar nada.
import prisma from '../services/prisma';

const CLUB = 'La Sala';

// [CI actual, apellido, nombre, categoria 2026]
const EXISTENTES: [string, string, string, string][] = [
  ['MAL002', 'Curbelo', 'Rodrigo', 'primera'], ['MAL003', 'Hernández', 'Santiago', 'primera'],
  ['MAL005', 'Corbo', 'Jorge', 'segunda'], ['MAL007', 'Robaina', 'Matías', 'segunda'],
  ['MAL008', 'Silvera', 'Enrique', 'segunda'], ['MAL011', 'de León', 'Matías', 'primera'],
  ['MAL012', 'Rodríguez', 'Luis', 'segunda'], ['MAL014', 'Pérez', 'Mario', 'tercera'],
  ['MAL016', 'Rodríguez', 'Simone', 'tercera'], ['MAL018', 'Soria', 'Jhonatan', 'tercera'],
  ['MAL021', 'Casaravilla', 'Rubén', 'tercera'], ['MAL022', 'Velázquez', 'Javier', 'tercera'],
  ['MAL023', 'Guerra', 'Karina', 'tercera'], ['MAL024', 'Rocha', 'Patricia', 'tercera'],
  ['MAL025', 'Castro', 'Miguel', 'tercera'], ['MAL026', 'Lapasta', 'Alejandro', 'primera'],
  ['MAL028', 'Bevilacqua', 'Wilson', 'tercera'], ['MAL029', 'Gómez', 'Martín', 'tercera'],
  ['MAL030', 'Baubetta', 'Homero', 'segunda'], ['MAL031', 'Origoni', 'Héctor', 'tercera'],
  ['MAL032', 'Fontes', 'Luis', 'segunda'],
];

// [apellido, nombre, categoria 2026]
const NUEVOS: [string, string, string][] = [
  ['Rodríguez', 'Darío', 'tercera'], ['Correa', 'José', 'tercera'], ['González', 'Enrique', 'tercera'],
  ['de los Santos', 'Simón', 'tercera'], ['Estévez', 'Andrés', 'tercera'], ['Sternguber', 'Gabriel', 'segunda'],
  ['Hirigoyen', 'Félix', 'tercera'], ['Pimienta', 'Carlos', 'tercera'], ['Cabana', 'Eduardo', 'tercera'],
  ['Cabana', 'Sebastián', 'segunda'], ['Lukais', 'Héber', 'tercera'], ['Reyes', 'Jonny', 'tercera'],
];

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

export async function aplicarAltaLaSala(): Promise<void> {
  const dep = await prisma.departamento.findFirst({ where: { nombre: 'Maldonado' } });
  if (!dep) { console.log('ℹ️  La Sala: no existe el departamento Maldonado, se omite'); return; }
  const cats = await prisma.category.findMany();
  const catId = (n: string) => cats.find((c: any) => c.name === n)?.id;

  // 1) Jugadores existentes: club + categoria
  let movidos = 0;
  for (const [dni, apellido, nombre, cat] of EXISTENTES) {
    const p = await prisma.player.findUnique({ where: { dni }, include: { category: true } });
    if (!p) { console.log(`⚠️  La Sala: no existe ${dni} (${apellido}, ${nombre})`); continue; }
    if (norm(p.lastName) !== norm(apellido) && !(norm(apellido).replace(/ /g, '') === norm(p.lastName).replace(/ /g, ''))) {
      console.log(`⚠️  La Sala: ${dni} no coincide el apellido (sistema "${p.lastName}", planilla "${apellido}"), se omite`);
      continue;
    }
    if (p.club === CLUB) continue; // ya aplicado
    const data: any = { club: CLUB };
    const cid = catId(cat);
    if (cid && cid !== p.categoryId) data.categoryId = cid;
    await prisma.player.update({ where: { id: p.id }, data });
    movidos++;
    console.log(`✏️  La Sala: ${dni} ${p.lastName}, ${p.firstName}: club "${p.club}" → "${CLUB}"` + (data.categoryId ? `, categoría ${p.category?.name} → ${cat}` : ''));
  }

  // 2) Jugadores nuevos
  const maldonado = await prisma.player.findMany({ where: { departamentoId: dep.id } });
  const todosMAL = await prisma.player.findMany({ where: { dni: { startsWith: 'MAL' } }, select: { dni: true } });
  let siguiente = Math.max(0, ...todosMAL.map((x: any) => parseInt(String(x.dni).replace(/\D/g, ''), 10) || 0)) + 1;
  let creados = 0;
  for (const [apellido, nombre, cat] of NUEVOS) {
    const ya = maldonado.find((p: any) => norm(p.lastName) === norm(apellido) && norm(p.firstName) === norm(nombre));
    if (ya) continue; // ya cargado
    const cid = catId(cat);
    if (!cid) continue;
    const dni = `MAL${String(siguiente).padStart(3, '0')}`;
    siguiente++;
    const nuevo = await prisma.player.create({
      data: { firstName: nombre, lastName: apellido, dni, categoryId: cid, club: CLUB, pais: 'Uruguay', departamentoId: dep.id, active: true },
    });
    maldonado.push(nuevo);
    creados++;
    console.log(`➕ La Sala: alta ${dni} ${apellido}, ${nombre} (${cat})`);
  }
  console.log(`✅ La Sala: ${movidos} jugadores pasados a La Sala, ${creados} jugadores nuevos`);
}
