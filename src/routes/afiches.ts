// Afiches de campeonatos de los clubes (oficiales o comerciales), en curso o proximos.
// Los clubes mandan el afiche a la Federacion y el administrador lo carga. Se muestran en la portada web
// hasta que termina el campeonato. La tabla se crea sola (CREATE TABLE IF NOT EXISTS), sin migracion de Prisma.
import { Router, Request, Response } from 'express';
import prisma from '../services/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

let tablaLista = false;
async function asegurarTabla() {
  if (tablaLista) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Afiche" (
      "id" SERIAL PRIMARY KEY,
      "titulo" TEXT NOT NULL,
      "club" TEXT NOT NULL,
      "tipo" TEXT NOT NULL DEFAULT 'oficial',
      "fechaInicio" DATE NOT NULL,
      "fechaFin" DATE,
      "lugar" TEXT,
      "contacto" TEXT,
      "mime" TEXT NOT NULL,
      "imagen" TEXT NOT NULL,
      "visible" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  tablaLista = true;
}

const HOY = `(NOW() AT TIME ZONE 'America/Montevideo')::date`;
const CAMPOS = `"id", "titulo", "club", "tipo", to_char("fechaInicio", 'YYYY-MM-DD') AS "fechaInicio",
  to_char("fechaFin", 'YYYY-MM-DD') AS "fechaFin", "lugar", "contacto", "visible",
  CASE WHEN COALESCE("fechaFin","fechaInicio") < ${HOY} THEN 'finalizado'
       WHEN "fechaInicio" <= ${HOY} THEN 'en_curso' ELSE 'proximo' END AS "estado",
  EXTRACT(EPOCH FROM "updatedAt")::bigint::text AS "version"`;

const esFecha = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const texto = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, max);
  return t === '' ? null : t;
};

// Separa "data:image/jpeg;base64,XXXX" en tipo y contenido
function leerImagen(v: unknown): { mime: string; data: string } | null {
  if (typeof v !== 'string') return null;
  const m = v.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  if (m[2].length > 6_000_000) return null;
  return { mime: m[1], data: m[2] };
}

// PUBLICO: afiches visibles de campeonatos en curso o proximos
router.get('/', async (_req: Request, res: Response) => {
  try {
    await asegurarTabla();
    const filas = await prisma.$queryRawUnsafe(`
      SELECT ${CAMPOS} FROM "Afiche"
      WHERE "visible" = true AND COALESCE("fechaFin","fechaInicio") >= ${HOY}
      ORDER BY "fechaInicio" ASC, "id" ASC`);
    res.json(filas);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// PUBLICO: la imagen de un afiche
router.get('/:id/imagen', async (req: Request, res: Response) => {
  try {
    await asegurarTabla();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { res.status(400).end(); return; }
    const f: any[] = await prisma.$queryRawUnsafe(`SELECT "mime", "imagen" FROM "Afiche" WHERE "id" = ${id} AND "visible" = true`);
    if (f.length === 0) { res.status(404).end(); return; }
    res.set('Content-Type', f[0].mime);
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(Buffer.from(f[0].imagen, 'base64'));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ADMIN: todos los afiches (incluidos ocultos y finalizados)
router.get('/admin/todos', authenticate, requireRole('admin'), async (_req: AuthRequest, res: Response) => {
  try {
    await asegurarTabla();
    const filas = await prisma.$queryRawUnsafe(`SELECT ${CAMPOS} FROM "Afiche" ORDER BY "fechaInicio" DESC, "id" DESC`);
    res.json(filas);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ADMIN: la imagen aunque este oculto
router.get('/admin/:id/imagen', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    await asegurarTabla();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { res.status(400).end(); return; }
    const f: any[] = await prisma.$queryRawUnsafe(`SELECT "mime", "imagen" FROM "Afiche" WHERE "id" = ${id}`);
    if (f.length === 0) { res.status(404).end(); return; }
    res.set('Content-Type', f[0].mime);
    res.send(Buffer.from(f[0].imagen, 'base64'));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ADMIN: crear
router.post('/', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    await asegurarTabla();
    const { titulo, club, tipo, fechaInicio, fechaFin, lugar, contacto, imagen } = req.body ?? {};
    const t = texto(titulo, 120), c = texto(club, 80);
    const img = leerImagen(imagen);
    if (!t || !c) { res.status(400).json({ error: 'Faltan el título y el club.' }); return; }
    if (!esFecha(fechaInicio)) { res.status(400).json({ error: 'Falta la fecha de inicio.' }); return; }
    if (fechaFin && (!esFecha(fechaFin) || fechaFin < fechaInicio)) { res.status(400).json({ error: 'La fecha de fin no es válida.' }); return; }
    if (!img) { res.status(400).json({ error: 'Falta la imagen del afiche (JPG, PNG o WebP).' }); return; }
    const r: any[] = await prisma.$queryRawUnsafe(
      `INSERT INTO "Afiche" ("titulo","club","tipo","fechaInicio","fechaFin","lugar","contacto","mime","imagen")
       VALUES ($1,$2,$3,$4::date,$5::date,$6,$7,$8,$9) RETURNING "id"`,
      t, c, tipo === 'comercial' ? 'comercial' : 'oficial', fechaInicio, fechaFin || null,
      texto(lugar, 120), texto(contacto, 160), img.mime, img.data);
    res.status(201).json({ ok: true, id: r[0].id });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ADMIN: editar (la imagen es opcional)
router.put('/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    await asegurarTabla();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { res.status(400).json({ error: 'Id inválido' }); return; }
    const { titulo, club, tipo, fechaInicio, fechaFin, lugar, contacto, imagen, visible } = req.body ?? {};
    const t = texto(titulo, 120), c = texto(club, 80);
    if (!t || !c) { res.status(400).json({ error: 'Faltan el título y el club.' }); return; }
    if (!esFecha(fechaInicio)) { res.status(400).json({ error: 'Falta la fecha de inicio.' }); return; }
    if (fechaFin && (!esFecha(fechaFin) || fechaFin < fechaInicio)) { res.status(400).json({ error: 'La fecha de fin no es válida.' }); return; }
    const img = imagen ? leerImagen(imagen) : null;
    if (imagen && !img) { res.status(400).json({ error: 'La imagen no es válida (JPG, PNG o WebP).' }); return; }
    await prisma.$executeRawUnsafe(
      `UPDATE "Afiche" SET "titulo"=$1,"club"=$2,"tipo"=$3,"fechaInicio"=$4::date,"fechaFin"=$5::date,"lugar"=$6,"contacto"=$7,
         "visible"=COALESCE($8::boolean,"visible"),"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$9`,
      t, c, tipo === 'comercial' ? 'comercial' : 'oficial', fechaInicio, fechaFin || null,
      texto(lugar, 120), texto(contacto, 160), typeof visible === 'boolean' ? visible : null, id);
    if (img) await prisma.$executeRawUnsafe(`UPDATE "Afiche" SET "mime"=$1,"imagen"=$2 WHERE "id"=$3`, img.mime, img.data, id);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ADMIN: mostrar u ocultar sin borrar
router.patch('/:id/visible', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    await asegurarTabla();
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || typeof req.body?.visible !== 'boolean') { res.status(400).json({ error: 'Datos inválidos' }); return; }
    await prisma.$executeRawUnsafe(`UPDATE "Afiche" SET "visible"=$1::boolean,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$2`, req.body.visible, id);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ADMIN: eliminar
router.delete('/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    await asegurarTabla();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { res.status(400).json({ error: 'Id inválido' }); return; }
    await prisma.$executeRawUnsafe(`DELETE FROM "Afiche" WHERE "id"=$1`, id);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
