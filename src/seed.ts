import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const RANKING_INICIAL = [
  { pos: 1,   firstName: 'Matias',      lastName: 'Fonsalia',     club: 'Capolavoro',      cat: 'master'   },
  { pos: 2,   firstName: 'Maximiliano', lastName: 'Poggi',        club: 'Feria Franca',    cat: 'master'   },
  { pos: 3,   firstName: 'Dario',       lastName: 'Maiorana',     club: 'Yatay',           cat: 'master'   },
  { pos: 4,   firstName: 'Andres',      lastName: 'Lajuni',       club: 'Cabrera',         cat: 'master'   },
  { pos: 5,   firstName: 'Nestor',      lastName: 'Gonzalez',     club: 'Model Center',    cat: 'master'   },
  { pos: 6,   firstName: 'Damian',      lastName: 'Serron',       club: 'Feria Franca',    cat: 'master'   },
  { pos: 7,   firstName: 'Roque',       lastName: 'Santangelo',   club: 'Nuevo Malvin',    cat: 'master'   },
  { pos: 8,   firstName: 'Maximiliano', lastName: 'Durand',       club: 'Yatay',           cat: 'master'   },
  { pos: 9,   firstName: 'Emilio',      lastName: 'Broggini',     club: 'Capolavoro',      cat: 'primera'  },
  { pos: 10,  firstName: 'Adrian',      lastName: 'Marrero',      club: 'Feria Franca',    cat: 'primera'  },
  { pos: 11,  firstName: 'Luis',        lastName: 'Rivera',       club: 'Sporting Union',  cat: 'primera'  },
  { pos: 12,  firstName: 'Alvaro',      lastName: 'Gomez',        club: 'Cabrera',         cat: 'primera'  },
  { pos: 13,  firstName: 'Darwin',      lastName: 'Pumar',        club: 'Cabrera',         cat: 'primera'  },
  { pos: 14,  firstName: 'Leonardo',    lastName: 'Paternosto',   club: 'Feria Franca',    cat: 'primera'  },
  { pos: 15,  firstName: 'Jorge',       lastName: 'Claro',        club: 'Cabrera',         cat: 'primera'  },
  { pos: 16,  firstName: 'Rodrigo',     lastName: 'Ferdinand',    club: 'Capolavoro',      cat: 'primera'  },
  { pos: 17,  firstName: 'Pablo',       lastName: 'Quesada',      club: 'Casa del Billar', cat: 'primera'  },
  { pos: 18,  firstName: 'Sergio',      lastName: 'Rossi',        club: 'Feria Franca',    cat: 'primera'  },
  { pos: 19,  firstName: 'Miguel',      lastName: 'Garcia',       club: 'Yatay',           cat: 'primera'  },
  { pos: 20,  firstName: 'Daniel',      lastName: 'Pratto',       club: 'Capolavoro',      cat: 'primera'  },
  { pos: 21,  firstName: 'Eduardo',     lastName: 'Sasias',       club: 'Capolavoro',      cat: 'primera'  },
  { pos: 22,  firstName: 'Nelson',      lastName: 'Blanco',       club: 'Capolavoro',      cat: 'primera'  },
  { pos: 23,  firstName: 'Miguel',      lastName: 'Morales',      club: 'Model Center',    cat: 'primera'  },
  { pos: 24,  firstName: 'Willy',       lastName: 'Macedo',       club: 'Capolavoro',      cat: 'primera'  },
  { pos: 25,  firstName: 'Marcelo',     lastName: 'Gabrielle',    club: 'Feria Franca',    cat: 'primera'  },
  { pos: 26,  firstName: 'Richard',     lastName: 'Osores',       club: 'Cabrera',         cat: 'primera'  },
  { pos: 27,  firstName: 'Gustavo',     lastName: 'Etchart',      club: 'Feria Franca',    cat: 'primera'  },
  { pos: 28,  firstName: 'Pedro',       lastName: 'Camelo',       club: 'Yatay',           cat: 'primera'  },
  { pos: 29,  firstName: 'Wilfredo',    lastName: 'Paz',          club: 'Capolavoro',      cat: 'primera'  },
  { pos: 30,  firstName: 'Gustavo',     lastName: 'Castillo',     club: 'Cabrera',         cat: 'primera'  },
  { pos: 31,  firstName: 'Diego',       lastName: 'Gimenez',      club: 'Centenario',      cat: 'primera'  },
  { pos: 32,  firstName: 'Walter',      lastName: 'Amado',        club: 'Feria Franca',    cat: 'primera'  },
  { pos: 33,  firstName: 'Mario',       lastName: 'Sansebastian', club: 'Yatay',           cat: 'primera'  },
  { pos: 34,  firstName: 'Carlos',      lastName: 'Garcia',       club: 'Centenario',      cat: 'primera'  },
  { pos: 35,  firstName: 'Fernando',    lastName: 'Michelena',    club: 'Feria Franca',    cat: 'primera'  },
  { pos: 36,  firstName: 'Agustin',     lastName: 'Sosa',         club: 'Capolavoro',      cat: 'primera'  },
  { pos: 37,  firstName: 'Antonio',     lastName: 'Labat',        club: 'Yatay',           cat: 'primera'  },
  { pos: 38,  firstName: 'Richard',     lastName: 'Rondan',       club: 'Cabrera',         cat: 'primera'  },
  { pos: 39,  firstName: 'Jose',        lastName: 'Coppola',      club: 'Yatay',           cat: 'primera'  },
  { pos: 40,  firstName: 'Daniel',      lastName: 'Lapunov',      club: 'Nuevo Malvin',    cat: 'primera'  },
  { pos: 41,  firstName: 'Dario',       lastName: 'Clavijo',      club: 'Cabrera',         cat: 'primera'  },
  { pos: 42,  firstName: 'Carlos',      lastName: 'Sosa',         club: 'Centenario',      cat: 'primera'  },
  { pos: 43,  firstName: 'Santiago',    lastName: 'Rondan',       club: 'Cabrera',         cat: 'primera'  },
  { pos: 44,  firstName: 'Jorge',       lastName: 'Camarotte',    club: 'Yatay',           cat: 'segunda'  },
  { pos: 45,  firstName: 'Dardo',       lastName: 'Blanco',       club: 'Capolavoro',      cat: 'segunda'  },
  { pos: 46,  firstName: 'William',     lastName: 'Gonzalez',     club: 'Cabrera',         cat: 'segunda'  },
  { pos: 47,  firstName: 'Alvaro',      lastName: 'Uran',         club: 'Feria Franca',    cat: 'segunda'  },
  { pos: 48,  firstName: 'Marcelo',     lastName: 'Alvez',        club: 'Yatay',           cat: 'segunda'  },
  { pos: 49,  firstName: 'Ari',         lastName: 'Camargo',      club: 'Capolavoro',      cat: 'segunda'  },
  { pos: 50,  firstName: 'Marcelo',     lastName: 'Rodriguez',    club: 'Capolavoro',      cat: 'segunda'  },
  { pos: 51,  firstName: 'Juan',        lastName: 'Muniz',        club: 'Model Center',    cat: 'segunda'  },
  { pos: 52,  firstName: 'Hector',      lastName: 'Camarotte',    club: 'Yatay',           cat: 'segunda'  },
  { pos: 53,  firstName: 'Alejandro',   lastName: 'Spinetti',     club: 'Model Center',    cat: 'segunda'  },
  { pos: 54,  firstName: 'Gerardo',     lastName: 'Sarraute',     club: 'Piedra Honda',    cat: 'segunda'  },
  { pos: 55,  firstName: 'Edgardo',     lastName: 'Betervide',    club: 'Model Center',    cat: 'segunda'  },
  { pos: 56,  firstName: 'Jesus',       lastName: 'Nebot',        club: 'Model Center',    cat: 'segunda'  },
  { pos: 57,  firstName: 'Norberto',    lastName: 'Rosas',        club: 'Nuevo Malvin',    cat: 'segunda'  },
  { pos: 58,  firstName: 'Carlos',      lastName: 'Santos',       club: 'Cabrera',         cat: 'segunda'  },
  { pos: 59,  firstName: 'Jesus',       lastName: 'Gonzalez',     club: 'Centenario',      cat: 'segunda'  },
  { pos: 60,  firstName: 'Sergio',      lastName: 'Migues',       club: 'Centenario',      cat: 'segunda'  },
  { pos: 61,  firstName: 'Facundo',     lastName: 'Rodriguez',    club: 'Capolavoro',      cat: 'segunda'  },
  { pos: 62,  firstName: 'Esteban',     lastName: 'Bishmishian',  club: 'Cabrera',         cat: 'segunda'  },
  { pos: 63,  firstName: 'Gabriel',     lastName: 'Panaras',      club: 'Model Center',    cat: 'segunda'  },
  { pos: 64,  firstName: 'Julio',       lastName: 'Mañe',         club: 'Capolavoro',      cat: 'segunda'  },
  { pos: 65,  firstName: 'Fabian',      lastName: 'Marsico',      club: 'Cabrera',         cat: 'segunda'  },
  { pos: 66,  firstName: 'Julio',       lastName: 'Sosa',         club: 'Centenario',      cat: 'segunda'  },
  { pos: 67,  firstName: 'Roberto',     lastName: 'Gandini',      club: 'Nuevo Malvin',    cat: 'segunda'  },
  { pos: 68,  firstName: 'Ramiro',      lastName: 'Galvan',       club: 'Centenario',      cat: 'segunda'  },
  { pos: 69,  firstName: 'Leonardo',    lastName: 'Suarez',       club: 'Model Center',    cat: 'segunda'  },
  { pos: 70,  firstName: 'Enrique',     lastName: 'Santana',      club: 'Model Center',    cat: 'segunda'  },
  { pos: 71,  firstName: 'Sergio',      lastName: 'Quesada',      club: 'Casa del Billar', cat: 'segunda'  },
  { pos: 72,  firstName: 'Miguel',      lastName: 'Freitas',      club: 'Centenario',      cat: 'segunda'  },
  { pos: 73,  firstName: 'Aldo',        lastName: 'Berneche',     club: 'Sporting Union',  cat: 'segunda'  },
  { pos: 74,  firstName: 'Ricardo',     lastName: 'Magnano',      club: 'Sporting Union',  cat: 'segunda'  },
  { pos: 75,  firstName: 'Julio',       lastName: 'Trias',        club: 'Feria Franca',    cat: 'segunda'  },
  { pos: 76,  firstName: 'Gustavo',     lastName: 'Mayo',         club: 'Cabrera',         cat: 'segunda'  },
  { pos: 77,  firstName: 'Walter',      lastName: 'Saldaña',      club: 'Yatay',           cat: 'segunda'  },
  { pos: 78,  firstName: 'Pablo',       lastName: 'Baraldo',      club: 'Model Center',    cat: 'segunda'  },
  { pos: 79,  firstName: 'Gerardo',     lastName: 'Correa',       club: 'Feria Franca',    cat: 'segunda'  },
  { pos: 80,  firstName: 'Diego',       lastName: 'Beux',         club: 'Feria Franca',    cat: 'segunda'  },
  { pos: 81,  firstName: 'Robert',      lastName: 'Gonzalez',     club: 'Cabrera',         cat: 'segunda'  },
  { pos: 82,  firstName: 'Juan',        lastName: 'Ovelar',       club: 'Nuevo Malvin',    cat: 'segunda'  },
  { pos: 83,  firstName: 'Edgardo',     lastName: 'Denis',        club: 'Yatay',           cat: 'segunda'  },
  { pos: 84,  firstName: 'Marcelo',     lastName: 'Gonzalez',     club: 'Yatay',           cat: 'tercera'  },
  { pos: 85,  firstName: 'Richard',     lastName: 'Garcia',       club: 'Yatay',           cat: 'tercera'  },
  { pos: 86,  firstName: 'Miguel',      lastName: 'Fonseca',      club: 'Capolavoro',      cat: 'tercera'  },
  { pos: 87,  firstName: 'Daniel',      lastName: 'Lapaz',        club: 'Cabrera',         cat: 'tercera'  },
  { pos: 88,  firstName: 'Antonio',     lastName: 'Rabellino',    club: 'Centenario',      cat: 'tercera'  },
  { pos: 89,  firstName: 'Victor',      lastName: 'Baliña',       club: 'Centenario',      cat: 'tercera'  },
  { pos: 90,  firstName: 'Sebastian',   lastName: 'Quesada',      club: 'Casa del Billar', cat: 'tercera'  },
  { pos: 91,  firstName: 'Juan',        lastName: 'Carlos',       club: 'Casa del Billar', cat: 'tercera'  },
  { pos: 92,  firstName: 'Victor',      lastName: 'Vidart',       club: 'Casa del Billar', cat: 'tercera'  },
  { pos: 93,  firstName: 'Bruno',       lastName: 'Gonzalez',     club: 'Cabrera',         cat: 'tercera'  },
  { pos: 94,  firstName: 'Edgardo',     lastName: 'Umpierr',      club: 'Capolavoro',      cat: 'tercera'  },
  { pos: 95,  firstName: 'Alvaro',      lastName: 'Maldonado',    club: 'Centenario',      cat: 'tercera'  },
  { pos: 96,  firstName: 'Axel',        lastName: 'Chiberriaga',  club: 'Capolavoro',      cat: 'tercera'  },
  { pos: 97,  firstName: 'Richard',     lastName: 'Croza',        club: 'Nuevo Malvin',    cat: 'tercera'  },
  { pos: 98,  firstName: 'Fernando',    lastName: 'Rodriguez',    club: 'Model Center',    cat: 'tercera'  },
  { pos: 99,  firstName: 'Marcelo',     lastName: 'Camarotte',    club: 'Yatay',           cat: 'tercera'  },
  { pos: 100, firstName: 'Alvaro',      lastName: 'Aquino',       club: 'Centenario',      cat: 'tercera'  },
  { pos: 101, firstName: 'Gustavo',     lastName: 'Fraquia',      club: 'Feria Franca',    cat: 'tercera'  },
  { pos: 102, firstName: 'Esteban',     lastName: 'Zanelli',      club: 'Piedra Honda',    cat: 'tercera'  },
  { pos: 103, firstName: 'Washington',  lastName: 'Carreras',     club: 'Sporting Union',  cat: 'tercera'  },
  { pos: 104, firstName: 'Alejandro',   lastName: 'Figueredo',    club: 'Centenario',      cat: 'tercera'  },
  { pos: 105, firstName: 'Gregorio',    lastName: 'De la Fuente', club: 'Cabrera',         cat: 'tercera'  },
  { pos: 106, firstName: 'Martin',      lastName: 'Gonzalez',     club: 'Cabrera',         cat: 'tercera'  },
  { pos: 107, firstName: 'Bruno',       lastName: 'Zavattiero',   club: 'Capolavoro',      cat: 'tercera'  },
  { pos: 108, firstName: 'Fernando',    lastName: 'Veneroso',     club: 'Capolavoro',      cat: 'tercera'  },
  { pos: 109, firstName: 'Gustavo',     lastName: 'Bicker',       club: 'Centenario',      cat: 'tercera'  },
  { pos: 110, firstName: 'Julio',       lastName: 'Torre',        club: 'Sporting Union',  cat: 'tercera'  },
  { pos: 111, firstName: 'Victor',      lastName: 'Batalla',      club: 'Cabrera',         cat: 'tercera'  },
  { pos: 112, firstName: 'Leonel',      lastName: 'Barboza',      club: 'Capolavoro',      cat: 'tercera'  },
  { pos: 113, firstName: 'Julio',       lastName: 'Martinez',     club: 'Centenario',      cat: 'tercera'  },
  { pos: 114, firstName: 'Uruguay',     lastName: 'Sosa',         club: 'Cabrera',         cat: 'tercera'  },
  { pos: 115, firstName: 'Jorge',       lastName: 'Ferreira',     club: 'Centenario',      cat: 'tercera'  },
  { pos: 116, firstName: 'Raul',        lastName: 'Ponce',        club: 'Capolavoro',      cat: 'tercera'  },
  { pos: 117, firstName: 'Jose',        lastName: 'Luis Marquez', club: 'Cabrera',         cat: 'tercera'  },
  { pos: 118, firstName: 'Jose',        lastName: 'Calcagno',     club: 'Capolavoro',      cat: 'tercera'  },
  { pos: 119, firstName: 'Enrique',     lastName: 'Da Silva',     club: 'Capolavoro',      cat: 'tercera'  },
  { pos: 120, firstName: 'Daniel',      lastName: 'Navia',        club: 'Model Center',    cat: 'tercera'  },
  { pos: 121, firstName: 'Marcelo',     lastName: 'Leguizamon',   club: 'Model Center',    cat: 'tercera'  },
  { pos: 122, firstName: 'Manuel',      lastName: 'Pereira',      club: 'Model Center',    cat: 'tercera'  },
  { pos: 123, firstName: 'Carlos',      lastName: 'Davila',       club: 'Piedra Honda',    cat: 'tercera'  },
  { pos: 124, firstName: 'Osvaldo',     lastName: 'Machado',      club: 'Capolavoro',      cat: 'tercera'  },
  { pos: 125, firstName: 'Libert',      lastName: 'Larrosa',      club: 'Feria Franca',    cat: 'tercera'  },
  { pos: 126, firstName: 'Gustavo',     lastName: 'Vidich',       club: 'Cabrera',         cat: 'tercera'  },
  { pos: 127, firstName: 'Karen',       lastName: 'Teliz',        club: 'Capolavoro',      cat: 'tercera'  },
  { pos: 128, firstName: 'Ramiro',      lastName: 'Correa',       club: 'Casa del Billar', cat: 'tercera'  },
  { pos: 129, firstName: 'Alberto',     lastName: 'Del Campo',    club: 'Model Center',    cat: 'tercera'  },
  { pos: 130, firstName: 'Irineo',      lastName: 'Piñeyro',      club: 'Feria Franca',    cat: 'tercera'  },
  { pos: 131, firstName: 'Carlos',      lastName: 'Vales',        club: 'Centenario',      cat: 'tercera'  },
];

async function cargarRankingInicial(circuitId: number) {
  for (let i = 0; i < RANKING_INICIAL.length; i++) {
    const r = RANKING_INICIAL[i];
    const player = await prisma.player.findFirst({
      where: { dni: `FEBIU${String(i + 1).padStart(3, '0')}` }
    });
    if (player) {
      await prisma.rankingEntry.upsert({
        where: { playerId_circuitId: { playerId: player.id, circuitId } },
        update: { position: r.pos },
        create: {
          playerId: player.id,
          circuitId,
          position: r.pos,
          points: 0,
          matchesPlayed: 0,
          matchesWon: 0,
          setsWon: 0,
          setsLost: 0,
          pointsFor: 0,
          pointsAgainst: 0,
        },
      });
    }
  }
}

async function main() {
  console.log('🌱 Iniciando seed...');

  // Categorías — siempre upsert
  const catMaster   = await prisma.category.upsert({ where: { name: 'master' },   update: {}, create: { name: 'master' } });
  const catPrimera  = await prisma.category.upsert({ where: { name: 'primera' },  update: {}, create: { name: 'primera' } });
  const catSegunda  = await prisma.category.upsert({ where: { name: 'segunda' },  update: {}, create: { name: 'segunda' } });
  const catTercera  = await prisma.category.upsert({ where: { name: 'tercera' },  update: {}, create: { name: 'tercera' } });

  const catMap: Record<string, number> = {
    master:  catMaster.id,
    primera: catPrimera.id,
    segunda: catSegunda.id,
    tercera: catTercera.id,
  };

  // Usuarios — siempre upsert
  await prisma.user.upsert({ where: { username: 'admin' },   update: {}, create: { username: 'admin',   password: await bcrypt.hash('admin123', 10),   role: 'admin' } });
  await prisma.user.upsert({ where: { username: 'juez1' },   update: {}, create: { username: 'juez1',   password: await bcrypt.hash('juez123', 10),    role: 'juez_sede' } });
  await prisma.user.upsert({ where: { username: 'publico' }, update: {}, create: { username: 'publico', password: await bcrypt.hash('publico123', 10), role: 'publico' } });

  // RuleSets — siempre upsert
  await prisma.ruleSet.upsert({
    where: { id: 1 }, update: {},
    create: { name: 'Series (mejor de 3)', bestOf: 3, setsToWin: 2, pointsPerSet: 60, woSetsWinner: 3, woSetsLoser: 0, woPtsWinner: 180, woPtsLoser: 0 },
  });
  await prisma.ruleSet.upsert({
    where: { id: 2 }, update: {},
    create: { name: 'Cruces (mejor de 5)', bestOf: 5, setsToWin: 3, pointsPerSet: 60, woSetsWinner: 5, woSetsLoser: 0, woPtsWinner: 300, woPtsLoser: 0 },
  });

  // Jugadores — solo si no hay ninguno
  const playerCount = await prisma.player.count();
  if (playerCount === 0) {
    console.log('👤 Cargando jugadores...');
    for (let i = 0; i < RANKING_INICIAL.length; i++) {
      const r = RANKING_INICIAL[i];
      await prisma.player.create({
        data: {
          firstName: r.firstName,
          lastName: r.lastName,
          club: r.club,
          categoryId: catMap[r.cat],
          dni: `FEBIU${String(i + 1).padStart(3, '0')}`,
        },
      });
    }
    console.log(`✅ ${RANKING_INICIAL.length} jugadores cargados`);
  } else {
    console.log(`⏭️  Jugadores omitidos — ya hay ${playerCount} en la base de datos`);
  }

  // Ranking inicial — solo si no hay ninguno
  const rankingCount = await prisma.rankingEntry.count();
  if (rankingCount === 0) {
    const primerCircuito = await prisma.circuit.findFirst({ orderBy: { id: 'asc' } });
    if (primerCircuito) {
      console.log(`🏆 Cargando ranking inicial en circuito ${primerCircuito.name}...`);
      await cargarRankingInicial(primerCircuito.id);
      console.log(`✅ Ranking inicial cargado — ${RANKING_INICIAL.length} entradas`);
    } else {
      console.log('⚠️  Sin circuitos — ranking no cargado. Creá el circuito desde el frontend.');
    }
  } else {
    console.log(`⏭️  Ranking omitido — ya hay ${rankingCount} entradas`);
  }

  console.log('');
  console.log('🎱 Seed completado!');
  console.log('   admin / admin123');
  console.log('   juez1 / juez123');
  
  console.log('   publico / publico123');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
