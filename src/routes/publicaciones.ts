import { Router, Response } from 'express';
import prisma from '../services/prisma';

const router = Router();

const CLUB_ABREV: Record<string, string> = {
  'CAPOLAVORO': 'CAP', 'FERIA FRANCA': 'FER', 'YATAY': 'YAT',
  'CABRERA': 'CAB', 'MODEL CENTER': 'MOD', 'NUEVO MALVIN': 'NM',
  'SPORTING UNION': 'SPO', 'CENTENARIO': 'CEN',
  'CASA DEL BILLAR': 'CDB', 'PIEDRA HONDA': 'PH',
};

const abrev = (club?: string | null) =>
  club ? (CLUB_ABREV[club.toUpperCase()] ?? club.slice(0, 3).toUpperCase()) : '';

const hora = (dt?: any) =>
  dt ? new Date(dt).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';

const fecha = (dt?: any) =>
  dt ? new Date(dt).toLocaleDateString('es-UY', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

const fechaLarga = (dt?: any) => {
  if (!dt) return '';
  const d = new Date(dt);
  const dias = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  return `${dias[d.getDay()]} ${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()}`;
};

// ── Categoría federal del torneo nacional ─────────────────────────────
// El schema no tiene un campo dedicado, así que se deriva del nombre del
// torneo (ej: "Nacional de Primera 2026"). Devuelve 'primera' | 'segunda'
// | 'tercera'. Fallback: 'tercera'. Acepta acentos y mayúsculas.
const categoriaFederal = (nombreTorneo?: string | null): 'primera' | 'segunda' | 'tercera' => {
  const n = (nombreTorneo ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // quita acentos
  if (/\bprimera\b|\b1ra?\b|\b1°/.test(n)) return 'primera';
  if (/\bsegunda\b|\b2da?\b|\b2°/.test(n)) return 'segunda';
  if (/\btercera\b|\b3ra?\b|\b3°/.test(n)) return 'tercera';
  return 'tercera';
};

const jugadorInfo = (player: any, slot: any, rankings: any[]) =>
  player
    ? { nombre: `${player.lastName}, ${player.firstName}`, club: abrev(player.club), ranking: rankings.find((r: any) => r.playerId === player.id)?.position ?? null, categoria: player.category?.name ?? null, esSlot: false }
    : { nombre: slot ?? '—', club: '', ranking: null, categoria: null, esSlot: true };

const getSeccion = (pos: number | null): string => {
  const p = pos ?? 999;
  if (p <= 8)  return 'MÁSTER';
  if (p <= 32) return 'PRIMERA';
  if (p <= 64) return 'SEGUNDA';
  return 'TERCERA';
};

// ── Helper: datos de un partido para bracket ──────────────────────────
const mkBracketMatch = (m: any) => {
  if (!m) return null;
  const pA = m.playerA ? { nombre: `${m.playerA.lastName}, ${m.playerA.firstName}`, club: abrev(m.playerA.club) } : null;
  const pB = m.playerB ? { nombre: `${m.playerB.lastName}, ${m.playerB.firstName}`, club: abrev(m.playerB.club) } : null;
  return {
    serieId: m.serieId,
    playerA: pA, playerB: pB,
    slotA: m.slotA, slotB: m.slotB,
    playerAId: m.playerAId, playerBId: m.playerBId,
    winnerId: m.result?.winnerId ?? null,
    hora: hora(m.scheduledAt),
    fecha: fecha(m.scheduledAt),
    sede: m.table?.venue?.name ?? null,
    mesa: m.table?.number ?? null,
    resultado: m.result ? `${m.result.setsA}-${m.result.setsB}` : null,
    status: m.status,
  };
};

// GET /api/publicaciones/circuitos
router.get('/circuitos', async (_req, res: Response) => {
  try {
    const torneos = await prisma.tournament.findMany({
      include: { circuits: { include: { phases: { orderBy: { order: 'asc' } } }, orderBy: { order: 'asc' } } },
      orderBy: { year: 'desc' }
    });
    res.json(torneos);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/publicaciones/reset
router.delete('/reset', async (_req, res: Response) => {
  try {
    const [reportes, acumulado, rankings] = await Promise.all([
      prisma.report.deleteMany({}),
      prisma.rankingAcumulado.deleteMany({}),
      prisma.rankingEntry.updateMany({
        data: { position: null, points: 0, matchesPlayed: 0, matchesWon: 0, setsWon: 0, setsLost: 0, pointsFor: 0, pointsAgainst: 0 }
      }),
    ]);
    res.json({ ok: true, message: 'Todo vaciado correctamente', reportes_borrados: reportes.count, acumulado_borrado: acumulado.count, rankings_reseteados: rankings.count });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// GET /api/publicaciones/:circuitId/:tipoFase
router.get('/:circuitId/:tipoFase', async (req, res: Response) => {
  try {
    const circuitId = parseInt(req.params.circuitId);
    const tipoFase  = req.params.tipoFase;

    const circuit = await prisma.circuit.findUnique({
      where: { id: circuitId },
      include: { tournament: true, phases: { orderBy: { order: 'asc' } } }
    });
    if (!circuit) { res.status(404).json({ error: 'Circuito no encontrado' }); return; }

    const base = { tipoFase, torneo: circuit.tournament.name, circuito: circuit.name, temporada: String(circuit.tournament.year), formato: '' };

    // ── RANKING / RANKING FINAL ───────────────────────────────────────
    if (tipoFase === 'ranking' || tipoFase === 'ranking-final') {
      let entries = await prisma.rankingEntry.findMany({
        where: { circuitId, position: { not: null } },
        include: { player: { include: { category: true } } },
        orderBy: { position: 'asc' }
      });
      if (entries.length === 0) {
        const prev = await prisma.circuit.findFirst({ where: { tournamentId: circuit.tournamentId, order: circuit.order - 1 } });
        if (prev) entries = await prisma.rankingEntry.findMany({ where: { circuitId: prev.id, position: { not: null } }, include: { player: { include: { category: true } } }, orderBy: { position: 'asc' } });
      }
      if (entries.length === 0) { res.status(404).json({ error: 'No hay ranking para este circuito. Cargalo desde "Carga de Ranking".' }); return; }
      const jugadores = entries.map(e => ({ posicion: e.position ?? 0, nombre: `${e.player.lastName}, ${e.player.firstName}`, club: abrev(e.player.club), puntos: e.points, setsGanados: e.setsWon, tantos: e.pointsFor, seccion: getSeccion(e.position) }));
      return res.json({ ...base, tipo: 'ranking', fase: tipoFase === 'ranking-final' ? `RANKING FINAL — ${circuit.name.toUpperCase()}` : `RANKING — ${circuit.name.toUpperCase()}`, fechaPrincipal: '', jugadores });
    }

    // ── SERIES NACIONAL ───────────────────────────────────────────────
    if (tipoFase === 'series-nacional') {
      const phase = circuit.phases.find(p => p.type === 'clasificatorio');
      if (!phase) { res.status(404).json({ error: 'Fase Clasificatorio no encontrada en este circuito' }); return; }

      const matches = await prisma.match.findMany({
        where: { phaseId: phase.id, serieId: { startsWith: 'nac-serie-' } },
        include: { playerA: { include: { category: true } }, playerB: { include: { category: true } }, table: { include: { venue: true } }, result: true },
        orderBy: { round: 'asc' }
      });
      if (matches.length === 0) { res.status(404).json({ error: 'No hay partidos de series nacionales generados' }); return; }

      const rankings = await prisma.rankingEntry.findMany({ where: { circuitId, position: { not: null } }, orderBy: { position: 'asc' } });

      const seriesMap: Record<string, any[]> = {};
      for (const m of matches) { if (!m.serieId) continue; if (!seriesMap[m.serieId]) seriesMap[m.serieId] = []; seriesMap[m.serieId].push(m); }

      const series = Object.entries(seriesMap).map(([serieId, pts]) => {
        const rb = Math.min(...pts.map(p => p.round));
        const p1 = pts.find(p => p.round === rb);
        const p2 = pts.find(p => p.round === rb + 1);
        const p3 = pts.find(p => p.round === rb + 2);
        const p4 = pts.find(p => p.round === rb + 3);
        const p5 = pts.find(p => p.round === rb + 4);

        const mkP = (p: any) => p ? {
          jugadorA: jugadorInfo(p.playerA, p.slotA, rankings),
          jugadorB: jugadorInfo(p.playerB, p.slotB, rankings),
          hora: hora(p.scheduledAt), fecha: fecha(p.scheduledAt),
          sede: p.table?.venue?.name ?? '', mesa: p.table?.number ?? null,
          resultado: p.result ? `${p.result.setsA}-${p.result.setsB}` : null,
          status: p.status,
        } : null;

        const primero = p3?.result?.winnerId ? (p3.result.winnerId === p3.playerAId ? p3.playerA : p3.playerB) : null;
        const segundo = p5?.result?.winnerId ? (p5.result.winnerId === p5.playerAId ? p5.playerA : p5.playerB) : null;
        const tercero = p5?.result?.winnerId ? (p5.result.winnerId === p5.playerAId ? p5.playerB : p5.playerA) : null;
        const cuarto  = p4?.result?.winnerId ? (p4.result.winnerId === p4.playerAId ? p4.playerB : p4.playerA) : null;

        return {
          serieId, numero: parseInt(serieId.match(/(\d+)$/)?.[1] ?? '0'),
          p1: mkP(p1), p2: mkP(p2), p3: mkP(p3), p4: mkP(p4), p5: mkP(p5),
          primero: primero ? { nombre: `${primero.lastName}, ${primero.firstName}`, club: abrev(primero.club), ranking: rankings.find((r: any) => r.playerId === primero.id)?.position ?? null } : null,
          segundo: segundo ? { nombre: `${segundo.lastName}, ${segundo.firstName}`, club: abrev(segundo.club), ranking: rankings.find((r: any) => r.playerId === segundo.id)?.position ?? null } : null,
          tercero: tercero ? { nombre: `${tercero.lastName}, ${tercero.firstName}`, club: abrev(tercero.club) } : null,
          cuarto:  cuarto  ? { nombre: `${cuarto.lastName},  ${cuarto.firstName}`,  club: abrev(cuarto.club)  } : null,
          completa: !!p5?.result?.winnerId,
        };
      }).sort((a, b) => a.numero - b.numero);

      const pf = matches.find(m => m.scheduledAt)?.scheduledAt;
      return res.json({ ...base, tipo: 'series-nacional', fase: `ETAPA DE SERIES — ${circuit.tournament.name.toUpperCase()}`, formato: '3 sets de 60 tantos', fechaPrincipal: fechaLarga(pf), series });
    }

    // ── BRACKET NACIONAL ──────────────────────────────────────────────
    if (tipoFase === 'bracket-nacional') {
      const phase = circuit.phases.find(p => p.type === 'master');
      if (!phase) { res.status(404).json({ error: 'Fase Master no encontrada en este circuito' }); return; }

      const matches = await prisma.match.findMany({
        where: { phaseId: phase.id },
        include: { playerA: { include: { category: true } }, playerB: { include: { category: true } }, table: { include: { venue: true } }, result: true },
        orderBy: { round: 'asc' }
      });
      if (matches.length === 0) { res.status(404).json({ error: 'No hay partidos del bracket generados' }); return; }

      const getM = (sid: string) => mkBracketMatch(matches.find(m => m.serieId === sid));
      const pf = matches.find(m => m.scheduledAt)?.scheduledAt;

      // Determinar campeón
      const finalMatch = matches.find(m => m.serieId === 'nac-final');
      let campeon: any = null;
      if (finalMatch?.result?.winnerId) {
        const w = finalMatch.result.winnerId === finalMatch.playerAId ? finalMatch.playerA : finalMatch.playerB;
        if (w) campeon = { nombre: `${w.lastName}, ${w.firstName}`, club: abrev((w as any).club) };
      }

      return res.json({
        ...base,
        tipo: 'bracket-nacional',
        fase: `BRACKET — ${circuit.tournament.name.toUpperCase()}`,
        categoriaFederal: categoriaFederal(circuit.tournament.name),
        formato: '',
        fechaPrincipal: fechaLarga(pf),
        campeon,
        octavos: [1,2,3,4,5,6,7,8].map(i => getM(`nac-oct-${i}`)),
        cuartos: [1,2,3,4].map(i => getM(`nac-cua-${i}`)),
        semis:   [1,2].map(i => getM(`nac-semi-${i}`)),
        final:   getM('nac-final'),
      });
    }

    // ── FASES DE PARTIDOS (departamental) ─────────────────────────────
    let rankings = await prisma.rankingEntry.findMany({ where: { circuitId, position: { not: null } }, orderBy: { position: 'asc' } });
    if (rankings.length === 0) {
      const prev = await prisma.circuit.findFirst({ where: { tournamentId: circuit.tournamentId, order: circuit.order - 1 } });
      if (prev) rankings = await prisma.rankingEntry.findMany({ where: { circuitId: prev.id, position: { not: null } }, orderBy: { position: 'asc' } });
    }

    const phaseTypeMap: Record<string, string> = { clasificatorio: 'clasificatorio', reduccion: 'clasificatorio', segunda: 'segunda', primera: 'primera', master: 'master' };
    const phase = circuit.phases.find(p => p.type === phaseTypeMap[tipoFase]);
    if (!phase) { res.status(404).json({ error: `Fase '${tipoFase}' no encontrada en este circuito` }); return; }

    const matches = await prisma.match.findMany({
      where: { phaseId: phase.id },
      include: { playerA: { include: { category: true } }, playerB: { include: { category: true } }, table: { include: { venue: true } }, result: true },
      orderBy: { round: 'asc' }
    });
    if (matches.length === 0) { res.status(404).json({ error: 'No hay partidos generados para esta fase. Generalos desde Fixture.' }); return; }

    const formato = ['primera', 'master'].includes(phaseTypeMap[tipoFase]) ? '5 sets de 60 tantos' : '3 sets de 60 tantos';

    if (tipoFase === 'clasificatorio' || tipoFase === 'segunda') {
      const sm = matches.filter(m => m.serieId && !m.serieId.includes('reduccion') && !m.serieId.includes('repechaje'));
      const map: Record<string, any[]> = {};
      for (const m of sm) { if (!map[m.serieId!]) map[m.serieId!] = []; map[m.serieId!].push(m); }
      const mkP = (p: any) => ({ jugadorA: jugadorInfo(p.playerA, p.slotA, rankings), jugadorB: jugadorInfo(p.playerB, p.slotB, rankings), sede: p.table?.venue?.name ?? '', mesa: p.table?.number ?? null, hora: hora(p.scheduledAt), fecha: fecha(p.scheduledAt), status: p.status, resultado: p.result ? `${p.result.setsA}-${p.result.setsB}` : null });
      const series = Object.entries(map).map(([serieId, pts]) => {
        const rb = Math.min(...pts.map(p => p.round));
        return { serieId, numero: parseInt(serieId.match(/(\d+)$/)?.[1] ?? '0'), p1: pts.find(p => p.round === rb) ? mkP(pts.find(p => p.round === rb)!) : null, p2: pts.find(p => p.round === rb + 1) ? mkP(pts.find(p => p.round === rb + 1)!) : null };
      }).sort((a, b) => a.numero - b.numero);
      const pf = sm.find(m => m.scheduledAt)?.scheduledAt;
      return res.json({ ...base, tipo: 'series', fase: tipoFase === 'clasificatorio' ? 'SERIES DEL CLASIFICATORIO' : 'SERIES DE SEGUNDA', formato, fechaPrincipal: fechaLarga(pf), series });
    }

    if (tipoFase === 'reduccion') {
      const rm = matches.filter(m => m.serieId && (m.serieId.includes('reduccion') || m.serieId.includes('repechaje')));
      const cruces = rm.map(m => ({ numero: parseInt(m.serieId?.match(/reduccion-(\d+)$/)?.[1] ?? '0'), esRepechaje: m.serieId?.includes('repechaje') ?? false, jugadorA: jugadorInfo(m.playerA, m.slotA, rankings), jugadorB: jugadorInfo(m.playerB, m.slotB, rankings), sede: m.table?.venue?.name ?? '', mesa: m.table?.number ?? null, hora: hora(m.scheduledAt), fecha: fecha(m.scheduledAt), status: m.status, resultado: m.result ? `${m.result.setsA}-${m.result.setsB}` : null })).sort((a, b) => a.numero - b.numero);
      const pf = rm.find(m => m.scheduledAt)?.scheduledAt;
      return res.json({ ...base, tipo: 'reduccion', fase: 'REDUCCIÓN DEL CLASIFICATORIO', formato, fechaPrincipal: fechaLarga(pf), cruces });
    }

    const getEtapa = (round: number) => {
      if (tipoFase === 'primera') return 'CRUCES DE PRIMERA';
      if (round <= 16) return 'CRUCES'; if (round <= 24) return 'OCTAVOS DE FINAL';
      if (round <= 28) return 'CUARTOS DE FINAL'; if (round <= 30) return 'SEMIFINAL';
      return 'FINAL';
    };
    const cruces = matches.map(m => ({ round: m.round, etapa: getEtapa(m.round), jugadorA: jugadorInfo(m.playerA, m.slotA, rankings), jugadorB: jugadorInfo(m.playerB, m.slotB, rankings), sede: m.table?.venue?.name ?? '', mesa: m.table?.number ?? null, hora: hora(m.scheduledAt), fecha: fecha(m.scheduledAt), status: m.status, resultado: m.result ? `${m.result.setsA}-${m.result.setsB}` : null }));
    const pf = matches.find(m => m.scheduledAt)?.scheduledAt;
    res.json({ ...base, tipo: 'cruces', fase: tipoFase === 'primera' ? 'CRUCES DE PRIMERA CATEGORÍA' : 'FASE MÁSTER', formato, fechaPrincipal: fechaLarga(pf), cruces });

  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
