import { Router, Request, Response } from 'express';
import prisma from '../services/prisma';

const router = Router();

// GET /api/departamentos
router.get('/', async (_req: Request, res: Response) => {
  try {
    const departamentos = await prisma.departamento.findMany({
      orderBy: { nombre: 'asc' }
    });
    res.json(departamentos);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
