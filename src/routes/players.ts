import { Router, Response } from 'express';
import prisma from '../services/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

router.get('/', async (req, res: Response) => {
  const { categoryId, active, departamentoId } = req.query;
  const players = await prisma.player.findMany({
    where: {
      ...(categoryId ? { categoryId: Number(categoryId) } : {}),
      ...(active !== undefined ? { active: active === 'true' } : {}),
      ...(departamentoId ? { departamentoId: Number(departamentoId) } : {}),
    },
    include: { category: true, departamento: true },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });
  res.json(players);
});

router.get('/:id', async (req, res: Response) => {
  const player = await prisma.player.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      category: true,
      departamento: true,
      matchesA: {
        include: { playerB: true, result: true, phase: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
      matchesB: {
        include: { playerA: true, result: true, phase: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
    },
  });
  if (!player) return res.status(404).json({ error: 'Jugador no encontrado' }) as any;
  res.json(player);
});

router.post('/', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const { firstName, lastName, dni, categoryId, club, departamentoId } = req.body;
  const player = await prisma.player.create({
    data: {
      firstName,
      lastName,
      dni,
      categoryId,
      club,
      departamentoId: departamentoId ? Number(departamentoId) : undefined,
    },
    include: { category: true, departamento: true },
  });
  res.status(201).json(player);
});

// POST /api/players/bulk — creación masiva de jugadores nuevos
router.post('/bulk', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const { players } = req.body as {
    players: {
      firstName: string;
      lastName: string;
      dni?: string;
      categoryId: number;
      club?: string;
      departamentoId?: number;
    }[];
  };

  if (!Array.isArray(players) || players.length === 0) {
    return res.status(400).json({ error: 'Se requiere un array de jugadores' }) as any;
  }

  const created: any[] = [];
  const errors: { index: number; dni?: string; error: string }[] = [];

  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    try {
      const player = await prisma.player.create({
        data: {
          firstName: p.firstName,
          lastName: p.lastName,
          dni: p.dni || undefined,
          categoryId: Number(p.categoryId),
          club: p.club || undefined,
          departamentoId: p.departamentoId ? Number(p.departamentoId) : undefined,
        },
        include: { category: true, departamento: true },
      });
      created.push(player);
    } catch (e: any) {
      errors.push({ index: i, dni: p.dni, error: e.message });
    }
  }

  res.status(201).json({
    creados: created.length,
    errores: errors.length,
    detallesErrores: errors,
  });
});

router.put('/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const { firstName, lastName, dni, categoryId, active, club, departamentoId } = req.body;
  const player = await prisma.player.update({
    where: { id: Number(req.params.id) },
    data: {
      firstName,
      lastName,
      dni,
      categoryId,
      active,
      club,
      departamentoId: departamentoId ? Number(departamentoId) : null,
    },
    include: { category: true, departamento: true },
  });
  res.json(player);
});

export default router;
