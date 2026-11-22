// Datos publicos para la portada web. Jugadores: solo nombre, categoria, club y departamento (nunca documento ni contacto del jugador). Contactos: solo de las sedes/clubes.
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

// GET /api/portada/contactos
// Datos de contacto de las sedes/clubes (nombre, direccion, ciudad, telefono) para la seccion Clubes de la web.
router.get('/contactos', async (_req: Request, res: Response) => {
  try {
    const v = await prisma.venue.findMany({ select: { name: true, address: true, city: true, phone: true }, orderBy: { name: 'asc' } });
    res.json(v.map((x: any) => ({ nombre: x.name, direccion: x.address ?? '', ciudad: x.city ?? '', telefono: x.phone ?? '' })));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// GET /api/portada/sedes?tournamentId=N
// Sedes de un torneo: las del departamento del torneo (si lo tiene) mas las que tienen o tuvieron partidos en el torneo.
router.get('/sedes', async (req: Request, res: Response) => {
  try {
    const tournamentId = parseInt(String(req.query.tournamentId ?? ''));
    if (!tournamentId) { res.json([]); return; }
    const torneo = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { departamentoId: true } });
    if (!torneo) { res.json([]); return; }
    const porPartidos = await prisma.venue.findMany({
      where: { tables: { some: { matches: { some: { phase: { circuit: { tournamentId } } } } } } },
      select: { id: true, name: true },
    });
    const porDepto = torneo.departamentoId
      ? await prisma.venue.findMany({ where: { departamentoId: torneo.departamentoId }, select: { id: true, name: true } })
      : [];
    const mapa = new Map<number, string>();
    [...porDepto, ...porPartidos].forEach(v => mapa.set(v.id, v.name));
    res.json([...mapa.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
