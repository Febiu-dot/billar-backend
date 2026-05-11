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

export default router;
