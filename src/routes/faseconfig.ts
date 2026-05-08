import { Router, Request, Response } from 'express';
import prisma from '../services/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

// POST /api/faseconfig/:phaseId/asignar — DEBE IR PRIMERO
router.post('/:phaseId/asignar', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const phaseId = parseInt(req.params.phaseId);
    const { horaP1, horaP2, horaInicio, crucesPerMesa } = req.body;

    const phase = await prisma.phase.findUnique({
      where: { id: phaseId },
      include: { config: true }
    });
    if (!phase) { res.status(404).json({ error: 'Fase no encontrada' }); return; }
    if (!phase.config) { res.status(400).json({ error: 'La fase no tiene configuración de disponibilidad' }); return; }

    const esSeries =
      phase.type?.toLowerCase().includes('clasif') ||
      phase.type?.toLowerCase().includes('segunda') ||
      phase.type === 'clasificatorio' ||
      phase.type === 'segunda';

    const configuracion = phase.config.configuracion as any;
    const fechas: any[] = configuracion.fechas ?? [];

    if (fechas.length === 0) { res.status(400).json({ error: 'No hay fechas configuradas para esta fase' }); return; }

    if (esSeries && (!horaP1 || !horaP2)) {
      res.status(400).json({ error: 'Se requiere horaP1 y horaP2 para series' }); return;
    }
    if (!esSeries && (!horaInicio || !crucesPerMesa)) {
      res.status(400).json({ error: 'Se requiere horaInicio y crucesPerMesa para cruces' }); return;
    }

    // Construir lista de slots intercalados entre sedes
    interface Slot { fecha: string; tableId: number; venueId: number; }
    const slotsIntercalados: Slot[] = [];

    for (const cfecha of fechas.sort((a: any, b: any) => a.fecha.localeCompare(b.fecha))) {
      const porSede: Record<number, Slot[]> = {};
      for (const csede of cfecha.sedes) {
        for (const cmesa of csede.mesas) {
          const table = await prisma.table.findFirst({
            where: { id: cmesa.mesaId, venueId: csede.venueId }
          });
          if (!table) continue;
          if (!porSede[csede.venueId]) porSede[csede.venueId] = [];
          porSede[csede.venueId].push({ fecha: cfecha.fecha, tableId: table.id, venueId: csede.venueId });
        }
      }

      const sedes = Object.values(porSede);
      if (sedes.length === 0) continue;
      const maxMesas = Math.max(...sedes.map(s => s.length));
      for (let i = 0; i < maxMesas; i++) {
        for (const sede of sedes) {
          if (sede[i]) slotsIntercalados.push(sede[i]);
        }
      }
    }

    if (slotsIntercalados.length === 0) {
      res.status(400).json({ error: 'No hay mesas disponibles configuradas' }); return;
    }

    // Reset previo: limpiar asignaciones anteriores de esta fase
    await prisma.match.updateMany({
      where: { phaseId },
      data: { tableId: null, scheduledAt: null, status: 'pendiente' as any }
    });

    const updates: { id: number; tableId: number; scheduledAt: Date; status: string }[] = [];
    let asignados = 0;

    // Helper: convertir minutos totales + fecha a Date con timezone Uruguay
    const minutosAFecha = (fecha: string, minutos: number): Date => {
      const hh = String(Math.floor(minutos / 60)).padStart(2, '0');
      const mm = String(minutos % 60).padStart(2, '0');
      return new Date(`${fecha}T${hh}:${mm}:00-03:00`);
    };

    if (esSeries) {
      const [h1, m1] = horaP1.split(':').map(Number);
      const [h2, m2] = horaP2.split(':').map(Number);
      const baseP1Min = h1 * 60 + m1;
      const baseP2Min = h2 * 60 + m2;
      const gapMinutos = baseP2Min - baseP1Min;
      const duracion = (phase.config as any).duracionSerie ?? 45;
      const offsetPorRonda = gapMinutos + duracion;

      const matches = await prisma.match.findMany({
        where: { phaseId, serieId: { contains: 'serie' } },
        orderBy: { round: 'asc' }
      });

      const seriesMap: Record<string, any[]> = {};
      for (const m of matches) {
        if (!m.serieId) continue;
        if (!seriesMap[m.serieId]) seriesMap[m.serieId] = [];
        seriesMap[m.serieId].push(m);
      }

      const series = Object.entries(seriesMap)
        .sort(([a], [b]) => {
          const numA = parseInt(a.match(/(\d+)$/)?.[1] ?? '0');
          const numB = parseInt(b.match(/(\d+)$/)?.[1] ?? '0');
          return numA - numB;
        })
        .map(([_, ps]) => ps.sort((x, y) => x.round - y.round));

      const mesaRonda: Record<number, number> = {};

      for (let i = 0; i < series.length; i++) {
        const slot = slotsIntercalados[i % slotsIntercalados.length];
        if (mesaRonda[slot.tableId] === undefined) mesaRonda[slot.tableId] = 0;

        const ronda = mesaRonda[slot.tableId];
        const p1 = series[i][0];
        const p2 = series[i][1];

        if (!p1 || !p2) {
          mesaRonda[slot.tableId]++;
          continue;
        }

        const minutosP1 = baseP1Min + ronda * offsetPorRonda;
        const minutosP2 = baseP2Min + ronda * offsetPorRonda;

        const fechaP1 = minutosAFecha(slot.fecha, minutosP1);
        const fechaP2 = minutosAFecha(slot.fecha, minutosP2);

        updates.push({ id: p1.id, tableId: slot.tableId, scheduledAt: fechaP1, status: 'asignado' });
        updates.push({ id: p2.id, tableId: slot.tableId, scheduledAt: fechaP2, status: 'asignado' });
        mesaRonda[slot.tableId]++;
        asignados++;
      }

    } else {
      const partidos = await prisma.match.findMany({
        where: { phaseId },
        orderBy: { round: 'asc' }
      });

      const [horaH, horaM] = horaInicio.split(':').map(Number);
      const contadorPorMesa: Record<number, number> = {};
      let cruceIdx = 0;

      const slotsPorFecha: Record<string, Slot[]> = {};
      for (const slot of slotsIntercalados) {
        if (!slotsPorFecha[slot.fecha]) slotsPorFecha[slot.fecha] = [];
        slotsPorFecha[slot.fecha].push(slot);
      }

      for (const fecha of Object.keys(slotsPorFecha).sort()) {
        if (cruceIdx >= partidos.length) break;
        const slotsEnFecha = slotsPorFecha[fecha];

        for (let i = 0; i < slotsEnFecha.length * crucesPerMesa && cruceIdx < partidos.length; i++) {
          const slot = slotsEnFecha[i % slotsEnFecha.length];
          if (!contadorPorMesa[slot.tableId]) contadorPorMesa[slot.tableId] = 0;
          if (contadorPorMesa[slot.tableId] >= crucesPerMesa) continue;

          const minutosBase = horaH * 60 + horaM + contadorPorMesa[slot.tableId] * 60;
          const horaCruce = minutosAFecha(fecha, minutosBase);

          updates.push({
            id: partidos[cruceIdx].id,
            tableId: slot.tableId,
            scheduledAt: horaCruce,
            status: 'asignado'
          });

          contadorPorMesa[slot.tableId]++;
          asignados++;
          cruceIdx++;
        }
      }
    }

    // Aplicar updates
    for (const u of updates) {
      await prisma.match.update({
        where: { id: u.id },
        data: { tableId: u.tableId, scheduledAt: u.scheduledAt, status: u.status as any }
      });
      await prisma.table.update({
        where: { id: u.tableId },
        data: { status: 'ocupada' }
      });
    }

    res.json({ message: `Asignación completada. Slots encontrados: ${slotsIntercalados.length}`, asignados, total: asignados,
  debug_slots: slotsIntercalados.length,
  debug_mesas: slotsIntercalados.map(s => ({ tableId: s.tableId, fecha: s.fecha }))
});

  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/faseconfig/:phaseId
router.get('/:phaseId', async (req: Request, res: Response) => {
  try {
    const phaseId = parseInt(req.params.phaseId);
    const config = await prisma.faseConfig.findUnique({ where: { phaseId } });
    res.json(config ?? { phaseId, duracionSerie: 45, configuracion: {} });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/faseconfig/:phaseId
router.put('/:phaseId', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const phaseId = parseInt(req.params.phaseId);
    const { duracionSerie, configuracion } = req.body;
    const config = await prisma.faseConfig.upsert({
      where: { phaseId },
      create: { phaseId, duracionSerie: duracionSerie ?? 45, configuracion: configuracion ?? {} },
      update: { duracionSerie: duracionSerie ?? 45, configuracion: configuracion ?? {}, updatedAt: new Date() }
    });
    res.json(config);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
