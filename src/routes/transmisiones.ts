// Transmisiones en vivo por mesa. Cada mesa puede tener un canal de YouTube (codigo UC...) y un interruptor Prendida/Apagada.
// El juez de la sede (o el admin) carga el canal una vez y despues solo prende o apaga.
// La tabla se crea sola si no existe (CREATE TABLE IF NOT EXISTS), sin migracion de Prisma.
import { Router, Request, Response } from 'express';
import prisma from '../services/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { io } from '../index';

const router = Router();

let tablaLista = false;
async function asegurarTabla() {
  if (tablaLista) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Transmision" (
      "tableId" INTEGER PRIMARY KEY,
      "canal" TEXT,
      "activa" BOOLEAN NOT NULL DEFAULT false,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  tablaLista = true;
}

// Acepta el codigo (UC + 22 caracteres) o un link con /channel/UC...
function extraerCanal(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const m = valor.trim().match(/UC[\w-]{22}/);
  return m ? m[0] : null;
}

function avisar() {
  io.emit('transmision:updated', { at: Date.now() });
  io.to('public').emit('transmision:updated', { at: Date.now() });
}

// Publico: solo las transmisiones prendidas, con sede y mesa.
router.get('/', async (_req: Request, res: Response) => {
  try {
    await asegurarTabla();
    const filas: any[] = await prisma.$queryRawUnsafe(`
      SELECT x."tableId", x."canal", t."number" AS "mesa", v."id" AS "venueId", v."name" AS "sede"
      FROM "Transmision" x
      JOIN "Table" t ON t."id" = x."tableId"
      JOIN "Venue" v ON v."id" = t."venueId"
      WHERE x."activa" = true AND x."canal" IS NOT NULL
      ORDER BY v."name" ASC, t."number" ASC`);
    res.json(filas);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Juez / admin: mesas de su sede con su configuracion. Admin puede pedir ?venueId=
router.get('/mesas', authenticate, requireRole('admin', 'juez_sede'), async (req: AuthRequest, res: Response) => {
  try {
    await asegurarTabla();
    const venueId = req.user!.role === 'admin'
      ? (req.query.venueId ? Number(req.query.venueId) : null)
      : (req.user!.venueId ?? null);
    const filas: any[] = await prisma.$queryRawUnsafe(`
      SELECT t."id" AS "tableId", t."number" AS "mesa", v."id" AS "venueId", v."name" AS "sede",
             x."canal", COALESCE(x."activa", false) AS "activa"
      FROM "Table" t
      JOIN "Venue" v ON v."id" = t."venueId"
      LEFT JOIN "Transmision" x ON x."tableId" = t."id"
      WHERE ($1::int IS NULL OR t."venueId" = $1::int)
      ORDER BY v."name" ASC, t."number" ASC`, venueId);
    res.json(filas);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Cargar el canal y/o prender-apagar una mesa. Solo admin o el juez de la sede de esa mesa.
router.put('/mesa/:tableId', authenticate, requireRole('admin', 'juez_sede'), async (req: AuthRequest, res: Response) => {
  try {
    await asegurarTabla();
    const tableId = Number(req.params.tableId);
    const mesa = await prisma.table.findUnique({ where: { id: tableId } });
    if (!mesa) { res.status(404).json({ error: 'Mesa no encontrada' }); return; }
    if (req.user!.role === 'juez_sede' && req.user!.venueId !== mesa.venueId) {
      res.status(403).json({ error: 'Esa mesa es de otra sede' }); return;
    }

    const actual: any[] = await prisma.$queryRawUnsafe(`SELECT "canal", "activa" FROM "Transmision" WHERE "tableId" = $1::int`, tableId);
    let canal: string | null = actual[0]?.canal ?? null;
    let activa: boolean = actual[0]?.activa ?? false;

    if (req.body && 'canal' in req.body) {
      const vacio = req.body.canal === null || String(req.body.canal).trim() === '';
      if (vacio) { canal = null; activa = false; }
      else {
        const c = extraerCanal(req.body.canal);
        if (!c) { res.status(400).json({ error: 'El canal no es valido. Debe empezar con UC y tener 24 caracteres.' }); return; }
        canal = c;
      }
    }
    if (req.body && typeof req.body.activa === 'boolean') {
      if (req.body.activa && !canal) { res.status(400).json({ error: 'Primero hay que cargar el canal de esta mesa.' }); return; }
      activa = req.body.activa;
    }

    await prisma.$executeRawUnsafe(`
      INSERT INTO "Transmision" ("tableId", "canal", "activa", "updatedAt")
      VALUES ($1::int, $2, $3, NOW())
      ON CONFLICT ("tableId") DO UPDATE SET "canal" = EXCLUDED."canal", "activa" = EXCLUDED."activa", "updatedAt" = NOW()`,
      tableId, canal, activa);
    avisar();
    res.json({ ok: true, tableId, canal, activa });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
