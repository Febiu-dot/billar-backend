import { Router, Request, Response } from 'express';
import prisma from '../services/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

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

// POST /api/faseconfig/:phaseId/asignar
router.post('/:phaseId/asignar', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const phaseId = parseInt(req.params.phaseId);
    const { horaP1, horaP2, horaInicio, crucesPerMesa } = req.body;

    // Obtener la fase
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

      // Obtener series (P1 y P2 sin asignar)
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

      // Agrupar por serieId y tomar P1 y P2
      const seriesMap: Record<string, any[]> = {};
      for (const m of matches) {
        if (!m.serieId) continue;
        if (!seriesMap[m.serieId]) seriesMap[m.serieId] = [];
        seriesMap[m.serieId].push(m);
      }

      // Ordenar series numéricamente
      const seriesOrdenadas = Object.entries(seriesMap)
        .sort(([a], [b]) => {
          const numA = parseInt(a.match(/(\d+)$/)?.[1] ?? '0');
          const numB = parseInt(b.match(/(\d+)$/)?.[1] ?? '0');
          return numA - numB;
        })
        .map(([serieId, ps]) => ({ serieId, partidos: ps.sort((x, y) => x.round - y.round) }));

      partidos = seriesOrdenadas;
    } else {
      if (!horaInicio || !crucesPerMesa) { res.status(400).json({ error: 'Se requiere horaInicio y crucesPerMesa para cruces' }); return; }

      // Obtener cruces sin asignar
      const matches = await prisma.match.findMany({
        where: { phaseId, tableId: null },
        orderBy: { round: 'asc' }
      });
      partidos = matches;
    }

    if (partidos.length === 0) {
      res.json({ message: 'No hay partidos pendientes de asignación', asignados: 0 });
      return;
    }

    // Construir lista de slots disponibles
    // Estructura: [{ fecha, tableId, venueId, horariosDisponibles }]
    interface Slot {
      fecha: string;
      tableId: number;
      venueId: number;
      horariosDisponibles: string[];
    }

    const slots: Slot[] = [];

    for (const cfecha of fechas) {
      // Recopilar todas las mesas de todas las sedes de esta fecha
      const mesasPorFecha: { tableId: number; venueId: number; horarios: string[] }[] = [];

      for (const csede of cfecha.sedes) {
        for (const cmesa of csede.mesas) {
          // Obtener el tableId real desde la DB
          const table = await prisma.table.findFirst({
            where: { id: cmesa.mesaId, venueId: csede.venueId }
          });
          if (!table) continue;
          mesasPorFecha.push({
            tableId: table.id,
            venueId: csede.venueId,
            horarios: cmesa.horarios.sort()
          });
        }
      }

      // Intercalar mesas entre sedes
      // Ordenar por venueId para intercalar
      const mesasOrdenadas = mesasPorFecha.sort((a, b) => a.venueId - b.venueId);

      for (const mesa of mesasOrdenadas) {
        slots.push({
          fecha: cfecha.fecha,
          tableId: mesa.tableId,
          venueId: mesa.venueId,
          horariosDisponibles: mesa.horarios
        });
      }
    }

    // Intercalar slots entre sedes: reorganizar para que queden intercalados
    // [sede1mesa1, sede2mesa1, sede1mesa2, sede2mesa2, ...]
    const slotsPorFecha: Record<string, Slot[]> = {};
    for (const slot of slots) {
      if (!slotsPorFecha[slot.fecha]) slotsPorFecha[slot.fecha] = [];
      slotsPorFecha[slot.fecha].push(slot);
    }

    // Para cada fecha, intercalar las mesas entre sedes
    const slotsIntercalados: Slot[] = [];
    for (const fecha of Object.keys(slotsPorFecha).sort()) {
      const slotsEnFecha = slotsPorFecha[fecha];
      // Agrupar por venueId
      const porSede: Record<number, Slot[]> = {};
      for (const s of slotsEnFecha) {
        if (!porSede[s.venueId]) porSede[s.venueId] = [];
        porSede[s.venueId].push(s);
      }
      // Intercalar
      const sedes = Object.values(porSede);
      const maxMesas = Math.max(...sedes.map(s => s.length));
      for (let i = 0; i < maxMesas; i++) {
        for (const sede of sedes) {
          if (sede[i]) slotsIntercalados.push(sede[i]);
        }
      }
    }

    // Asignar partidos a slots
    let asignados = 0;
    const updates: { id: number; tableId: number; scheduledAt: Date; status: string }[] = [];

    if (esSeries) {
      // Repartir series equitativamente entre mesas
      const numSeries = partidos.length;
      const numSlots = slotsIntercalados.length;

      if (numSlots === 0) { res.status(400).json({ error: 'No hay mesas disponibles configuradas' }); return; }

      // Calcular cuántas series por slot (equitativo)
      const seriesPorSlot = Math.ceil(numSeries / numSlots);

      let serieIdx = 0;
      for (const slot of slotsIntercalados) {
        if (serieIdx >= numSeries) break;

        const table = await prisma.table.findUnique({ where: { id: slot.tableId } });
        if (!table) continue;

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
      }
    } else {
      // Cruces: repartir equitativamente entre mesas con incrementos de 1 hora
      const numCruces = partidos.length;
      const numSlots = slotsIntercalados.length;

      if (numSlots === 0) { res.status(400).json({ error: 'No hay mesas disponibles configuradas' }); return; }

      // Distribuir cruces entre mesas equitativamente por fecha
      // Llenar primera fecha antes de pasar a la siguiente
      let cruceIdx = 0;

      for (const fecha of Object.keys(slotsPorFecha).sort()) {
        if (cruceIdx >= numCruces) break;
        const slotsEnFecha = slotsPorFecha[fecha];
        if (slotsEnFecha.length === 0) continue;

        // Calcular horarios por mesa
        const [horaH, horaM] = horaInicio.split(':').map(Number);

        // Distribuir equitativamente entre mesas de esta fecha
        const crucesEnEstaFecha = Math.min(
          slotsEnFecha.length * crucesPerMesa,
          numCruces - cruceIdx
        );

        // Llenar mesa por mesa intercalando sedes
        const slotsCopia = [...slotsEnFecha];
        const contadorPorMesa: Record<number, number> = {};

        for (let i = 0; i < crucesEnEstaFecha && cruceIdx < numCruces; i++) {
          // Encontrar mesa con menos cruces asignados (intercalando)
          const slotActual = slotsCopia[i % slotsCopia.length];
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

    // Aplicar updates en la DB
    for (const u of updates) {
      await prisma.match.update({
        where: { id: u.id },
        data: {
          tableId: u.tableId,
          scheduledAt: u.scheduledAt,
          status: u.status as any,
        }
      });

      // Marcar mesa como ocupada
      await prisma.table.update({
        where: { id: u.tableId },
        data: { status: 'ocupada' }
      });
    }

    res.json({
      message: `Asignación completada`,
      asignados,
      total: partidos.length,
    });

  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
