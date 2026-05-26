import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../services/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

// GET /api/users — listar todos los usuarios (admin ve todos, juez solo se ve a sí mismo)
router.get('/', authenticate, requireRole('admin'), async (_req: AuthRequest, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      include: { venue: true },
      orderBy: [{ role: 'asc' }, { username: 'asc' }]
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

// POST /api/users — crear nuevo usuario juez_sede
router.post('/', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const { username, password, venueId } = req.body;

  if (!username || username.trim() === '') {
    res.status(400).json({ error: 'El nombre de usuario es requerido' });
    return;
  }
  if (!password || password.length < 6) {
    res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    return;
  }

  try {
    const existing = await prisma.user.findUnique({ where: { username: username.trim() } });
    if (existing) {
      res.status(409).json({ error: `El usuario "${username}" ya existe` });
      return;
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        username: username.trim(),
        password: hashed,
        role: 'juez_sede',
        venueId: venueId ? Number(venueId) : undefined,
      },
      include: { venue: true }
    });
    res.status(201).json({
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

// DELETE /api/users/:id — eliminar usuario
router.delete('/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.user.delete({ where: { id: Number(req.params.id) } });
    res.json({ ok: true });
  } catch (error: any) {
    res.status(400).json({ error: 'No se puede eliminar el usuario' });
  }
});

export default router;
