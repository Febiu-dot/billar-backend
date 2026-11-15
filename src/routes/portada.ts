// Datos publicos para la portada web. Solo nombre, categoria, club y departamento: nunca documento ni datos de contacto.
import { Router, Request, Response } from 'express';
import prisma from '../services/prisma';

const router = Router();

// GET /api/portada/jugadores
// Solo jugadores de la Federacion: los que no tienen club (extranjeros del Panamericano) no se muestran.
router.get('/jugadores', async (_req: Request, res: Response) => {
  try {
    const jugadores = await prisma.player.findMany({
      where: {
        active: true,
        NOT: [{ firstName: { startsWith: 'qualy', mode: 'insensitive' } }, { club: null }, { club: '' }],
      },
      select: {
        id: true, firstName: true, lastName: true, club: true,
        category: { select: { name: true } },
        departamento: { select: { nombre: true } },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    res.json(jugadores.map((p: any) => ({
      id: p.id,
      nombre: `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim(),
      categoria: p.category?.name ?? '',
      club: (p.club ?? '').trim(),
      departamento: p.departamento?.nombre ?? '',
    })));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
