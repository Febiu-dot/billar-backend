import { Router, Request, Response } from 'express';
import prisma from '../services/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

// GET /api/faseconfig/:phaseId
router.get('/:phaseId', async (req: Request, res: Response) => {
  try {
    const phaseId = parseInt(req.params.phaseId);
    const config = await prisma.faseConfig.findUnique({
      where: { phaseId }
    });
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
      create: {
        phaseId,
        duracionSerie: duracionSerie ?? 45,
        configuracion: configuracion ?? {},
      },
      update: {
        duracionSerie: duracionSerie ?? 45,
        configuracion: configuracion ?? {},
        updatedAt: new Date(),
      }
    });
    res.json(config);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
