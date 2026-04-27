import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../services/prisma';

const router = Router();

router.post('/login', async (req: Request, res: Response) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });

  try {
    const user = await prisma.user.findUnique({
      where: { username },
      include: { venue: true },
    });

    if (!user) return res.status(401).json({ error: 'Credenciales inválidas' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Credenciales inválidas' });

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, venueId: user.venueId },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '8h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        venueId: user.venueId,
        venueName: user.venue?.name,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

router.get('/me', async (req: Request, res: Response) => {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Sin token' });
  try {
    const token = header.split(' ')[1];
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'secret') as any;
    const user = await prisma.user.findUnique({
      where: { id: payload.id },
      include: { venue: true },
    });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({
      id: user.id,
      username: user.username,
      role: user.role,
      venueId: user.venueId,
      venueName: user.venue?.name,
    });
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
});
router.post('/create-venue-users', async (req: Request, res: Response) => {
  const venues = [
    { username: 'cabrera', venueId: 8 },
    { username: 'capolavoro', venueId: 4 },
    { username: 'centenario', venueId: 5 },
    { username: 'feriafranca', venueId: 6 },
    { username: 'modelcenter', venueId: 10 },
    { username: 'nuevomalvin', venueId: 7 },
    { username: 'sportingunion', venueId: 11 },
    { username: 'yatay', venueId: 9 },
  ];

  const password = 'juez123';
  const hashed = await bcrypt.hash(password, 10);

  for (const v of venues) {
    await prisma.user.upsert({
      where: { username: v.username },
      update: { password: hashed, venueId: v.venueId, role: 'juez_sede' },
      create: { username: v.username, password: hashed, role: 'juez_sede', venueId: v.venueId },
    });
  }

  res.json({ ok: true, message: '8 usuarios creados con juez123' });
});
export default router;
