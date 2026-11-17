// Documentos oficiales de la Federacion (Reglamento, Estatuto, etc.) en PDF, visibles en la portada web.
// El administrador los sube y los puede reemplazar. La tabla se crea sola (CREATE TABLE IF NOT EXISTS).
import { Router, Request, Response } from 'express';
import prisma from '../services/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

let tablaLista = false;
async function asegurarTabla() {
  if (tablaLista) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Documento" (
      "id" SERIAL PRIMARY KEY,
      "titulo" TEXT NOT NULL,
      "descripcion" TEXT,
      "orden" INTEGER NOT NULL DEFAULT 0,
      "nombreArchivo" TEXT NOT NULL,
      "bytes" INTEGER NOT NULL DEFAULT 0,
      "archivo" TEXT NOT NULL,
      "visible" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  tablaLista = true;
}

const CAMPOS = `"id", "titulo", "descripcion", "orden", "nombreArchivo", "bytes", "visible",
  to_char("updatedAt" AT TIME ZONE 'America/Montevideo', 'YYYY-MM-DD') AS "actualizado",
  EXTRACT(EPOCH FROM "updatedAt")::bigint::text AS "version"`;

const texto = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, max);
  return t === '' ? null : t;
};

// "data:application/pdf;base64,XXXX" -> contenido y tamano real. Maximo 9 MB.
function leerPdf(v: unknown): { data: string; bytes: number } | null {
  if (typeof v !== 'string') return null;
  const m = v.match(/^data:application\/pdf;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > 9 * 1024 * 1024 || buf.length < 100) return null;
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') return null;
  return { data: m[1], bytes: buf.length };
}
const nombrePdf = (v: unknown, titulo: string): string => {
  const base = (texto(v, 120) ?? titulo).replace(/[^\p{L}\p{N}._ -]/gu, '').trim() || 'documento';
  return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
};

// PUBLICO: documentos visibles (sin el archivo)
router.get('/', async (_req: Request, res: Response) => {
  try {
    await asegurarTabla();
    res.json(await prisma.$queryRawUnsafe(`SELECT ${CAMPOS} FROM "Documento" WHERE "visible" = true ORDER BY "orden" ASC, "id" ASC`));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// PUBLICO: el PDF (se abre en el navegador; ?descargar=1 lo descarga)
router.get('/:id/archivo', async (req: Request, res: Response) => {
  try {
    await asegurarTabla();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { res.status(400).end(); return; }
    const f: any[] = await prisma.$queryRawUnsafe(`SELECT "nombreArchivo", "archivo" FROM "Documento" WHERE "id" = ${id} AND "visible" = true`);
    if (f.length === 0) { res.status(404).end(); return; }
    const nombre = encodeURIComponent(f[0].nombreArchivo);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `${req.query.descargar === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${nombre}`);
    res.set('Cache-Control', 'public, max-age=300');
    res.send(Buffer.from(f[0].archivo, 'base64'));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ADMIN: todos
router.get('/admin/todos', authenticate, requireRole('admin'), async (_req: AuthRequest, res: Response) => {
  try {
    await asegurarTabla();
    res.json(await prisma.$queryRawUnsafe(`SELECT ${CAMPOS} FROM "Documento" ORDER BY "orden" ASC, "id" ASC`));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ADMIN: el PDF aunque este oculto
router.get('/admin/:id/archivo', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    await asegurarTabla();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { res.status(400).end(); return; }
    const f: any[] = await prisma.$queryRawUnsafe(`SELECT "nombreArchivo", "archivo" FROM "Documento" WHERE "id" = ${id}`);
    if (f.length === 0) { res.status(404).end(); return; }
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(f[0].nombreArchivo)}`);
    res.send(Buffer.from(f[0].archivo, 'base64'));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ADMIN: crear
router.post('/', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    await asegurarTabla();
    const { titulo, descripcion, orden, nombreArchivo, archivo } = req.body ?? {};
    const t = texto(titulo, 140);
    const pdf = leerPdf(archivo);
    if (!t) { res.status(400).json({ error: 'Falta el título.' }); return; }
    if (!pdf) { res.status(400).json({ error: 'Falta el PDF, o no es válido o pesa más de 9 MB.' }); return; }
    const r: any[] = await prisma.$queryRawUnsafe(
      `INSERT INTO "Documento" ("titulo","descripcion","orden","nombreArchivo","bytes","archivo") VALUES ($1,$2,$3,$4,$5,$6) RETURNING "id"`,
      t, texto(descripcion, 400), Number.isInteger(orden) ? orden : 0, nombrePdf(nombreArchivo, t), pdf.bytes, pdf.data);
    res.status(201).json({ ok: true, id: r[0].id });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ADMIN: editar (el PDF es opcional: si se manda, reemplaza al anterior)
router.put('/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    await asegurarTabla();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { res.status(400).json({ error: 'Id inválido' }); return; }
    const { titulo, descripcion, orden, nombreArchivo, archivo, visible } = req.body ?? {};
    const t = texto(titulo, 140);
    if (!t) { res.status(400).json({ error: 'Falta el título.' }); return; }
    const pdf = archivo ? leerPdf(archivo) : null;
    if (archivo && !pdf) { res.status(400).json({ error: 'El PDF no es válido o pesa más de 9 MB.' }); return; }
    await prisma.$executeRawUnsafe(
      `UPDATE "Documento" SET "titulo"=$1,"descripcion"=$2,"orden"=$3,"visible"=COALESCE($4::boolean,"visible"),"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$5`,
      t, texto(descripcion, 400), Number.isInteger(orden) ? orden : 0, typeof visible === 'boolean' ? visible : null, id);
    if (pdf) await prisma.$executeRawUnsafe(`UPDATE "Documento" SET "nombreArchivo"=$1,"bytes"=$2,"archivo"=$3 WHERE "id"=$4`, nombrePdf(nombreArchivo, t), pdf.bytes, pdf.data, id);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ADMIN: mostrar u ocultar sin borrar
router.patch('/:id/visible', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    await asegurarTabla();
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || typeof req.body?.visible !== 'boolean') { res.status(400).json({ error: 'Datos inválidos' }); return; }
    await prisma.$executeRawUnsafe(`UPDATE "Documento" SET "visible"=$1::boolean,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$2`, req.body.visible, id);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ADMIN: eliminar
router.delete('/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    await asegurarTabla();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { res.status(400).json({ error: 'Id inválido' }); return; }
    await prisma.$executeRawUnsafe(`DELETE FROM "Documento" WHERE "id"=$1`, id);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
