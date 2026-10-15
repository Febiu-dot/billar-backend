// Publicaciones que el admin "publica" para la vista pública: guarda el MISMO PNG que se exporta para WhatsApp/redes.
// Una publicacion por (circuito, tipo de fase): volver a publicar la reemplaza.
// La tabla se crea sola si no existe (CREATE TABLE IF NOT EXISTS) para no depender de una migracion de Prisma.
import { Router, Request, Response } from 'express';
import prisma from '../services/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

let tablaLista = false;
async function asegurarTabla() {
  if (tablaLista) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "PublicacionPublica" (
      "id" SERIAL PRIMARY KEY,
      "circuitId" INTEGER NOT NULL,
      "tipoFase" TEXT NOT NULL,
      "titulo" TEXT NOT NULL,
      "subtitulo" TEXT,
      "imagen" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "PublicacionPublica_circuitId_tipoFase_key" UNIQUE ("circuitId", "tipoFase")
    )`);
  tablaLista = true;
}

// Lista (sin imagen). Publico: solo torneos activos. ?tournamentId= / ?circuitId= para filtrar.
router.get('/', async (req: Request, res: Response) => {
  try {
    await asegurarTabla();
    const tournamentId = req.query.tournamentId ? Number(req.query.tournamentId) : null;
    const circuitId = req.query.circuitId ? Number(req.query.circuitId) : null;
    const filas: any[] = await prisma.$queryRawUnsafe(`
      SELECT p."id", p."circuitId", p."tipoFase", p."titulo", p."subtitulo", p."updatedAt",
             c."name" AS "circuito", t."id" AS "tournamentId", t."name" AS "torneo"
      FROM "PublicacionPublica" p
      JOIN "Circuit" c ON c."id" = p."circuitId"
      JOIN "Tournament" t ON t."id" = c."tournamentId"
      WHERE t."active" = true
        AND ($1::int IS NULL OR t."id" = $1::int)
        AND ($2::int IS NULL OR p."circuitId" = $2::int)
      ORDER BY p."updatedAt" DESC`, tournamentId, circuitId);
    res.json(filas.map(f => ({ ...f, updatedAt: new Date(f.updatedAt).toISOString() })));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Imagen PNG. La URL lleva ?v=<updatedAt> para poder cachearla sin riesgo.
router.get('/:id/imagen', async (req: Request, res: Response) => {
  try {
    await asegurarTabla();
    const filas: any[] = await prisma.$queryRawUnsafe(`SELECT "imagen" FROM "PublicacionPublica" WHERE "id" = $1::int`, Number(req.params.id));
    if (filas.length === 0) { res.status(404).json({ error: 'No encontrada' }); return; }
    const m = String(filas[0].imagen).match(/^data:image\/png;base64,(.+)$/);
    if (!m) { res.status(500).json({ error: 'Imagen inválida' }); return; }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(Buffer.from(m[1], 'base64'));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Publicar / reemplazar (admin)
router.post('/', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    await asegurarTabla();
    const { circuitId, tipoFase, titulo, subtitulo, imagen } = req.body ?? {};
    if (!circuitId || !tipoFase || !titulo || typeof imagen !== 'string') { res.status(400).json({ error: 'Faltan datos (circuitId, tipoFase, titulo, imagen)' }); return; }
    if (!imagen.startsWith('data:image/png;base64,')) { res.status(400).json({ error: 'La imagen debe ser un PNG' }); return; }
    if (imagen.length > 14 * 1024 * 1024) { res.status(413).json({ error: 'La imagen es demasiado grande' }); return; }
    const filas: any[] = await prisma.$queryRawUnsafe(`
      INSERT INTO "PublicacionPublica" ("circuitId", "tipoFase", "titulo", "subtitulo", "imagen", "createdAt", "updatedAt")
      VALUES ($1::int, $2, $3, $4, $5, NOW(), NOW())
      ON CONFLICT ("circuitId", "tipoFase")
      DO UPDATE SET "titulo" = EXCLUDED."titulo", "subtitulo" = EXCLUDED."subtitulo", "imagen" = EXCLUDED."imagen", "updatedAt" = NOW()
      RETURNING "id", "updatedAt"`, Number(circuitId), String(tipoFase), String(titulo), subtitulo ? String(subtitulo) : null, imagen);
    res.json({ ok: true, id: filas[0].id, updatedAt: new Date(filas[0].updatedAt).toISOString() });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Quitar de la vista publica (admin)
router.delete('/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    await asegurarTabla();
    await prisma.$executeRawUnsafe(`DELETE FROM "PublicacionPublica" WHERE "id" = $1::int`, Number(req.params.id));
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
