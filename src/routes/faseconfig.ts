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

    const esSeries = phase.type === 'clasificatorio' || phase.type === 'segunda';
    const configuracion = phase.config.configuracion as any;
    const fechas: any[] = configuracion.fechas ?? [];

    if (fechas.length === 0) { res.status(400).json({ error: 'No hay fechas configuradas para esta fase' }); return; }

    // Obtener partidos a asignar
    let partidos: any[] = [];

    if (esSeries) {
      if (!horaP1 || !horaP2) { res.status(400).json({ error: 'Se requiere horaP1 y horaP2 para series' }); return; }

      const matches = await prisma.match.findMany({
        where: {
          phaseId,
          tableId: null,
          serieId: { not: null },
          NOT: [
            { serieId: { contains: 'reduccion' } },
            { serieId: { contains: 'repechaje' } },
            { serieId: { contains: 'cruce' } },
          ]
        },
        orderBy: { round: 'asc' }
      });

      const seriesMap: Record<string, any[]> = {};
      for (const m of matches) {
        if (!m.serieId) continue;
        if (!seriesMap[m.serieId]) seriesMap[m.serieId] = [];
        seriesMap[m.serieId].push(m);
      }

      partidos = Object.entries(seriesMap)
        .sort(([a], [b]) => {
          const numA = parseInt(a.match(/(\d+)$/)?.[1] ?? '0');
          const numB = parseInt(b.match(/(\d+)$/)?.[1] ?? '0');
          return numA - numB;
        })
        .map(([serieId, ps]) => ({ serieId, partidos: ps.sort((x, y) => x.round - y.round) }));
    } else {
      if (!horaInicio || !crucesPerMesa) { res.status(400).json({ error: 'Se requiere horaInicio y crucesPerMesa para cruces' }); return; }

      partidos = await prisma.match.findMany({
        where: { phaseId, tableId: null },
        orderBy: { round: 'asc' }
      });
    }

    if (partidos.length === 0) {
      res.json({ message: 'No hay partidos pendientes de asignación', asignados: 0, total: 0 });
      return;
    }

    // Construir slots disponibles
    interface Slot { fecha: string; tableId: number; venueId: number; }

    const slotsPorFecha: Record<string, Slot[]> = {};

    for (const cfecha of fechas) {
      if (!slotsPorFecha[cfecha.fecha]) slotsPorFecha[cfecha.fecha] = [];

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

      // Intercalar mesas entre sedes
      const sedes = Object.values(porSede);
      const maxMesas = Math.max(...sedes.map(s => s.length), 0);
      for (let i = 0; i < maxMesas; i++) {
        for (const sede of sedes) {
          if (sede[i]) slotsPorFecha[cfecha.fecha].push(sede[i]);
        }
      }
    }

    const fechasOrdenadas = Object.keys(slotsPorFecha).sort();

    if (fechasOrdenadas.every(f => slotsPorFecha[f].length === 0)) {
      res.status(400).json({ error: 'No hay mesas disponibles configuradas' });
      return;
    }

    const updates: { id: number; tableId: number; scheduledAt: Date; status: string }[] = [];
    let asignados = 0;

    if (esSeries) {
      const numSeries = partidos.length;
      // Calcular total de slots disponibles
      const todosSlots: Slot[] = [];
      for (const fecha of fechasOrdenadas) {
        todosSlots.push(...slotsPorFecha[fecha]);
      }

      if (todosSlots.length === 0) {
        res.status(400).json({ error: 'No hay mesas disponibles configuradas' });
        return;
      }

      // Repartir equitativamente entre slots
      const seriesPorSlot = Math.ceil(numSeries / todosSlots.length);
      let serieIdx = 0;

      for (const slot of todosSlots) {
        for (let s = 0; s < seriesPorSlot && serieIdx < numSeries; s++) {
          const serie = partidos[serieIdx] as { serieId: string; partidos: any[] };
          const p1 = serie.partidos[0];
          const p2 = serie.partidos[1];

          if (!p1 || !p2) { serieIdx++; continue; }

          const fechaP1 = new Date(`${slot.fecha}T${horaP1}:00`);
          const fechaP2 = new Date(`${slot.fecha}T${horaP2}:00`);

          updates.push({ id: p1.id, tableId: slot.tableId, scheduledAt: fechaP1, status: 'asignado' });
          updates.push({ id: p2.id, tableId: slot.tableId, scheduledAt: fechaP2, status: 'asignado' });

          asignados++;
          serieIdx++;
        }
        if (serieIdx >= numSeries) break;
      }
    } else {
      // Cruces: llenar fecha por fecha, equitativo entre mesas
      let cruceIdx = 0;
      const numCruces = partidos.length;

      for (const fecha of fechasOrdenadas) {
        if (cruceIdx >= numCruces) break;
        const slotsEnFecha = slotsPorFecha[fecha];
        if (slotsEnFecha.length === 0) continue;

        const [horaH, horaM] = horaInicio.split(':').map(Number);
        const contadorPorMesa: Record<number, number> = {};

        const crucesEnEstaFecha = Math.min(slotsEnFecha.length * crucesPerMesa, numCruces - cruceIdx);

        for (let i = 0; i < crucesEnEstaFecha && cruceIdx < numCruces; i++) {
          const slotActual = slotsEnFecha[i % slotsEnFecha.length];
          if (!contadorPorMesa[slotActual.tableId]) contadorPorMesa[slotActual.tableId] = 0;
          if (contadorPorMesa[slotActual.tableId] >= crucesPerMesa) continue;

          const horaCruce = new Date(`${fecha}T${String(horaH).padStart(2, '0')}:${String(horaM).padStart(2, '0')}:00`);
          horaCruce.setHours(horaCruce.getHours() + contadorPorMesa[slotActual.tableId]);

          const cruce = partidos[cruceIdx] as any;
          updates.push({ id: cruce.id, tableId: slotActual.tableId, scheduledAt: horaCruce, status: 'asignado' });

          contadorPorMesa[slotActual.tableId]++;
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

    res.json({ message: 'Asignación completada', asignados, total: partidos.length });

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
