import { Router, Response } from 'express';
import prisma from '../services/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { generarReporteCruce, generarReporteSerie } from '../services/reportService';

const router = Router();

router.get('/', async (_req, res: Response) => {
  try {
    const reports = await prisma.report.findMany({
      where: { publicado: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(reports);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/admin', authenticate, requireRole('admin'), async (_req: AuthRequest, res: Response) => {
  try {
    const reports = await prisma.report.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json(reports);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id/toggle', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const report = await prisma.report.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!report) return res.status(404).json({ error: 'Reporte no encontrado' }) as any;
    const updated = await prisma.report.update({
      where: { id: report.id },
      data: { publicado: !report.publicado }
    });
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.report.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/regenerar/cruce/:matchId', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    await generarReporteCruce(parseInt(req.params.matchId));
    res.json({ message: 'Reporte regenerado' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/regenerar/serie/:phaseId/:serieId', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    await generarReporteSerie(parseInt(req.params.phaseId), req.params.serieId);
    res.json({ message: 'Reporte regenerado' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/regenerar-todo', authenticate, requireRole('admin'), async (_req: AuthRequest, res: Response) => {
  try {
    let generados = 0;

    // Series de clasificatorio
    const seriesClasif = await prisma.match.findMany({
      where: { phaseId: 30, serieId: { startsWith: 'clasif-serie-' }, status: 'finalizado' },
      select: { serieId: true },
      distinct: ['serieId'],
    });
    for (const { serieId } of seriesClasif) {
      if (serieId) { await generarReporteSerie(30, serieId); generados++; }
    }

    // Series de segunda
    const seriesSegunda = await prisma.match.findMany({
      where: { phaseId: 31, serieId: { startsWith: 'segunda-serie-' }, status: 'finalizado' },
      select: { serieId: true },
      distinct: ['serieId'],
    });
    for (const { serieId } of seriesSegunda) {
      if (serieId) { await generarReporteSerie(31, serieId); generados++; }
    }

    // Cruces de reducción
    const crucesReduccion = await prisma.match.findMany({
      where: { phaseId: 30, serieId: { contains: 'reduccion' }, status: 'finalizado' },
    });
    for (const match of crucesReduccion) {
      await generarReporteCruce(match.id); generados++;
    }

    // Repechaje
    const repechaje = await prisma.match.findFirst({
      where: { phaseId: 30, serieId: 'clasif-repechaje', status: 'finalizado' },
    });
    if (repechaje) { await generarReporteCruce(repechaje.id); generados++; }

    // Primera
    const matchesPrimera = await prisma.match.findMany({
      where: { phaseId: 32, status: 'finalizado' },
    });
    for (const match of matchesPrimera) {
      await generarReporteCruce(match.id); generados++;
    }

    // Master
    const matchesMaster = await prisma.match.findMany({
      where: { phaseId: 33, status: 'finalizado' },
    });
    for (const match of matchesMaster) {
      await generarReporteCruce(match.id); generados++;
    }

    res.json({ message: `${generados} reportes generados correctamente` });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
