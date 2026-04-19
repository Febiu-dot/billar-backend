import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed...');

  // Categorías
  const catMaster = await prisma.category.upsert({ where: { name: 'master' }, update: {}, create: { name: 'master' } });
  const catPrimera = await prisma.category.upsert({ where: { name: 'primera' }, update: {}, create: { name: 'primera' } });
  const catSegunda = await prisma.category.upsert({ where: { name: 'segunda' }, update: {}, create: { name: 'segunda' } });
  const catTercera = await prisma.category.upsert({ where: { name: 'tercera' }, update: {}, create: { name: 'tercera' } });
  console.log('✅ Categorías creadas');

  // Sedes
  const sede1 = await prisma.venue.upsert({
    where: { id: 1 }, update: {},
    create: { name: 'Billar Club Montevideo', address: 'Av. 18 de Julio 1234', city: 'Montevideo' },
  });
  const sede2 = await prisma.venue.upsert({
    where: { id: 2 }, update: {},
    create: { name: 'Salón La Bolada', address: 'Bv. Artigas 567', city: 'Montevideo' },
  });
  console.log('✅ Sedes creadas');

  // Mesas sede 1
  for (let i = 1; i <= 5; i++) {
    await prisma.table.upsert({
      where: { venueId_number: { venueId: sede1.id, number: i } },
      update: {},
      create: { number: i, venueId: sede1.id, status: i <= 2 ? 'ocupada' : 'libre' },
    });
  }
  // Mesas sede 2
  for (let i = 1; i <= 4; i++) {
    await prisma.table.upsert({
      where: { venueId_number: { venueId: sede2.id, number: i } },
      update: {},
      create: { number: i, venueId: sede2.id, status: 'libre' },
    });
  }
  console.log('✅ Mesas creadas');

  // Usuarios
  const pass = await bcrypt.hash('admin123', 10);
  const passJuez = await bcrypt.hash('juez123', 10);

  await prisma.user.upsert({ where: { username: 'admin' }, update: {}, create: { username: 'admin', password: pass, role: 'admin' } });
  await prisma.user.upsert({ where: { username: 'juez1' }, update: {}, create: { username: 'juez1', password: passJuez, role: 'juez_sede', venueId: sede1.id } });
  await prisma.user.upsert({ where: { username: 'juez2' }, update: {}, create: { username: 'juez2', password: passJuez, role: 'juez_sede', venueId: sede2.id } });
  await prisma.user.upsert({ where: { username: 'publico' }, update: {}, create: { username: 'publico', password: await bcrypt.hash('publico123', 10), role: 'publico' } });
  console.log('✅ Usuarios creados');

  // Jugadores
  const jugadoresData = [
    { firstName: 'Carlos', lastName: 'Rodríguez', categoryId: catMaster.id },
    { firstName: 'Martín', lastName: 'González', categoryId: catMaster.id },
    { firstName: 'Diego', lastName: 'Fernández', categoryId: catMaster.id },
    { firstName: 'Andrés', lastName: 'López', categoryId: catMaster.id },
    { firstName: 'Pablo', lastName: 'Martínez', categoryId: catPrimera.id },
    { firstName: 'Sebastián', lastName: 'García', categoryId: catPrimera.id },
    { firstName: 'Federico', lastName: 'Pérez', categoryId: catPrimera.id },
    { firstName: 'Nicolás', lastName: 'Sánchez', categoryId: catPrimera.id },
    { firstName: 'Mateo', lastName: 'Ramírez', categoryId: catSegunda.id },
    { firstName: 'Lucas', lastName: 'Torres', categoryId: catSegunda.id },
    { firstName: 'Ignacio', lastName: 'Flores', categoryId: catSegunda.id },
    { firstName: 'Rodrigo', lastName: 'Díaz', categoryId: catSegunda.id },
    { firstName: 'Juan', lastName: 'Herrera', categoryId: catTercera.id },
    { firstName: 'Tomás', lastName: 'Morales', categoryId: catTercera.id },
    { firstName: 'Emilio', lastName: 'Vargas', categoryId: catTercera.id },
    { firstName: 'Agustín', lastName: 'Castro', categoryId: catTercera.id },
  ];

  const jugadores = [];
  for (const j of jugadoresData) {
    const p = await prisma.player.upsert({
      where: { dni: `DNI${j.firstName}${j.lastName}`.replace(/\s/g, '') },
      update: {},
      create: { ...j, dni: `DNI${j.firstName}${j.lastName}`.replace(/\s/g, '') },
    });
    jugadores.push(p);
  }
  console.log('✅ Jugadores creados');

  // RuleSet
  const ruleSet = await prisma.ruleSet.upsert({
    where: { id: 1 }, update: {},
    create: { name: 'Estándar (al mejor de 5)', bestOf: 5, setsToWin: 3, pointsPerSet: 50, woSetsWinner: 3, woSetsLoser: 0, woPtsWinner: 150, woPtsLoser: 0 },
  });

  // Torneo
  const torneo = await prisma.tournament.upsert({
    where: { id: 1 }, update: {},
    create: { name: 'Campeonato Nacional de Billar 2025', year: 2025, description: 'Torneo anual por circuitos', active: true },
  });

  // Circuito
  const circuito = await prisma.circuit.upsert({
    where: { id: 1 }, update: {},
    create: { name: 'Circuito 1 - Apertura', tournamentId: torneo.id, order: 1, startDate: new Date('2025-03-01'), endDate: new Date('2025-03-31'), active: true },
  });

  // Fases
  const faseClasif = await prisma.phase.upsert({
    where: { id: 1 }, update: {},
    create: { name: 'Clasificatorio', type: 'clasificatorio', circuitId: circuito.id, order: 1 },
  });
  const fasePrimera = await prisma.phase.upsert({
    where: { id: 2 }, update: {},
    create: { name: 'Primera Fase', type: 'primera', circuitId: circuito.id, order: 2 },
  });
  console.log('✅ Torneo, circuito y fases creados');

  // Obtener mesas
  const tables = await prisma.table.findMany({ orderBy: [{ venueId: 'asc' }, { number: 'asc' }] });
  const mesa1 = tables[0];
  const mesa2 = tables[1];
  const mesa5 = tables[4];

  // Partidos - mezcla de estados
  const matchesData = [
    // Finalizados
    { playerAId: jugadores[0].id, playerBId: jugadores[1].id, phaseId: faseClasif.id, status: 'finalizado' as const, tableId: mesa5.id, round: 1 },
    { playerAId: jugadores[2].id, playerBId: jugadores[3].id, phaseId: faseClasif.id, status: 'finalizado' as const, tableId: mesa5.id, round: 1 },
    { playerAId: jugadores[4].id, playerBId: jugadores[5].id, phaseId: faseClasif.id, status: 'finalizado' as const, tableId: mesa5.id, round: 1 },
    // En juego
    { playerAId: jugadores[6].id, playerBId: jugadores[7].id, phaseId: faseClasif.id, status: 'en_juego' as const, tableId: mesa1.id, round: 1 },
    { playerAId: jugadores[8].id, playerBId: jugadores[9].id, phaseId: faseClasif.id, status: 'en_juego' as const, tableId: mesa2.id, round: 1 },
    // Asignados
    { playerAId: jugadores[10].id, playerBId: jugadores[11].id, phaseId: faseClasif.id, status: 'asignado' as const, tableId: mesa5.id, round: 1 },
    // Pendientes
    { playerAId: jugadores[12].id, playerBId: jugadores[13].id, phaseId: faseClasif.id, status: 'pendiente' as const, tableId: null, round: 1 },
    { playerAId: jugadores[14].id, playerBId: jugadores[15].id, phaseId: faseClasif.id, status: 'pendiente' as const, tableId: null, round: 1 },
    { playerAId: jugadores[0].id, playerBId: jugadores[4].id, phaseId: fasePrimera.id, status: 'pendiente' as const, tableId: null, round: 1 },
    { playerAId: jugadores[1].id, playerBId: jugadores[5].id, phaseId: fasePrimera.id, status: 'pendiente' as const, tableId: null, round: 1 },
  ];

  const createdMatches = [];
  for (const m of matchesData) {
    const created = await prisma.match.create({
      data: {
        ...m,
        ruleSetId: ruleSet.id,
        startedAt: m.status === 'en_juego' || m.status === 'finalizado' ? new Date() : null,
        finishedAt: m.status === 'finalizado' ? new Date() : null,
      },
    });
    createdMatches.push(created);
  }

  // Resultados para partidos finalizados
  await prisma.matchResult.create({ data: { matchId: createdMatches[0].id, setsA: 3, setsB: 1, pointsA: 150, pointsB: 80, winnerId: jugadores[0].id } });
  await prisma.matchResult.create({ data: { matchId: createdMatches[1].id, setsA: 2, setsB: 3, pointsA: 100, pointsB: 150, winnerId: jugadores[3].id } });
  await prisma.matchResult.create({ data: { matchId: createdMatches[2].id, setsA: 3, setsB: 0, pointsA: 150, pointsB: 60, winnerId: jugadores[4].id, isWO: true, woPlayerId: jugadores[5].id } });

  // Resultados parciales para partidos en juego
  await prisma.matchResult.create({ data: { matchId: createdMatches[3].id, setsA: 1, setsB: 2, pointsA: 45, pointsB: 90 } });
  await prisma.matchResult.create({ data: { matchId: createdMatches[4].id, setsA: 2, setsB: 1, pointsA: 100, pointsB: 50 } });

  // Rankings de ejemplo
  const rankingData = [
    { playerId: jugadores[0].id, circuitId: circuito.id, points: 30, matchesPlayed: 2, matchesWon: 2, setsWon: 6, setsLost: 2, pointsFor: 290, pointsAgainst: 170 },
    { playerId: jugadores[3].id, circuitId: circuito.id, points: 30, matchesPlayed: 2, matchesWon: 1, setsWon: 4, setsLost: 4, pointsFor: 240, pointsAgainst: 200 },
    { playerId: jugadores[4].id, circuitId: circuito.id, points: 30, matchesPlayed: 1, matchesWon: 1, setsWon: 3, setsLost: 0, pointsFor: 150, pointsAgainst: 60 },
  ];

  for (const r of rankingData) {
    await prisma.rankingEntry.upsert({
      where: { playerId_circuitId: { playerId: r.playerId, circuitId: r.circuitId } },
      update: r,
      create: r,
    });
  }

  console.log('✅ Partidos y resultados creados');
  console.log('✅ Rankings creados');
  console.log('');
  console.log('🎱 Seed completado exitosamente!');
  console.log('');
  console.log('👤 Usuarios de prueba:');
  console.log('   admin   / admin123  → Panel administrador');
  console.log('   juez1   / juez123   → Juez Sede 1 (Billar Club Montevideo)');
  console.log('   juez2   / juez123   → Juez Sede 2 (Salón La Bolada)');
  console.log('   publico / publico123 → Vista pública');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
