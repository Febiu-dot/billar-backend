import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../services/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

// GET /api/users — listar jueces de sede
router.get('/', authenticate, requireRole('admin'), async (_req: AuthRequest, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      where: { role: 'juez_sede' },
      include: { venue: true },
      orderBy: { username: 'asc' }
    });
    res.json(users.map(u => ({
      id: u.id,
      username: u.username,
      role: u.role,
      venueId: u.venueId,
      venueName: u.venue?.name ?? null,
    })));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/users/:id/password — cambiar contraseña
router.put('/:id/password', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const { password } = req.body;
  if (!password || password.length < 6) {
    res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    return;
  }
  try {
    const hashed = await bcrypt.hash(password, 10);
    const user = await prisma.user.update({
      where: { id: Number(req.params.id) },
      data: { password: hashed },
      include: { venue: true }
    });
    res.json({
      id: user.id,
      username: user.username,
      role: user.role,
      venueId: user.venueId,
      venueName: user.venue?.name ?? null,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
