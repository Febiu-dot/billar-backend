import prisma from './prisma';

function pn(player: any): string {
  if (!player) return '—';
  return `${player.lastName}, ${player.firstName}`;
}

function formatFecha(date: Date | string | null | undefined): string {
  if (!date) return '';
  return new Date(date).toLocaleString('es-UY', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  }) + 'hs';
}

function labelCruce(phaseType: string, round: number, serieId: string | null): string {
  if (serieId?.includes('repechaje')) return 'Repechaje Clasificatorio';
  if (serieId?.includes('reduccion')) {
    const n = serieId.match(/clasif-reduccion-(\d+)/)?.[1];
    return `Cruce de Reducción ${n ?? round}`;
  }
  if (phaseType === 'primera') return `Tercera Fase — Cruce ${round}`;
  if (phaseType === 'master') {
    if (round <= 16) return `Cruce Master ${round}`;
    if (round <= 24) return `Octavo ${round - 16}`;
    if (round <= 28) return `Cuarto ${round - 24}`;
    if (round <= 30) return `Semifinal ${round - 28}`;
    return 'Final';
  }
  return `Partido R${round}`;
}

async function findNextMatch(playerId: number) {
  return prisma.match.findFirst({
    where: {
      OR: [{ playerAId: playerId }, { playerBId: playerId }],
      status: { in: ['pendiente', 'asignado'] },
    },
    include: {
      playerA: true,
      playerB: true,
      table: { include: { venue: true } },
      phase: true,
    },
    orderBy: [{ phaseId: 'asc' }, { round: 'asc' }]
  });
}

async function saveReport(data: {
  tipo: string;
  phaseId: number;
  serieId?: string | null;
  matchId?: number | null;
  titulo: string;
  contenido: any;
  texto: string;
}) {
  const existing = await prisma.report.findFirst({
    where: data.matchId
      ? { matchId: data.matchId }
      : { phaseId: data.phaseId, serieId: data.serieId }
  });

  if (existing) {
    await prisma.report.update({
      where: { id: existing.id },
      data: { titulo: data.titulo, contenido: data.contenido, texto: data.texto, updatedAt: new Date() }
    });
  } else {
    await prisma.report.create({ data: { ...data, publicado: true } });
  }
}

export async function generarReporteCruce(matchId: number): Promise<void> {
  try {
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      include: {
        playerA: true,
        playerB: true,
        result: true,
        sets: { orderBy: { setNumber: 'asc' } },
        table: { include: { venue: true } },
        phase: { include: { circuit: { include: { tournament: true } } } },
      }
    });

    if (!match || !match.result?.winnerId) return;

    const titulo = labelCruce(match.phase.type, match.round, match.serieId);
    const torneo = match.phase.circuit?.tournament?.name ?? '';
    const winner = match.result.winnerId === match.playerAId ? match.playerA : match.playerB;
    const nextMatch = winner ? await findNextMatch(winner.id) : null;

    const nextMatchInfo = nextMatch ? {
      jugadorA: nextMatch.playerA ? pn(nextMatch.playerA) : (nextMatch.slotA ?? '—'),
      jugadorB: nextMatch.playerB ? pn(nextMatch.playerB) : (nextMatch.slotB ?? '—'),
      sede: nextMatch.table?.venue?.name ?? null,
      mesa: nextMatch.table?.number ?? null,
      scheduledAt: nextMatch.scheduledAt ?? null,
      fase: labelCruce(nextMatch.phase?.type ?? '', nextMatch.round, nextMatch.serieId),
    } : null;

    const contenido = {
      tipo: 'cruce',
      titulo,
      torneo,
      jugadorA: pn(match.playerA),
      jugadorB: pn(match.playerB),
      setsA: match.result.setsA,
      setsB: match.result.setsB,
      sets: match.sets.map(s => ({ setNumber: s.setNumber, pointsA: s.pointsA, pointsB: s.pointsB })),
      ganador: pn(winner),
      isWO: match.result.isWO,
      sede: match.table?.venue?.name ?? null,
      mesa: match.table?.number ?? null,
      nextMatch: nextMatchInfo,
    };

    let texto = `🎱 *${titulo.toUpperCase()}*\n`;
    texto += `${torneo}\n\n`;
    texto += `${pn(match.playerA)}  ${match.result.setsA} - ${match.result.setsB}  ${pn(match.playerB)}\n`;
    if (match.sets.length > 0) {
      texto += match.sets.map(s => `Set ${s.setNumber}: ${s.pointsA}-${s.pointsB}`).join(' | ') + '\n';
    }
    if (match.result.isWO) texto += `_(W.O.)_\n`;
    texto += `\n✅ *AVANZA:* ${pn(winner)}\n`;

    if (nextMatchInfo) {
      texto += `\n📌 *PRÓXIMO PARTIDO:*\n`;
      texto += `${nextMatchInfo.jugadorA} vs ${nextMatchInfo.jugadorB}\n`;
      if (nextMatchInfo.sede) texto += `🏛 ${nextMatchInfo.sede}${nextMatchInfo.mesa ? ` | Mesa ${nextMatchInfo.mesa}` : ''}\n`;
      if (nextMatchInfo.scheduledAt) texto += `📅 ${formatFecha(nextMatchInfo.scheduledAt)}\n`;
    }

    await saveReport({ tipo: 'cruce', phaseId: match.phaseId, matchId, titulo, contenido, texto });
    console.log(`✅ Reporte generado: ${titulo}`);
  } catch (error) {
    console.error('Error generando reporte de cruce:', error);
  }
}

export async function generarReporteSerie(phaseId: number, serieId: string): Promise<void> {
  try {
    const partidos = await prisma.match.findMany({
      where: { phaseId, serieId },
      include: {
        playerA: true,
        playerB: true,
        result: true,
        sets: { orderBy: { setNumber: 'asc' } },
        table: { include: { venue: true } },
        phase: { include: { circuit: { include: { tournament: true } } } },
      },
      orderBy: { round: 'asc' }
    });

    if (partidos.length === 0) return;

    const phase = partidos[0].phase;
    const torneo = phase.circuit?.tournament?.name ?? '';
    const serieNum = serieId.match(/(?:clasif-serie-|segunda-serie-)(\d+)/)?.[1] ?? '?';
    const faseLabel = phase.type === 'clasificatorio' ? 'Clasificatorio' : 'Segunda Fase';
    const titulo = `Serie ${serieNum} — ${faseLabel}`;
    const roundBase = Math.min(...partidos.map(p => p.round));

    const resultados = partidos.map(p => ({
      numero: p.round - roundBase + 1,
      jugadorA: pn(p.playerA),
      jugadorB: pn(p.playerB),
      setsA: p.result?.setsA ?? 0,
      setsB: p.result?.setsB ?? 0,
      sets: p.sets.map(s => ({ setNumber: s.setNumber, pointsA: s.pointsA, pointsB: s.pointsB })),
      isWO: p.result?.isWO ?? false,
      winnerId: p.result?.winnerId ?? null,
    }));

    const p3 = partidos.find(p => p.round === roundBase + 2);
    const p5 = partidos.find(p => p.round === roundBase + 4);
    const clasificado1 = p3?.result?.winnerId === p3?.playerAId ? p3?.playerA : p3?.playerB;
    const clasificado2 = p5?.result?.winnerId === p5?.playerAId ? p5?.playerA : p5?.playerB;

    const nextMatch1 = clasificado1?.id ? await findNextMatch(clasificado1.id) : null;
    const nextMatch2 = clasificado2?.id ? await findNextMatch(clasificado2.id) : null;

    const mkNextInfo = (nm: any) => nm ? {
      jugadorA: nm.playerA ? pn(nm.playerA) : (nm.slotA ?? '—'),
      jugadorB: nm.playerB ? pn(nm.playerB) : (nm.slotB ?? '—'),
      sede: nm.table?.venue?.name ?? null,
      mesa: nm.table?.number ?? null,
      scheduledAt: nm.scheduledAt ?? null,
    } : null;

    const contenido = {
      tipo: 'serie',
      titulo,
      torneo,
      serieId,
      resultados,
      clasificados: [
        clasificado1 ? { jugador: pn(clasificado1), puesto: 1 } : null,
        clasificado2 ? { jugador: pn(clasificado2), puesto: 2 } : null,
      ].filter(Boolean),
      nextMatches: [mkNextInfo(nextMatch1), mkNextInfo(nextMatch2)].filter(Boolean),
    };

    let texto = `🎱 *${titulo.toUpperCase()}*\n`;
    texto += `${torneo}\n\n`;

    for (const r of resultados) {
      const setsStr = r.sets.length > 0 ? ` (${r.sets.map((s: any) => `${s.pointsA}-${s.pointsB}`).join(' | ')})` : '';
      texto += `P${r.numero}: ${r.jugadorA}  ${r.setsA}-${r.setsB}  ${r.jugadorB}${setsStr}`;
      if (r.isWO) texto += ' _W.O._';
      texto += '\n';
    }

    texto += `\n✅ *CLASIFICADOS:*\n`;
    if (clasificado1) texto += `1️⃣ ${pn(clasificado1)}\n`;
    if (clasificado2) texto += `2️⃣ ${pn(clasificado2)}\n`;

    const nextInfos = [
      nextMatch1 ? { player: clasificado1, match: nextMatch1 } : null,
      nextMatch2 ? { player: clasificado2, match: nextMatch2 } : null,
    ].filter(Boolean);

    if (nextInfos.length > 0) {
      texto += `\n📌 *PRÓXIMOS PARTIDOS:*\n`;
      for (const ni of nextInfos) {
        const nm = ni!.match;
        const nA = nm.playerA ? pn(nm.playerA) : (nm.slotA ?? '—');
        const nB = nm.playerB ? pn(nm.playerB) : (nm.slotB ?? '—');
        texto += `${nA} vs ${nB}\n`;
        if (nm.table) texto += `🏛 ${nm.table.venue?.name}${nm.table.number ? ` | Mesa ${nm.table.number}` : ''}\n`;
        if (nm.scheduledAt) texto += `📅 ${formatFecha(nm.scheduledAt)}\n`;
        texto += '\n';
      }
    }

    await saveReport({ tipo: 'serie', phaseId, serieId, titulo, contenido, texto });
    console.log(`✅ Reporte generado: ${titulo}`);
  } catch (error) {
    console.error('Error generando reporte de serie:', error);
  }
}
