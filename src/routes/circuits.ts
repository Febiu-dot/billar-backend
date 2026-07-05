import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

const LIBRE_DNI = 'FEBIU000';
const RULESET_SERIES = 1;
const RULESET_CRUCES = 2;

const DEFAULT_CONFIG = {
  cantMaster:       8,
  cantPrimera:      24,
  cantSegunda:      32,
  cuposDesdeClasif: 16,
};

interface ConfigTorneo {
  cantMaster:       number;
  cantPrimera:      number;
  cantSegunda:      number;
  cuposDesdeClasif: number;
  tipo?:            'departamental' | 'nacional' | 'panamericano';
  categoriaFederal?: 'primera' | 'segunda' | 'tercera';
  ruleSetSeries?:   number;
  ruleSetCruces?:   number;
  formato?:         '32' | '16';
}

function getConfigTorneo(circuit: any): ConfigTorneo {
  const c = (circuit.configTorneo as any) ?? {};
  return {
    cantMaster:       c.cantMaster       ?? DEFAULT_CONFIG.cantMaster,
    cantPrimera:      c.cantPrimera      ?? DEFAULT_CONFIG.cantPrimera,
    cantSegunda:      c.cantSegunda      ?? DEFAULT_CONFIG.cantSegunda,
    cuposDesdeClasif: c.cuposDesdeClasif ?? DEFAULT_CONFIG.cuposDesdeClasif,
    tipo:             c.tipo             ?? 'departamental',
    categoriaFederal: c.categoriaFederal ?? undefined,
    ruleSetSeries:    c.ruleSetSeries    ?? RULESET_SERIES,
    ruleSetCruces:    c.ruleSetCruces    ?? RULESET_CRUCES,
    formato:          c.formato          ?? '32',
  };
}

// Nacional y Panamericano comparten 100% la lógica deportiva
// (series + bracket, mismas reglas y puntos). Solo difieren en el rótulo
// y en que el Panamericano es regional (los jugadores tienen país).
function esNacional(config: ConfigTorneo): boolean {
  return config.tipo === 'nacional' || config.tipo === 'panamericano';
}

// ── RuleSet por categoría y fase Nacional ─────────────────────────────
function getRuleSetNacional(categoriaFederal: string | undefined, fase: 'series' | 'cruces'): number {
  if (!categoriaFederal) return RULESET_SERIES;
  if (categoriaFederal === 'primera') return RULESET_CRUCES;
  if (categoriaFederal === 'segunda') return fase === 'series' ? RULESET_SERIES : RULESET_CRUCES;
  return RULESET_SERIES; // tercera: 3 sets para todo
}

async function getJugadoresOrdenados(circuit: any, circuitId: number, cfg?: ConfigTorneo) {
  const config = cfg ?? getConfigTorneo(circuit);
  const CORTE_MASTER  = config.cantMaster;
  const CORTE_PRIMERA = config.cantMaster + config.cantPrimera;
  const CORTE_SEGUNDA = config.cantMaster + config.cantPrimera + config.cantSegunda;

  let rankings = await prisma.rankingEntry.findMany({
    where: { circuitId },
    orderBy: { position: 'asc' }
  });

  if (rankings.length === 0) {
    const prevCircuit = await prisma.circuit.findFirst({
      where: { tournamentId: circuit.tournamentId, order: circuit.order - 1 }
    });
    if (prevCircuit) {
      rankings = await prisma.rankingEntry.findMany({
        where: { circuitId: prevCircuit.id },
        orderBy: { position: 'asc' }
      });
    }
  }

  const inscriptos = circuit.players
    .map((cp: any) => cp.player)
    .filter((p: any) => p.dni !== LIBRE_DNI);

  // ── Nacional: todos van a clasificatorio, ordenados por ranking ──────
  if (esNacional(config)) {
    if (rankings.length === 0) {
      return { master: [], primera: [], segunda: [], clasif: inscriptos, getRankPos: () => 9999, rankings: [] };
    }
    const getRankPos = (playerId: number): number => {
      const entry = rankings.find((r: any) => r.playerId === playerId);
      return entry?.position ?? 9999;
    };
    const ordenados = [...inscriptos].sort((a: any, b: any) => getRankPos(a.id) - getRankPos(b.id));
    return { master: [], primera: [], segunda: [], clasif: ordenados, getRankPos, rankings };
  }

  // ── Fallback a categoría cuando no hay rankings ───────────────────
  if (rankings.length === 0) {
    const master  = inscriptos.filter((p: any) => p.category?.name === 'master');
    const primera = inscriptos.filter((p: any) => p.category?.name === 'primera');
    const segunda = inscriptos.filter((p: any) => p.category?.name === 'segunda');
    const clasif  = inscriptos.filter((p: any) => p.category?.name === 'tercera');
    return { master, primera, segunda, clasif, getRankPos: () => 9999, rankings: [] };
  }

  const getRankPos = (playerId: number): number => {
    const entry = rankings.find((r: any) => r.playerId === playerId);
    return entry?.position ?? 9999;
  };

  const ordenados = [...inscriptos].sort((a: any, b: any) => getRankPos(a.id) - getRankPos(b.id));

  const master  = ordenados.filter((p: any) => getRankPos(p.id) <= CORTE_MASTER);
  const primera = ordenados.filter((p: any) => getRankPos(p.id) > CORTE_MASTER  && getRankPos(p.id) <= CORTE_PRIMERA);
  const segunda = ordenados.filter((p: any) => getRankPos(p.id) > CORTE_PRIMERA && getRankPos(p.id) <= CORTE_SEGUNDA);
  const clasif  = ordenados.filter((p: any) => getRankPos(p.id) > CORTE_SEGUNDA);

  return { master, primera, segunda, clasif, getRankPos, rankings };
}

function completarConLibre(jugadores: any[], librePlayer: any): any[] {
  const resto = jugadores.length % 4;
  if (resto === 0) return jugadores;
  const result = [...jugadores];
  for (let i = 0; i < 4 - resto; i++) result.push(librePlayer);
  return result;
}

function armarSeriesEspejo(jugadores: any[]): any[][] {
  const N = jugadores.length;
  const numSeries = N / 4;
  const mitad = N / 2;
  const series: any[][] = [];
  for (let i = 0; i < numSeries; i++) {
    series.push([
      jugadores[i],
      jugadores[N - 1 - i],
      jugadores[mitad - 1 - i],
      jugadores[mitad + i],
    ]);
  }
  return series;
}

function mkMatch(
  phaseId: number,
  playerAId: number | null,
  playerBId: number | null,
  round: number,
  slotA?: string,
  slotB?: string,
  serieId?: string,
  ruleSetId?: number
) {
  return {
    phaseId, playerAId, playerBId,
    slotA: slotA ?? null, slotB: slotB ?? null,
    round, status: 'pendiente',
    serieId: serieId ?? null,
    ruleSetId: ruleSetId ?? null
  };
}

// ── Cuadro final Departamental ────────────────────────────────────────
function generarCuadroFinal(phaseId: number, jugadores: any[], ruleSetId: number): any[] {
  const matches: any[] = [];
  const N = jugadores.length;

  for (let i = 0; i < N / 2; i++) {
    const jA = jugadores[i];
    const jB = jugadores[N - 1 - i];
    matches.push(mkMatch(phaseId, jA.id ?? null, jB.id ?? null, i + 1, jA.slot ?? undefined, jB.slot ?? undefined, `master-cruce-${i + 1}`, ruleSetId));
  }

  const octavosBase = N / 2;
  for (let i = 0; i < N / 4; i++) {
    matches.push(mkMatch(phaseId, null, null, octavosBase + i + 1, `Gan. Cruce Master ${i + 1}`, `Gan. Cruce Master ${N / 2 - i}`, `master-octavos-${i + 1}`, ruleSetId));
  }

  const cuartosBase = octavosBase + N / 4;
  for (let i = 0; i < N / 8; i++) {
    matches.push(mkMatch(phaseId, null, null, cuartosBase + i + 1, `Gan. Octavos ${octavosBase + i + 1}`, `Gan. Octavos ${cuartosBase - i}`, `master-cuartos-${i + 1}`, ruleSetId));
  }

  const semifinalBase = cuartosBase + N / 8;
  matches.push(mkMatch(phaseId, null, null, semifinalBase + 1, `Gan. Cuartos ${cuartosBase + 1}`, `Gan. Cuartos ${cuartosBase + 4}`, 'master-semifinal-1', ruleSetId));
  matches.push(mkMatch(phaseId, null, null, semifinalBase + 2, `Gan. Cuartos ${cuartosBase + 2}`, `Gan. Cuartos ${cuartosBase + 3}`, 'master-semifinal-2', ruleSetId));
  matches.push(mkMatch(phaseId, null, null, semifinalBase + 3, `Gan. Semifinal ${semifinalBase + 1}`, `Gan. Semifinal ${semifinalBase + 2}`, 'master-final', ruleSetId));

  return matches;
}

// ── Series Nacional: 5 partidos por serie ────────────────────────────
function generarSeriesNacional(
  phaseId: number,
  series: any[][],
  ruleSetSeries: number
): any[] {
  const matches: any[] = [];

  for (let i = 0; i < series.length; i++) {
    const [A, B, C, D] = series[i];
    const n = i + 1;
    const rb = i * 10 + 1;
    const sid = `nac-serie-${n}`;

    matches.push(mkMatch(phaseId, A.id, B.id, rb,     undefined,          undefined,          sid, ruleSetSeries));
    matches.push(mkMatch(phaseId, C.id, D.id, rb + 1, undefined,          undefined,          sid, ruleSetSeries));
    matches.push(mkMatch(phaseId, null, null,  rb + 2, `Gan. S${n}-P1`,   `Gan. S${n}-P2`,   sid, ruleSetSeries));
    matches.push(mkMatch(phaseId, null, null,  rb + 3, `Per. S${n}-P1`,   `Per. S${n}-P2`,   sid, ruleSetSeries));
    matches.push(mkMatch(phaseId, null, null,  rb + 4, `Per. S${n}-P3`,   `Gan. S${n}-P4`,   sid, ruleSetSeries));
  }

  return matches;
}

// ── Bracket Nacional 32: eliminación simple 16 jugadores — 15 partidos ──
function generarBracketEliminacionSimple(phaseId: number, ruleSetCruces: number): any[] {
  const matches: any[] = [];

  for (let i = 0; i < 8; i++) {
    matches.push(mkMatch(
      phaseId, null, null, 101 + i,
      `Nac. Clasificado #${i + 1}`,
      `Nac. Clasificado #${16 - i}`,
      `nac-oct-${i + 1}`, ruleSetCruces
    ));
  }

  for (let i = 0; i < 4; i++) {
    matches.push(mkMatch(
      phaseId, null, null, 111 + i,
      `Gan. NAC-OCT-${i * 2 + 1}`,
      `Gan. NAC-OCT-${i * 2 + 2}`,
      `nac-cua-${i + 1}`, ruleSetCruces
    ));
  }

  matches.push(mkMatch(phaseId, null, null, 121, 'Gan. NAC-CUA-1', 'Gan. NAC-CUA-2', 'nac-semi-1', ruleSetCruces));
  matches.push(mkMatch(phaseId, null, null, 122, 'Gan. NAC-CUA-3', 'Gan. NAC-CUA-4', 'nac-semi-2', ruleSetCruces));
  matches.push(mkMatch(phaseId, null, null, 131, 'Gan. NAC-SEMI-1', 'Gan. NAC-SEMI-2', 'nac-final', ruleSetCruces));

  return matches; // 15 partidos
}

// ── Bracket FORMATO 16: eliminación simple 8 jugadores — 7 partidos ──
// Arranca en CUARTOS (sin octavos). Usa los mismos serieIds nac-cua/semi/final
// para heredar publicaciones, propagación de bracket y puntuación.
function generarBracketR16(phaseId: number, ruleSetCruces: number): any[] {
  const matches: any[] = [];

  for (let i = 0; i < 4; i++) {
    matches.push(mkMatch(
      phaseId, null, null, 111 + i,
      `Nac. Clasificado #${i + 1}`,
      `Nac. Clasificado #${8 - i}`,
      `nac-cua-${i + 1}`, ruleSetCruces
    ));
  }

  matches.push(mkMatch(phaseId, null, null, 121, 'Gan. NAC-CUA-1', 'Gan. NAC-CUA-2', 'nac-semi-1', ruleSetCruces));
  matches.push(mkMatch(phaseId, null, null, 122, 'Gan. NAC-CUA-3', 'Gan. NAC-CUA-4', 'nac-semi-2', ruleSetCruces));
  matches.push(mkMatch(phaseId, null, null, 131, 'Gan. NAC-SEMI-1', 'Gan. NAC-SEMI-2', 'nac-final', ruleSetCruces));

  return matches; // 7 partidos
}

// ── GET /api/circuits ─────────────────────────────────────────────────
router.get('/', async (_req: Request, res: Response) => {
  try {
    const circuits = await prisma.circuit.findMany({
      include: {
        tournament: true,
        phases: { orderBy: { order: 'asc' } },
        players: { include: { player: { include: { category: true } } } }
      },
      orderBy: { order: 'asc' }
    });
    res.json(circuits);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── GET /api/circuits/:id ─────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const circuit = await prisma.circuit.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        tournament: true,
        phases: { orderBy: { order: 'asc' } },
        players: { include: { player: { include: { category: true } } } }
      }
    });
    if (!circuit) { res.status(404).json({ error: 'Circuito no encontrado' }); return; }
    res.json(circuit);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── GET /api/circuits/:id/config-torneo ──────────────────────────────
router.get('/:id/config-torneo', async (req: Request, res: Response) => {
  try {
    const circuit = await prisma.circuit.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!circuit) { res.status(404).json({ error: 'Circuito no encontrado' }); return; }
    res.json(getConfigTorneo(circuit));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── PUT /api/circuits/:id/config-torneo ──────────────────────────────
router.put('/:id/config-torneo', async (req: Request, res: Response) => {
  try {
    const circuitId = parseInt(req.params.id);
    const { cantMaster, cantPrimera, cantSegunda, cuposDesdeClasif, tipo, categoriaFederal, formato } = req.body;

    if (tipo === 'nacional' || tipo === 'panamericano') {
      const ruleSetSeries = getRuleSetNacional(categoriaFederal, 'series');
      const ruleSetCruces = getRuleSetNacional(categoriaFederal, 'cruces');
      const fmt = formato === '16' ? '16' : '32';
      const configData = {
        tipo, categoriaFederal,
        ruleSetSeries, ruleSetCruces,
        formato: fmt,
        cantMaster: 0, cantPrimera: 0, cantSegunda: 0, cuposDesdeClasif: 0
      };
      const circuit = await prisma.circuit.update({
        where: { id: circuitId },
        data: { configTorneo: configData as any }
      });
      res.json({ ok: true, configTorneo: getConfigTorneo(circuit) });
      return;
    }

    if (cantMaster == null || cantPrimera == null || cantSegunda == null || cuposDesdeClasif == null) {
      res.status(400).json({ error: 'Faltan parámetros' });
      return;
    }

    if ((cantSegunda + cuposDesdeClasif) % 4 !== 0) {
      res.status(400).json({ error: `cantSegunda (${cantSegunda}) + cuposDesdeClasif (${cuposDesdeClasif}) = ${cantSegunda + cuposDesdeClasif}, que no es múltiplo de 4.` });
      return;
    }

    const configData = { tipo: 'departamental', cantMaster, cantPrimera, cantSegunda, cuposDesdeClasif };
    const circuit = await prisma.circuit.update({
      where: { id: circuitId },
      data: { configTorneo: configData as any }
    });
    res.json({ ok: true, configTorneo: getConfigTorneo(circuit) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});


// ── PATCH /api/circuits/:id/sala-fecha ───────────────────────────────
// Guarda salaPublica y fechaPublica en configTorneo sin pisar otros campos
router.patch('/:id/sala-fecha', async (req: Request, res: Response) => {
  try {
    const circuitId = parseInt(req.params.id);
    const { salaPublica, fechaPublica } = req.body;
    const circuit = await prisma.circuit.findUnique({ where: { id: circuitId } });
    if (!circuit) { res.status(404).json({ error: 'Circuito no encontrado' }); return; }
    const existing = (circuit.configTorneo as any) ?? {};
    const updated = { ...existing, salaPublica: salaPublica ?? '', fechaPublica: fechaPublica ?? '' };
    await prisma.circuit.update({ where: { id: circuitId }, data: { configTorneo: updated as any } });
    res.json({ ok: true, salaPublica: updated.salaPublica, fechaPublica: updated.fechaPublica });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── POST /api/circuits/:id/players ───────────────────────────────────
router.post('/:id/players', async (req: Request, res: Response) => {
  const circuitId = parseInt(req.params.id);
  const { playerId } = req.body;
  if (!playerId) { res.status(400).json({ error: 'playerId es requerido' }); return; }
  try {
    const circuit = await prisma.circuit.findUnique({ where: { id: circuitId } });
    if (!circuit) { res.status(404).json({ error: 'Circuito no encontrado' }); return; }
    const player = await prisma.player.findUnique({ where: { id: parseInt(playerId) } });
    if (!player) { res.status(404).json({ error: 'Jugador no encontrado' }); return; }
    const circuitPlayer = await prisma.circuitPlayer.create({
      data: { circuitId, playerId: parseInt(playerId) },
      include: { player: { include: { category: true } } }
    });
    res.status(201).json(circuitPlayer);
  } catch (error: any) {
    if (error.code === 'P2002') { res.status(409).json({ error: 'El jugador ya está inscripto en este circuito' }); return; }
    res.status(500).json({ error: error.message });
  }
});

// ── DELETE /api/circuits/:id/players/:playerId ────────────────────────
router.delete('/:id/players/:playerId', async (req: Request, res: Response) => {
  const circuitId = parseInt(req.params.id);
  const playerId = parseInt(req.params.playerId);
  try {
    const record = await prisma.circuitPlayer.findUnique({
      where: { circuitId_playerId: { circuitId, playerId } }
    });
    if (!record) { res.status(404).json({ error: 'El jugador no está inscripto en este circuito' }); return; }
    await prisma.circuitPlayer.delete({ where: { circuitId_playerId: { circuitId, playerId } } });
    res.json({ message: 'Jugador desinscripto correctamente' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── POST /api/circuits/:id/seed-ranking ──────────────────────────────
router.post('/:id/seed-ranking', async (req: Request, res: Response) => {
  const circuitId = parseInt(req.params.id);
  try {
    const circuit = await prisma.circuit.findUnique({ where: { id: circuitId } });
    if (!circuit) { res.status(404).json({ error: 'Circuito no encontrado' }); return; }

    const players = await prisma.player.findMany({ orderBy: { id: 'asc' } });
    let cargados = 0;

    for (const p of players) {
      if (!p.dni || p.dni === LIBRE_DNI) continue;
      const pos = parseInt(p.dni.replace(/^[A-Z]+/, ''));
      if (isNaN(pos) || pos === 0) continue;

      await prisma.rankingEntry.upsert({
        where: { playerId_circuitId: { playerId: p.id, circuitId } },
        update: { position: pos },
        create: {
          playerId: p.id, circuitId, position: pos,
          points: 0, matchesPlayed: 0, matchesWon: 0,
          setsWon: 0, setsLost: 0, pointsFor: 0, pointsAgainst: 0
        },
      });
      cargados++;
    }

    res.json({ message: 'Ranking inicial cargado', total: cargados });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── GET /api/circuits/:id/preview ────────────────────────────────────
router.get('/:id/preview', async (req: Request, res: Response) => {
  const circuitId = parseInt(req.params.id);
  try {
    const circuit = await prisma.circuit.findUnique({
      where: { id: circuitId },
      include: {
        phases: { orderBy: { order: 'asc' } },
        players: { include: { player: { include: { category: true } } } }
      }
    });
    if (!circuit) { res.status(404).json({ error: 'Circuito no encontrado' }); return; }
    if (circuit.players.length === 0) { res.status(400).json({ error: 'Sin jugadores inscriptos' }); return; }

    const config = getConfigTorneo(circuit);
    const librePlayer = await prisma.player.findFirst({ where: { dni: LIBRE_DNI } });
    const libreObj = librePlayer ?? { id: 0, dni: LIBRE_DNI, firstName: 'LIBRE', lastName: '' };
    const { master, primera, segunda, clasif } = await getJugadoresOrdenados(circuit, circuitId, config);
    const pn = (p: any) => p.dni === LIBRE_DNI ? 'LIBRE' : `${p.lastName}${p.lastName ? ', ' : ''}${p.firstName}`;

    // ── Preview Nacional ──────────────────────────────────────────────
    if (esNacional(config)) {
      const es16 = config.formato === '16';
      const jugConLibre = completarConLibre(clasif, libreObj);
      const numSeries = jugConLibre.length / 4;
      const seriesClasif = armarSeriesEspejo(jugConLibre).map((serie, i) => ({
        serie: i + 1,
        jugadores: serie.map((p: any) => ({ id: p.id, nombre: pn(p), esLibre: p.dni === LIBRE_DNI }))
      }));

      const totalPartidosSeries  = numSeries * 5;
      const totalPartidosBracket = es16 ? 7 : 15;

      return res.json({
        config,
        tipo: config.tipo,
        formato: es16 ? '16' : '32',
        categoriaFederal: config.categoriaFederal,
        inscriptos: { total: clasif.length, clasificatorio: clasif.length },
        clasificatorio: {
          totalJugadores:    jugConLibre.length,
          totalSeries:       numSeries,
          totalClasificados: numSeries * 2,
          partidosPorSerie:  5,
          totalPartidos:     totalPartidosSeries,
          series:            seriesClasif,
        },
        bracket: es16 ? {
          descripcion:   'Eliminación simple 8 jugadores — arranca en cuartos (1 y 2 solo se cruzan en final)',
          totalPartidos: totalPartidosBracket,
          cuartos: ['#1 vs #8', '#4 vs #5', '#3 vs #6', '#2 vs #7'],
        } : {
          descripcion:    'Eliminación simple 16 jugadores — seeding protegido (1 y 2 solo se cruzan en final)',
          totalPartidos:  totalPartidosBracket,
          octavos: [
            '#1 vs #16', '#8 vs #9', '#5 vs #12', '#4 vs #13',
            '#3 vs #14', '#6 vs #11', '#7 vs #10', '#2 vs #15',
          ],
        },
        totalPartidos: totalPartidosSeries + totalPartidosBracket,
      });
    }

    // ── Preview Departamental ─────────────────────────────────────────
    const { cuposDesdeClasif } = config;

    const jugConLibre = completarConLibre(clasif, libreObj);
    const numSeries = jugConLibre.length / 4;
    const numClasificados = numSeries * 2;

    const seriesClasif = armarSeriesEspejo(jugConLibre).map((serie, i) => ({
      serie: i + 1,
      jugadores: serie.map((p: any) => ({ id: p.id, nombre: pn(p), esLibre: p.dni === LIBRE_DNI }))
    }));

    const crucesReduccion: any[] = [];
    if (numClasificados > cuposDesdeClasif) {
      for (let i = 0; i < numSeries; i++) {
        crucesReduccion.push({ cruce: i + 1, slotA: `Clasificado #${i + 1}`, slotB: `Clasificado #${numClasificados - i}` });
      }
      crucesReduccion.push({ cruce: numSeries + 1, slotA: `Ganador Cruce ${cuposDesdeClasif}`, slotB: `Ganador Cruce ${cuposDesdeClasif + 1}`, esRepechaje: true });
    }

    const slotsClasif = Array.from({ length: cuposDesdeClasif }, (_, i) => ({ id: null, slot: `Clasificado Clasif. #${i + 1}` }));
    let jugSegunda = [...segunda, ...slotsClasif] as any[];
    while (jugSegunda.length % 4 !== 0) jugSegunda.push({ id: null, slot: 'LIBRE' });
    const N2 = jugSegunda.length;
    const mitad2 = N2 / 2;
    const numSeriesSegunda = N2 / 4;
    const numClasifSegunda = numSeriesSegunda * 2;

    const seriesSegunda = [];
    for (let i = 0; i < numSeriesSegunda; i++) {
      const posiciones = [i, N2 - 1 - i, mitad2 - 1 - i, mitad2 + i];
      const jugadores = posiciones.map(pos => jugSegunda[pos]);
      seriesSegunda.push({ serie: i + 1, jugadores: jugadores.map((p: any) => ({ nombre: p.id ? pn(p) : (p.slot ?? 'LIBRE'), esSlot: !p.id })) });
    }

    const slotsSegunda = Array.from({ length: numClasifSegunda }, (_, i) => ({ id: null, slot: `Clasificado Segunda #${i + 1}` }));
    const jugPrimera = [...primera, ...slotsSegunda] as any[];
    const totalPrimera = jugPrimera.length;
    const numClasifPrimera = Math.floor(totalPrimera / 2);

    const crucesPrimera = [];
    for (let i = 0; i < Math.floor(totalPrimera / 2); i++) {
      const jA = jugPrimera[i]; const jB = jugPrimera[totalPrimera - 1 - i];
      crucesPrimera.push({ cruce: i + 1, jugadorA: jA.id ? pn(jA) : (jA.slot ?? '—'), jugadorB: jB.id ? pn(jB) : (jB.slot ?? '—'), esSlotA: !jA.id, esSlotB: !jB.id });
    }

    const slotsPrimera = Array.from({ length: numClasifPrimera }, (_, i) => ({ id: null, slot: `Clasificado Primera #${i + 1}` }));
    const jugMaster = [...master, ...slotsPrimera] as any[];
    const NM = jugMaster.length;

    const crucesMaster = [];
    for (let i = 0; i < NM / 2; i++) {
      const jA = jugMaster[i]; const jB = jugMaster[NM - 1 - i];
      crucesMaster.push({ cruce: i + 1, jugadorA: jA.id ? pn(jA) : (jA.slot ?? '—'), jugadorB: jB.id ? pn(jB) : (jB.slot ?? '—'), esSlotA: !jA.id, esSlotB: !jB.id });
    }

    res.json({
      config,
      inscriptos: { total: master.length + primera.length + segunda.length + clasif.length, master: master.length, primera: primera.length, segunda: segunda.length, tercera: clasif.length },
      clasificatorio: { totalJugadores: jugConLibre.length, totalSeries: numSeries, totalClasificados: numClasificados, necesitaReduccion: numClasificados > cuposDesdeClasif, series: seriesClasif, crucesReduccion },
      segundaPreview: { totalJugadores: N2, totalSeries: numSeriesSegunda, totalClasificados: numClasifSegunda, series: seriesSegunda },
      primeraPreview: { totalJugadores: totalPrimera, totalCruces: crucesPrimera.length, totalClasificados: numClasifPrimera, cruces: crucesPrimera },
      masterPreview:  { totalJugadores: NM, totalCruces: crucesMaster.length, cruces: crucesMaster },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── POST /api/circuits/:id/generate ──────────────────────────────────
router.post('/:id/generate', async (req: Request, res: Response) => {
  const circuitId = parseInt(req.params.id);
  try {
    const circuit = await prisma.circuit.findUnique({
      where: { id: circuitId },
      include: {
        phases: { orderBy: { order: 'asc' } },
        players: { include: { player: { include: { category: true } } } }
      }
    });
    if (!circuit) { res.status(404).json({ error: 'Circuito no encontrado' }); return; }
    if (circuit.players.length === 0) { res.status(400).json({ error: 'El circuito no tiene jugadores inscriptos' }); return; }
    if (circuit.phases.length === 0) { res.status(400).json({ error: 'El circuito no tiene fases creadas' }); return; }

    const config = getConfigTorneo(circuit);

    const phaseIds = circuit.phases.map((p: any) => p.id);
    await prisma.setResult.deleteMany({ where: { match: { phaseId: { in: phaseIds } } } });
    await prisma.matchResult.deleteMany({ where: { match: { phaseId: { in: phaseIds } } } });
    await prisma.match.deleteMany({ where: { phaseId: { in: phaseIds } } });

    const librePlayer = await prisma.player.findFirst({ where: { dni: LIBRE_DNI } });
    const libreId = librePlayer?.id ?? 0;
    const libreObj = librePlayer ?? { id: libreId, dni: LIBRE_DNI, firstName: 'LIBRE', lastName: '' };

    const { master, primera, segunda, clasif } = await getJugadoresOrdenados(circuit, circuitId, config);
    const matchesCreados: any[] = [];

    // ══════════════════════════════════════════════════════════════════
    // NACIONAL
    // ══════════════════════════════════════════════════════════════════
    if (esNacional(config)) {
      const es16 = config.formato === '16';
      const phaseClasif = circuit.phases.find((p: any) => p.type === 'clasificatorio');
      const phaseMaster = circuit.phases.find((p: any) => p.type === 'master');

      if (!phaseClasif) { res.status(400).json({ error: 'Falta la fase Clasificatorio' }); return; }
      if (!phaseMaster) { res.status(400).json({ error: 'Falta la fase Master (bracket)' }); return; }

      const ruleSetSeries = config.ruleSetSeries ?? getRuleSetNacional(config.categoriaFederal, 'series');
      const ruleSetCruces = config.ruleSetCruces ?? getRuleSetNacional(config.categoriaFederal, 'cruces');

      if (clasif.length > 0) {
        const jugConLibre = completarConLibre(clasif, libreObj);
        const series = armarSeriesEspejo(jugConLibre);
        const seriesMatches = generarSeriesNacional(phaseClasif.id, series, ruleSetSeries);
        matchesCreados.push(...seriesMatches);
      }

      const bracketMatches = es16
        ? generarBracketR16(phaseMaster.id, ruleSetCruces)
        : generarBracketEliminacionSimple(phaseMaster.id, ruleSetCruces);
      matchesCreados.push(...bracketMatches);

      if (matchesCreados.length > 0) {
        await prisma.match.createMany({ data: matchesCreados });
      }

      if (libreId) {
        const partidos = await prisma.match.findMany({
          where: { phaseId: phaseClasif.id, OR: [{ playerAId: libreId }, { playerBId: libreId }] }
        });
        for (const partido of partidos) {
          const winnerId = partido.playerAId === libreId ? partido.playerBId : partido.playerAId;
          if (!winnerId) continue;
          const isA = partido.playerAId === libreId;
          await prisma.match.update({ where: { id: partido.id }, data: { status: 'wo', finishedAt: new Date() } });
          await prisma.matchResult.create({
            data: {
              matchId: partido.id,
              setsA: isA ? 0 : 2, setsB: isA ? 2 : 0,
              pointsA: isA ? 0 : 120, pointsB: isA ? 120 : 0,
              winnerId, isWO: true, woPlayerId: libreId
            }
          });
        }
      }

      const seriesCount  = matchesCreados.filter(m => m.phaseId === phaseClasif.id).length;
      const bracketCount = bracketMatches.length;

      return res.json({
        message: 'Partidos Nacional generados correctamente',
        config,
        formato: es16 ? '16' : '32',
        total: matchesCreados.length,
        detalle: {
          series:  seriesCount,
          bracket: bracketCount,
        },
        jugadores: { total: clasif.length }
      });
    }

    // ══════════════════════════════════════════════════════════════════
    // DEPARTAMENTAL (lógica original — no se toca)
    // ══════════════════════════════════════════════════════════════════
    const { cuposDesdeClasif } = config;

    const phaseClasif  = circuit.phases.find((p: any) => p.type === 'clasificatorio');
    const phaseSegunda = circuit.phases.find((p: any) => p.type === 'segunda');
    const fasePrimera  = circuit.phases.find((p: any) => p.type === 'primera');
    const faseMaster   = circuit.phases.find((p: any) => p.type === 'master');

    let numClasifSegunda = 0;
    let numClasifPrimera = 0;

    if (phaseClasif && clasif.length > 0) {
      const jugConLibre = completarConLibre(clasif, libreObj);
      const series = armarSeriesEspejo(jugConLibre);
      const numSeries = series.length;
      const numClasificados = numSeries * 2;

      for (let i = 0; i < numSeries; i++) {
        const [A, B, C, D] = series[i];
        const roundBase = i * 10 + 1;
        const serieId = `clasif-serie-${i + 1}`;
        matchesCreados.push(mkMatch(phaseClasif.id, A.id, B.id, roundBase,     undefined, undefined, serieId, RULESET_SERIES));
        matchesCreados.push(mkMatch(phaseClasif.id, C.id, D.id, roundBase + 1, undefined, undefined, serieId, RULESET_SERIES));
      }

      if (numClasificados > cuposDesdeClasif) {
        for (let i = 0; i < numSeries; i++) {
          matchesCreados.push(mkMatch(phaseClasif.id, null, null, numSeries * 10 + i + 1,
            `Clasificado #${i + 1}`, `Clasificado #${numClasificados - i}`,
            `clasif-reduccion-${i + 1}`, RULESET_SERIES
          ));
        }
        matchesCreados.push(mkMatch(phaseClasif.id, null, null, numSeries * 10 + numSeries + 1,
          `Ganador Cruce ${cuposDesdeClasif}`, `Ganador Cruce ${cuposDesdeClasif + 1}`,
          'clasif-repechaje', RULESET_SERIES
        ));
      }
    }

    if (phaseSegunda) {
      const slotsClasif = Array.from({ length: cuposDesdeClasif }, (_, i) => ({ id: null, slot: `Clasificado Clasif. #${i + 1}` }));
      let jugConSlots = [...segunda, ...slotsClasif] as any[];
      while (jugConSlots.length % 4 !== 0) jugConSlots.push({ id: null, slot: 'LIBRE' });
      const N2 = jugConSlots.length;
      const mitad = N2 / 2;
      const numSeriesSegunda = N2 / 4;
      numClasifSegunda = numSeriesSegunda * 2;

      for (let i = 0; i < numSeriesSegunda; i++) {
        const roundBase = i * 10 + 1;
        const serieId = `segunda-serie-${i + 1}`;
        const posiciones = [i, N2 - 1 - i, mitad - 1 - i, mitad + i];
        const [j0, j1, j2, j3] = posiciones.map(pos => jugConSlots[pos]);
        matchesCreados.push(mkMatch(phaseSegunda.id, j0.id ?? null, j1.id ?? null, roundBase,     j0.slot ?? undefined, j1.slot ?? undefined, serieId, RULESET_SERIES));
        matchesCreados.push(mkMatch(phaseSegunda.id, j2.id ?? null, j3.id ?? null, roundBase + 1, j2.slot ?? undefined, j3.slot ?? undefined, serieId, RULESET_SERIES));
      }
    }

    if (fasePrimera) {
      const slotsSegunda = Array.from({ length: numClasifSegunda }, (_, i) => ({ id: null, slot: `Clasificado Segunda #${i + 1}` }));
      const jugConSlots = [...primera, ...slotsSegunda] as any[];
      const total = jugConSlots.length;
      numClasifPrimera = Math.floor(total / 2);

      for (let i = 0; i < Math.floor(total / 2); i++) {
        const jA = jugConSlots[i]; const jB = jugConSlots[total - 1 - i];
        matchesCreados.push(mkMatch(fasePrimera.id, jA.id ?? null, jB.id ?? null, i + 1, jA.slot ?? undefined, jB.slot ?? undefined, `primera-cruce-${i + 1}`, RULESET_CRUCES));
      }
    }

    if (faseMaster) {
      const slotsPrimera = Array.from({ length: numClasifPrimera }, (_, i) => ({ id: null, slot: `Clasificado Primera #${i + 1}` }));
      const jugConSlots = [...master, ...slotsPrimera] as any[];
      const cuadroMatches = generarCuadroFinal(faseMaster.id, jugConSlots, RULESET_CRUCES);
      matchesCreados.push(...cuadroMatches);
    }

    if (matchesCreados.length > 0) {
      await prisma.match.createMany({ data: matchesCreados });
    }

    if (phaseClasif) {
      const partidos = await prisma.match.findMany({
        where: { phaseId: phaseClasif.id, OR: [{ playerAId: libreId }, { playerBId: libreId }] }
      });
      for (const partido of partidos) {
        const winnerId = partido.playerAId === libreId ? partido.playerBId : partido.playerAId;
        if (!winnerId) continue;
        const isA = partido.playerAId === libreId;
        await prisma.match.update({ where: { id: partido.id }, data: { status: 'wo', finishedAt: new Date() } });
        await prisma.matchResult.create({
          data: { matchId: partido.id, setsA: isA ? 0 : 2, setsB: isA ? 2 : 0, pointsA: isA ? 0 : 120, pointsB: isA ? 120 : 0, winnerId, isWO: true, woPlayerId: libreId }
        });
      }
    }

    res.json({
      message: 'Partidos generados correctamente',
      config,
      total: matchesCreados.length,
      detalle: {
        clasificatorio: matchesCreados.filter(m => m.phaseId === phaseClasif?.id).length,
        segunda:        matchesCreados.filter(m => m.phaseId === phaseSegunda?.id).length,
        primera:        matchesCreados.filter(m => m.phaseId === fasePrimera?.id).length,
        master:         matchesCreados.filter(m => m.phaseId === faseMaster?.id).length,
      },
      jugadores: { master: master.length, primera: primera.length, segunda: segunda.length, clasificatorio: clasif.length }
    });

  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── POST /api/circuits/:id/ranking-upload ────────────────────────────
router.post('/:id/ranking-upload', async (req: Request, res: Response) => {
  const circuitId = parseInt(req.params.id);
  const { rankings } = req.body;

  if (!Array.isArray(rankings) || rankings.length === 0) {
    res.status(400).json({ error: 'Se requiere un array de rankings' });
    return;
  }

  try {
    const circuit = await prisma.circuit.findUnique({ where: { id: circuitId } });
    if (!circuit) { res.status(404).json({ error: 'Circuito no encontrado' }); return; }

    let cargados = 0;
    const errores: string[] = [];

    for (const item of rankings) {
      if (!item.dni || item.position == null) {
        errores.push(`Fila inválida: ${JSON.stringify(item)}`);
        continue;
      }

      const player = await prisma.player.findFirst({
        where: { dni: { equals: String(item.dni).trim(), mode: 'insensitive' } }
      });

      if (!player) {
        errores.push(`DNI no encontrado: ${item.dni}`);
        continue;
      }

      await prisma.rankingEntry.upsert({
        where: { playerId_circuitId: { playerId: player.id, circuitId } },
        update: { position: Number(item.position) },
        create: {
          playerId: player.id,
          circuitId,
          position: Number(item.position),
          points: 0, matchesPlayed: 0, matchesWon: 0,
          setsWon: 0, setsLost: 0, pointsFor: 0, pointsAgainst: 0,
        }
      });

      await prisma.circuitPlayer.upsert({
        where: { circuitId_playerId: { circuitId, playerId: player.id } },
        update: {},
        create: { circuitId, playerId: player.id },
      });

      cargados++;
    }

    res.json({ ok: true, cargados, errores, total: rankings.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── POST /api/circuits/:id/reset ─────────────────────────────────────
router.post('/:id/reset', async (req: Request, res: Response) => {
  const circuitId = parseInt(req.params.id);
  try {
    const circuit = await prisma.circuit.findUnique({
      where: { id: circuitId },
      include: { phases: true }
    });
    if (!circuit) { res.status(404).json({ error: 'Circuito no encontrado' }); return; }

    const phaseIds = circuit.phases.map((p: any) => p.id);

    if (phaseIds.length > 0) {
      await prisma.setResult.deleteMany({ where: { match: { phaseId: { in: phaseIds } } } });
      await prisma.matchResult.deleteMany({ where: { match: { phaseId: { in: phaseIds } } } });
      await prisma.match.deleteMany({ where: { phaseId: { in: phaseIds } } });
    }

    await prisma.rankingEntry.updateMany({
      where: { circuitId },
      data: {
        points:        0,
        matchesPlayed: 0,
        matchesWon:    0,
        setsWon:       0,
        setsLost:      0,
        pointsFor:     0,
        pointsAgainst: 0,
      }
    });

    res.json({
      ok: true,
      message: `Circuito "${circuit.name}" limpiado correctamente`,
      partidos_borrados: phaseIds.length > 0,
      ranking_reseteado: true,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});


// ── POST /api/circuits/:id/init-from-circuit/:sourceCircuitId ────────
router.post("/:id/init-from-circuit/:sourceCircuitId", async (req: Request, res: Response) => {
  const targetCircuitId = parseInt(req.params.id);
  const sourceCircuitId = parseInt(req.params.sourceCircuitId);

  try {
    const sourceCircuit = await prisma.circuit.findUnique({
      where: { id: sourceCircuitId },
      include: { players: { include: { player: true } } }
    });
    if (!sourceCircuit) { res.status(404).json({ error: "Circuito origen no encontrado" }); return; }

    const targetCircuit = await prisma.circuit.findUnique({
      where: { id: targetCircuitId }
    });
    if (!targetCircuit) { res.status(404).json({ error: "Circuito destino no encontrado" }); return; }

    const sourceConfig = (sourceCircuit.configTorneo as any) ?? {};
    if (!targetCircuit.configTorneo) {
      await prisma.circuit.update({
        where: { id: targetCircuitId },
        data: {
          configTorneo: {
            tipo: sourceConfig.tipo ?? "nacional",
            categoriaFederal: sourceConfig.categoriaFederal ?? "primera",
            ruleSetSeries: sourceConfig.ruleSetSeries ?? 2,
            ruleSetCruces: sourceConfig.ruleSetCruces ?? 2,
            formato: sourceConfig.formato ?? "32",
            cantMaster: 0,
            cantPrimera: 0,
            cantSegunda: 0,
            cuposDesdeClasif: 0,
          }
        }
      });
    }

    const jugadores = sourceCircuit.players
      .map((cp: any) => cp.player)
      .filter((p: any) => p.dni !== LIBRE_DNI);

    const entries = await prisma.rankingEntry.findMany({
      where: { circuitId: sourceCircuitId }
    });

    const sorted = [...entries].sort((a: any, b: any) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.setsWon !== a.setsWon) return b.setsWon - a.setsWon;
      if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;
      return a.pointsAgainst - b.pointsAgainst;
    });

    const posicionMap = new Map<number, number>();
    sorted.forEach((e: any, idx: number) => {
      posicionMap.set(e.playerId, idx + 1);
    });

    let inscriptos = 0;
    let rankingsCreados = 0;

    for (const jugador of jugadores) {
      await prisma.circuitPlayer.upsert({
        where: { circuitId_playerId: { circuitId: targetCircuitId, playerId: jugador.id } },
        update: {},
        create: { circuitId: targetCircuitId, playerId: jugador.id }
      });
      inscriptos++;

      const posicion = posicionMap.get(jugador.id) ?? 9999;
      await prisma.rankingEntry.upsert({
        where: { playerId_circuitId: { playerId: jugador.id, circuitId: targetCircuitId } },
        update: { position: posicion },
        create: {
          playerId: jugador.id,
          circuitId: targetCircuitId,
          position: posicion,
          points: 0,
          matchesPlayed: 0,
          matchesWon: 0,
          setsWon: 0,
          setsLost: 0,
          pointsFor: 0,
          pointsAgainst: 0,
        }
      });
      rankingsCreados++;
    }

    res.json({
      ok: true,
      message: "Circuito 2 inicializado correctamente desde el ranking del Circuito 1",
      inscriptos,
      rankingsCreados,
      rankingOrden: sorted.map((e: any, idx: number) => ({
        posicion: idx + 1,
        playerId: e.playerId,
        puntos: e.points,
        setsGanados: e.setsWon,
        tantosAFavor: e.pointsFor,
      }))
    });

  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
