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

const jugadorInfo = (player: any, slot: any, rankings: any[]) =>
  player
    ? {
        nombre: `${player.lastName}, ${player.firstName}`,
        club: abrev(player.club),
        ranking: rankings.find((r: any) => r.playerId === player.id)?.position ?? null,
        categoria: player.category?.name ?? null,
        esSlot: false
      }
    : { nombre: slot ?? '—', club: '', ranking: null, categoria: null, esSlot: true };

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

// GET /api/publicaciones/:circuitId/:tipoFase
router.get('/:circuitId/:tipoFase', async (req, res: Response) => {
  try {
    const circuitId = parseInt(req.params.circuitId);
    const tipoFase = req.params.tipoFase;

    const circuit = await prisma.circuit.findUnique({
      where: { id: circuitId },
      include: { tournament: true, phases: { orderBy: { order: 'asc' } } }
    });
    if (!circuit) { res.status(404).json({ error: 'Circuito no encontrado' }); return; }

    const base = {
      tipoFase,
      torneo: circuit.tournament.name,
      circuito: circuit.name,
      temporada: String(circuit.tournament.year),
      formato: '',
    };

    // ---- RANKING ----
    if (tipoFase === 'ranking') {
      const entries = await prisma.rankingEntry.findMany({
        where: { circuitId },
        include: { player: { include: { category: true } } },
        orderBy: { position: 'asc' }
      });
      if (entries.length === 0) {
        res.status(404).json({ error: 'No hay ranking guardado para este circuito. Generalo desde la página Ranking Final.' });
        return;
      }
      const jugadores = entries.map(e => ({
        posicion: e.position,
        nombre: `${e.player.lastName}, ${e.player.firstName}`,
        club: abrev(e.player.club),
        puntos: e.points,
        setsGanados: e.setsWon,
        tantos: e.pointsFor,
        seccion: e.position <= 8 ? 'MÁSTER' : e.position <= 32 ? 'PRIMERA' : e.position <= 64 ? 'SEGUNDA' : 'TERCERA',
      }));
      return res.json({ ...base, tipo: 'ranking', fase: `RANKING — ${circuit.name.toUpperCase()}`, fechaPrincipal: '', jugadores });
    }

    // ---- FASES DE PARTIDOS ----
    let rankings = await prisma.rankingEntry.findMany({ where: { circuitId }, orderBy: { position: 'asc' } });
    if (rankings.length === 0) {
      const prev = await prisma.circuit.findFirst({ where: { tournamentId: circuit.tournamentId, order: circuit.order - 1 } });
      if (prev) rankings = await prisma.rankingEntry.findMany({ where: { circuitId: prev.id }, orderBy: { position: 'asc' } });
    }

    const phaseTypeMap: Record<string, string> = {
      clasificatorio: 'clasificatorio', reduccion: 'clasificatorio',
      segunda: 'segunda', primera: 'primera', master: 'master',
    };
    const phase = circuit.phases.find(p => p.type === phaseTypeMap[tipoFase]);
    if (!phase) { res.status(404).json({ error: `Fase '${tipoFase}' no encontrada` }); return; }

    const matches = await prisma.match.findMany({
      where: { phaseId: phase.id },
      include: {
        playerA: { include: { category: true } },
        playerB: { include: { category: true } },
        table: { include: { venue: true } },
        result: true
      },
      orderBy: { round: 'asc' }
    });

    const formato = ['primera', 'master'].includes(phaseTypeMap[tipoFase]) ? '5 sets de 60 tantos' : '3 sets de 60 tantos';

    // SERIES
    if (tipoFase === 'clasificatorio' || tipoFase === 'segunda') {
      const sm = matches.filter(m => m.serieId && !m.serieId.includes('reduccion') && !m.serieId.includes('repechaje'));
      const map: Record<string, any[]> = {};
      for (const m of sm) { if (!map[m.serieId!]) map[m.serieId!] = []; map[m.serieId!].push(m); }

      const mkP = (p: any) => ({
        jugadorA: jugadorInfo(p.playerA, p.slotA, rankings),
        jugadorB: jugadorInfo(p.playerB, p.slotB, rankings),
        sede: p.table?.venue?.name ?? '', mesa: p.table?.number ?? null,
        hora: hora(p.scheduledAt), fecha: fecha(p.scheduledAt),
        status: p.status,
        resultado: p.result ? `${p.result.setsA}-${p.result.setsB}` : null,
      });

      const series = Object.entries(map).map(([serieId, pts]) => {
        const rb = Math.min(...pts.map(p => p.round));
        return {
          serieId, numero: parseInt(serieId.match(/(\d+)$/)?.[1] ?? '0'),
          p1: pts.find(p => p.round === rb) ? mkP(pts.find(p => p.round === rb)!) : null,
          p2: pts.find(p => p.round === rb + 1) ? mkP(pts.find(p => p.round === rb + 1)!) : null,
        };
      }).sort((a, b) => a.numero - b.numero);

      const pf = sm.find(m => m.scheduledAt)?.scheduledAt;
      return res.json({ ...base, tipo: 'series', fase: tipoFase === 'clasificatorio' ? 'SERIES DEL CLASIFICATORIO' : 'SERIES DE SEGUNDA', formato, fechaPrincipal: fechaLarga(pf), series });
    }

    // REDUCCIÓN
    if (tipoFase === 'reduccion') {
      const rm = matches.filter(m => m.serieId && (m.serieId.includes('reduccion') || m.serieId.includes('repechaje')));
      const cruces = rm.map(m => ({
        numero: parseInt(m.serieId?.match(/reduccion-(\d+)$/)?.[1] ?? '0'),
        esRepechaje: m.serieId?.includes('repechaje') ?? false,
        jugadorA: jugadorInfo(m.playerA, m.slotA, rankings),
        jugadorB: jugadorInfo(m.playerB, m.slotB, rankings),
        sede: m.table?.venue?.name ?? '', mesa: m.table?.number ?? null,
        hora: hora(m.scheduledAt), fecha: fecha(m.scheduledAt),
        status: m.status,
        resultado: m.result ? `${m.result.setsA}-${m.result.setsB}` : null,
      })).sort((a, b) => a.numero - b.numero);

      const pf = rm.find(m => m.scheduledAt)?.scheduledAt;
      return res.json({ ...base, tipo: 'reduccion', fase: 'REDUCCIÓN DEL CLASIFICATORIO', formato, fechaPrincipal: fechaLarga(pf), cruces });
    }

    // CRUCES PRIMERA / MASTER
    const getEtapa = (round: number) => {
      if (tipoFase === 'primera') return 'CRUCES DE PRIMERA';
      if (round <= 16) return 'CRUCES';
      if (round <= 24) return 'OCTAVOS DE FINAL';
      if (round <= 28) return 'CUARTOS DE FINAL';
      if (round <= 30) return 'SEMIFINAL';
      return 'FINAL';
    };

    const cruces = matches.map(m => ({
      round: m.round,
      etapa: getEtapa(m.round),
      jugadorA: jugadorInfo(m.playerA, m.slotA, rankings),
      jugadorB: jugadorInfo(m.playerB, m.slotB, rankings),
      sede: m.table?.venue?.name ?? '', mesa: m.table?.number ?? null,
      hora: hora(m.scheduledAt), fecha: fecha(m.scheduledAt),
      status: m.status,
      resultado: m.result ? `${m.result.setsA}-${m.result.setsB}` : null,
    }));

    const pf = matches.find(m => m.scheduledAt)?.scheduledAt;
    res.json({ ...base, tipo: 'cruces', fase: tipoFase === 'primera' ? 'CRUCES DE PRIMERA CATEGORÍA' : 'FASE MÁSTER', formato, fechaPrincipal: fechaLarga(pf), cruces });

  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
