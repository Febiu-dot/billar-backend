import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed...');

  // Categorías
  const catMaster   = await prisma.category.upsert({ where: { name: 'master' },   update: {}, create: { name: 'master' } });
  const catPrimera  = await prisma.category.upsert({ where: { name: 'primera' },  update: {}, create: { name: 'primera' } });
  const catSegunda  = await prisma.category.upsert({ where: { name: 'segunda' },  update: {}, create: { name: 'segunda' } });
  const catTercera  = await prisma.category.upsert({ where: { name: 'tercera' },  update: {}, create: { name: 'tercera' } });
  console.log('✅ Categorías creadas');

  // Usuarios
  const pass = await bcrypt.hash('admin123', 10);
  const passJuez = await bcrypt.hash('juez123', 10);
  await prisma.user.upsert({ where: { username: 'admin' },   update: {}, create: { username: 'admin',   password: pass,                                    role: 'admin' } });
  await prisma.user.upsert({ where: { username: 'juez1' },   update: {}, create: { username: 'juez1',   password: passJuez,                                role: 'juez_sede' } });
  await prisma.user.upsert({ where: { username: 'publico' }, update: {}, create: { username: 'publico', password: await bcrypt.hash('publico123', 10),      role: 'publico' } });
  console.log('✅ Usuarios creados');

  // Jugadores reales — ranking 2026-2027
  const jugadoresData = [
    // MASTER (1-8)
    { firstName: 'Matias',      lastName: 'Fonsalia',     club: 'Capolavoro',     categoryId: catMaster.id },
    { firstName: 'Maximiliano', lastName: 'Poggi',        club: 'Feria Franca',   categoryId: catMaster.id },
    { firstName: 'Dario',       lastName: 'Maiorana',     club: 'Yatay',          categoryId: catMaster.id },
    { firstName: 'Andres',      lastName: 'Lajuni',       club: 'Cabrera',        categoryId: catMaster.id },
    { firstName: 'Nestor',      lastName: 'Gonzalez',     club: 'Model Center',   categoryId: catMaster.id },
    { firstName: 'Damian',      lastName: 'Serron',       club: 'Feria Franca',   categoryId: catMaster.id },
    { firstName: 'Roque',       lastName: 'Santangelo',   club: 'Nuevo Malvin',   categoryId: catMaster.id },
    { firstName: 'Maximiliano', lastName: 'Durand',       club: 'Yatay',          categoryId: catMaster.id },
    // PRIMERA (9-43)
    { firstName: 'Emilio',      lastName: 'Broggini',     club: 'Capolavoro',     categoryId: catPrimera.id },
    { firstName: 'Adrian',      lastName: 'Marrero',      club: 'Feria Franca',   categoryId: catPrimera.id },
    { firstName: 'Luis',        lastName: 'Rivera',       club: 'Sporting Union', categoryId: catPrimera.id },
    { firstName: 'Alvaro',      lastName: 'Gomez',        club: 'Cabrera',        categoryId: catPrimera.id },
    { firstName: 'Darwin',      lastName: 'Pumar',        club: 'Cabrera',        categoryId: catPrimera.id },
    { firstName: 'Leonardo',    lastName: 'Paternosto',   club: 'Feria Franca',   categoryId: catPrimera.id },
    { firstName: 'Jorge',       lastName: 'Claro',        club: 'Cabrera',        categoryId: catPrimera.id },
    { firstName: 'Rodrigo',     lastName: 'Ferdinand',    club: 'Capolavoro',     categoryId: catPrimera.id },
    { firstName: 'Pablo',       lastName: 'Quesada',      club: 'Casa del Billar',categoryId: catPrimera.id },
    { firstName: 'Sergio',      lastName: 'Rossi',        club: 'Feria Franca',   categoryId: catPrimera.id },
    { firstName: 'Miguel',      lastName: 'Garcia',       club: 'Yatay',          categoryId: catPrimera.id },
    { firstName: 'Daniel',      lastName: 'Pratto',       club: 'Capolavoro',     categoryId: catPrimera.id },
    { firstName: 'Eduardo',     lastName: 'Sasias',       club: 'Capolavoro',     categoryId: catPrimera.id },
    { firstName: 'Nelson',      lastName: 'Blanco',       club: 'Capolavoro',     categoryId: catPrimera.id },
    { firstName: 'Miguel',      lastName: 'Morales',      club: 'Model Center',   categoryId: catPrimera.id },
    { firstName: 'Willy',       lastName: 'Macedo',       club: 'Capolavoro',     categoryId: catPrimera.id },
    { firstName: 'Marcelo',     lastName: 'Gabrielle',    club: 'Feria Franca',   categoryId: catPrimera.id },
    { firstName: 'Richard',     lastName: 'Osores',       club: 'Cabrera',        categoryId: catPrimera.id },
    { firstName: 'Gustavo',     lastName: 'Etchart',      club: 'Feria Franca',   categoryId: catPrimera.id },
    { firstName: 'Pedro',       lastName: 'Camelo',       club: 'Yatay',          categoryId: catPrimera.id },
    { firstName: 'Wilfredo',    lastName: 'Paz',          club: 'Capolavoro',     categoryId: catPrimera.id },
    { firstName: 'Gustavo',     lastName: 'Castillo',     club: 'Cabrera',        categoryId: catPrimera.id },
    { firstName: 'Diego',       lastName: 'Gimenez',      club: 'Centenario',     categoryId: catPrimera.id },
    { firstName: 'Walter',      lastName: 'Amado',        club: 'Feria Franca',   categoryId: catPrimera.id },
    { firstName: 'Mario',       lastName: 'Sansebastian', club: 'Yatay',          categoryId: catPrimera.id },
    { firstName: 'Carlos',      lastName: 'Garcia',       club: 'Centenario',     categoryId: catPrimera.id },
    { firstName: 'Fernando',    lastName: 'Michelena',    club: 'Feria Franca',   categoryId: catPrimera.id },
    { firstName: 'Agustin',     lastName: 'Sosa',         club: 'Capolavoro',     categoryId: catPrimera.id },
    { firstName: 'Antonio',     lastName: 'Labat',        club: 'Yatay',          categoryId: catPrimera.id },
    { firstName: 'Richard',     lastName: 'Rondan',       club: 'Cabrera',        categoryId: catPrimera.id },
    { firstName: 'Jose',        lastName: 'Coppola',      club: 'Yatay',          categoryId: catPrimera.id },
    { firstName: 'Daniel',      lastName: 'Lapunov',      club: 'Nuevo Malvin',   categoryId: catPrimera.id },
    { firstName: 'Dario',       lastName: 'Clavijo',      club: 'Cabrera',        categoryId: catPrimera.id },
    { firstName: 'Carlos',      lastName: 'Sosa',         club: 'Centenario',     categoryId: catPrimera.id },
    { firstName: 'Santiago',    lastName: 'Rondan',       club: 'Cabrera',        categoryId: catPrimera.id },
    // SEGUNDA (44-83)
    { firstName: 'Jorge',       lastName: 'Camarotte',    club: 'Yatay',          categoryId: catSegunda.id },
    { firstName: 'Dardo',       lastName: 'Blanco',       club: 'Capolavoro',     categoryId: catSegunda.id },
    { firstName: 'William',     lastName: 'Gonzalez',     club: 'Cabrera',        categoryId: catSegunda.id },
    { firstName: 'Alvaro',      lastName: 'Uran',         club: 'Feria Franca',   categoryId: catSegunda.id },
    { firstName: 'Marcelo',     lastName: 'Alvez',        club: 'Yatay',          categoryId: catSegunda.id },
    { firstName: 'Ari',         lastName: 'Camargo',      club: 'Capolavoro',     categoryId: catSegunda.id },
    { firstName: 'Marcelo',     lastName: 'Rodriguez',    club: 'Capolavoro',     categoryId: catSegunda.id },
    { firstName: 'Juan',        lastName: 'Muniz',        club: 'Model Center',   categoryId: catSegunda.id },
    { firstName: 'Hector',      lastName: 'Camarotte',    club: 'Yatay',          categoryId: catSegunda.id },
    { firstName: 'Alejandro',   lastName: 'Spinetti',     club: 'Model Center',   categoryId: catSegunda.id },
    { firstName: 'Gerardo',     lastName: 'Sarraute',     club: 'Piedra Honda',   categoryId: catSegunda.id },
    { firstName: 'Edgardo',     lastName: 'Betervide',    club: 'Model Center',   categoryId: catSegunda.id },
    { firstName: 'Jesus',       lastName: 'Nebot',        club: 'Model Center',   categoryId: catSegunda.id },
    { firstName: 'Norberto',    lastName: 'Rosas',        club: 'Nuevo Malvin',   categoryId: catSegunda.id },
    { firstName: 'Carlos',      lastName: 'Santos',       club: 'Cabrera',        categoryId: catSegunda.id },
    { firstName: 'Jesus',       lastName: 'Gonzalez',     club: 'Centenario',     categoryId: catSegunda.id },
    { firstName: 'Sergio',      lastName: 'Migues',       club: 'Centenario',     categoryId: catSegunda.id },
    { firstName: 'Facundo',     lastName: 'Rodriguez',    club: 'Capolavoro',     categoryId: catSegunda.id },
    { firstName: 'Esteban',     lastName: 'Bishmishian',  club: 'Cabrera',        categoryId: catSegunda.id },
    { firstName: 'Gabriel',     lastName: 'Panaras',      club: 'Model Center',   categoryId: catSegunda.id },
    { firstName: 'Julio',       lastName: 'Mañe',         club: 'Capolavoro',     categoryId: catSegunda.id },
    { firstName: 'Fabian',      lastName: 'Marsico',      club: 'Cabrera',        categoryId: catSegunda.id },
    { firstName: 'Julio',       lastName: 'Sosa',         club: 'Centenario',     categoryId: catSegunda.id },
    { firstName: 'Roberto',     lastName: 'Gandini',      club: 'Nuevo Malvin',   categoryId: catSegunda.id },
    { firstName: 'Ramiro',      lastName: 'Galvan',       club: 'Centenario',     categoryId: catSegunda.id },
    { firstName: 'Leonardo',    lastName: 'Suarez',       club: 'Model Center',   categoryId: catSegunda.id },
    { firstName: 'Enrique',     lastName: 'Santana',      club: 'Model Center',   categoryId: catSegunda.id },
    { firstName: 'Sergio',      lastName: 'Quesada',      club: 'Casa del Billar',categoryId: catSegunda.id },
    { firstName: 'Miguel',      lastName: 'Freitas',      club: 'Centenario',     categoryId: catSegunda.id },
    { firstName: 'Aldo',        lastName: 'Berneche',     club: 'Sporting Union', categoryId: catSegunda.id },
    { firstName: 'Ricardo',     lastName: 'Magnano',      club: 'Sporting Union', categoryId: catSegunda.id },
    { firstName: 'Julio',       lastName: 'Trias',        club: 'Feria Franca',   categoryId: catSegunda.id },
    { firstName: 'Gustavo',     lastName: 'Mayo',         club: 'Cabrera',        categoryId: catSegunda.id },
    { firstName: 'Walter',      lastName: 'Saldaña',      club: 'Yatay',          categoryId: catSegunda.id },
    { firstName: 'Pablo',       lastName: 'Baraldo',      club: 'Model Center',   categoryId: catSegunda.id },
    { firstName: 'Gerardo',     lastName: 'Correa',       club: 'Feria Franca',   categoryId: catSegunda.id },
    { firstName: 'Diego',       lastName: 'Beux',         club: 'Feria Franca',   categoryId: catSegunda.id },
    { firstName: 'Robert',      lastName: 'Gonzalez',     club: 'Cabrera',        categoryId: catSegunda.id },
    { firstName: 'Juan',        lastName: 'Ovelar',       club: 'Nuevo Malvin',   categoryId: catSegunda.id },
    { firstName: 'Edgardo',     lastName: 'Denis',        club: 'Yatay',          categoryId: catSegunda.id },
    // TERCERA (84-131)
    { firstName: 'Marcelo',     lastName: 'Gonzalez',     club: 'Yatay',          categoryId: catTercera.id },
    { firstName: 'Richard',     lastName: 'Garcia',       club: 'Yatay',          categoryId: catTercera.id },
    { firstName: 'Miguel',      lastName: 'Fonseca',      club: 'Capolavoro',     categoryId: catTercera.id },
    { firstName: 'Daniel',      lastName: 'Lapaz',        club: 'Cabrera',        categoryId: catTercera.id },
    { firstName: 'Antonio',     lastName: 'Rabellino',    club: 'Centenario',     categoryId: catTercera.id },
    { firstName: 'Victor',      lastName: 'Baliña',       club: 'Centenario',     categoryId: catTercera.id },
    { firstName: 'Sebastian',   lastName: 'Quesada',      club: 'Casa del Billar',categoryId: catTercera.id },
    { firstName: 'Juan',        lastName: 'Carlos',       club: 'Casa del Billar',categoryId: catTercera.id },
    { firstName: 'Victor',      lastName: 'Vidart',       club: 'Casa del Billar',categoryId: catTercera.id },
    { firstName: 'Bruno',       lastName: 'Gonzalez',     club: 'Cabrera',        categoryId: catTercera.id },
    { firstName: 'Edgardo',     lastName: 'Umpierr',      club: 'Capolavoro',     categoryId: catTercera.id },
    { firstName: 'Alvaro',      lastName: 'Maldonado',    club: 'Centenario',     categoryId: catTercera.id },
    { firstName: 'Axel',        lastName: 'Chiberriaga',  club: 'Capolavoro',     categoryId: catTercera.id },
    { firstName: 'Richard',     lastName: 'Croza',        club: 'Nuevo Malvin',   categoryId: catTercera.id },
    { firstName: 'Fernando',    lastName: 'Rodriguez',    club: 'Model Center',   categoryId: catTercera.id },
    { firstName: 'Marcelo',     lastName: 'Camarotte',    club: 'Yatay',          categoryId: catTercera.id },
    { firstName: 'Alvaro',      lastName: 'Aquino',       club: 'Centenario',     categoryId: catTercera.id },
    { firstName: 'Gustavo',     lastName: 'Fraquia',      club: 'Feria Franca',   categoryId: catTercera.id },
    { firstName: 'Esteban',     lastName: 'Zanelli',      club: 'Piedra Honda',   categoryId: catTercera.id },
    { firstName: 'Washington',  lastName: 'Carreras',     club: 'Sporting Union', categoryId: catTercera.id },
    { firstName: 'Alejandro',   lastName: 'Figueredo',    club: 'Centenario',     categoryId: catTercera.id },
    { firstName: 'Gregorio',    lastName: 'De la Fuente', club: 'Cabrera',        categoryId: catTercera.id },
    { firstName: 'Martin',      lastName: 'Gonzalez',     club: 'Cabrera',        categoryId: catTercera.id },
    { firstName: 'Bruno',       lastName: 'Zavattiero',   club: 'Capolavoro',     categoryId: catTercera.id },
    { firstName: 'Fernando',    lastName: 'Veneroso',     club: 'Capolavoro',     categoryId: catTercera.id },
    { firstName: 'Gustavo',     lastName: 'Bicker',       club: 'Centenario',     categoryId: catTercera.id },
    { firstName: 'Julio',       lastName: 'Torre',        club: 'Sporting Union', categoryId: catTercera.id },
    { firstName: 'Victor',      lastName: 'Batalla',      club: 'Cabrera',        categoryId: catTercera.id },
    { firstName: 'Leonel',      lastName: 'Barboza',      club: 'Capolavoro',     categoryId: catTercera.id },
    { firstName: 'Julio',       lastName: 'Martinez',     club: 'Centenario',     categoryId: catTercera.id },
    { firstName: 'Uruguay',     lastName: 'Sosa',         club: 'Cabrera',        categoryId: catTercera.id },
    { firstName: 'Jorge',       lastName: 'Ferreira',     club: 'Centenario',     categoryId: catTercera.id },
    { firstName: 'Raul',        lastName: 'Ponce',        club: 'Capolavoro',     categoryId: catTercera.id },
    { firstName: 'Jose',        lastName: 'Luis Marquez', club: 'Cabrera',        categoryId: catTercera.id },
    { firstName: 'Jose',        lastName: 'Calcagno',     club: 'Capolavoro',     categoryId: catTercera.id },
    { firstName: 'Enrique',     lastName: 'Da Silva',     club: 'Capolavoro',     categoryId: catTercera.id },
    { firstName: 'Daniel',      lastName: 'Navia',        club: 'Model Center',   categoryId: catTercera.id },
    { firstName: 'Marcelo',     lastName: 'Leguizamon',   club: 'Model Center',   categoryId: catTercera.id },
    { firstName: 'Manuel',      lastName: 'Pereira',      club: 'Model Center',   categoryId: catTercera.id },
    { firstName: 'Carlos',      lastName: 'Davila',       club: 'Piedra Honda',   categoryId: catTercera.id },
    { firstName: 'Osvaldo',     lastName: 'Machado',      club: 'Capolavoro',     categoryId: catTercera.id },
    { firstName: 'Libert',      lastName: 'Larrosa',      club: 'Feria Franca',   categoryId: catTercera.id },
    { firstName: 'Gustavo',     lastName: 'Vidich',       club: 'Cabrera',        categoryId: catTercera.id },
    { firstName: 'Karen',       lastName: 'Teliz',        club: 'Capolavoro',     categoryId: catTercera.id },
    { firstName: 'Ramiro',      lastName: 'Correa',       club: 'Casa del Billar',categoryId: catTercera.id },
    { firstName: 'Alberto',     lastName: 'Del Campo',    club: 'Model Center',   categoryId: catTercera.id },
    { firstName: 'Irineo',      lastName: 'Piñeyro',      club: 'Feria Franca',   categoryId: catTercera.id },
    { firstName: 'Carlos',      lastName: 'Vales',        club: 'Centenario',     categoryId: catTercera.id },
  ];

  const jugadores: any[] = [];
  for (let i = 0; i < jugadoresData.length; i++) {
    const j = jugadoresData[i];
    const p = await prisma.player.upsert({
      where: { dni: `FEBIU${String(i + 1).padStart(3, '0')}` },
      update: { firstName: j.firstName, lastName: j.lastName, club: j.club, categoryId: j.categoryId },
      create: { ...j, dni: `FEBIU${String(i + 1).padStart(3, '0')}` },
    });
    jugadores.push(p);
  }
  console.log(`✅ ${jugadores.length} jugadores cargados`);

  // RuleSet
  await prisma.ruleSet.upsert({
    where: { id: 1 }, update: {},
    create: { name: 'Series (mejor de 3)', bestOf: 3, setsToWin: 2, pointsPerSet: 60, woSetsWinner: 3, woSetsLoser: 0, woPtsWinner: 180, woPtsLoser: 0 },
  });
  await prisma.ruleSet.upsert({
    where: { id: 2 }, update: {},
    create: { name: 'Cruces (mejor de 5)', bestOf: 5, setsToWin: 3, pointsPerSet: 60, woSetsWinner: 5, woSetsLoser: 0, woPtsWinner: 300, woPtsLoser: 0 },
  });
  console.log('✅ RuleSets creados');

  console.log('');
  console.log('🎱 Seed completado!');
  console.log('');
  console.log('👤 Usuarios:');
  console.log('   admin   / admin123');
  console.log('   juez1   / juez123');
  console.log('   publico / publico123');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
