import { Router, Response } from 'express';
import prisma from '../services/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

const PREFIJOS_DEPARTAMENTO: Record<string, string> = {
  'Artigas': 'ART',
  'Canelones': 'CAN',
  'Canelones Este': 'CAE',
  'Canelones Oeste': 'CAO',
  'Cerro Largo': 'CER',
  'Colonia': 'COL',
  'Durazno': 'DUR',
  'Flores': 'FLS',
  'Florida': 'FLA',
  'Lavalleja': 'LAV',
  'Maldonado': 'MAL',
  'Montevideo': 'MON',
  'Paysandú': 'PAY',
  'Río Negro': 'RIO',
  'Rivera': 'RIV',
  'Rocha': 'ROC',
  'Salto': 'SAL',
  'San José': 'SJO',
  'Soriano': 'SOR',
  'Tacuarembó': 'TAC',
  'Treinta y Tres': 'TYT',
};

async function generarCI(departamentoId?: number | null): Promise<string> {
  let prefijo = 'FEB';
  if (departamentoId) {
    const depto = await prisma.departamento.findUnique({ where: { id: departamentoId } });
    if (depto) {
      prefijo = PREFIJOS_DEPARTAMENTO[depto.nombre] ?? depto.nombre.substring(0, 3).toUpperCase();
    }
  }
  const existentes = await prisma.player.findMany({
    where: { dni: { startsWith: prefijo } },
    select: { dni: true },
  });
  let maxNum = 0;
  for (const p of existentes) {
    const match = p.dni?.match(new RegExp(`^${prefijo}(\\d+)$`));
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > maxNum) maxNum = n;
    }
  }
  const siguiente = String(maxNum + 1).padStart(3, '0');
  return `${prefijo}${siguiente}`;
}

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
  const { firstName, lastName, dni, categoryId, club, pais, departamentoId } = req.body;
  const depId = departamentoId ? Number(departamentoId) : undefined;
  const ciFinal = dni && String(dni).trim() ? dni : await generarCI(depId);
  const player = await prisma.player.create({
    data: {
      firstName,
      lastName,
      dni: ciFinal,
      categoryId,
      club,
      pais: pais || 'Uruguay',
      departamentoId: depId,
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
      pais?: string;
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
      const depId = p.departamentoId ? Number(p.departamentoId) : undefined;
      const ciFinal = p.dni && String(p.dni).trim() ? p.dni : await generarCI(depId);
      const player = await prisma.player.create({
        data: {
          firstName: p.firstName,
          lastName: p.lastName,
          dni: ciFinal,
          categoryId: Number(p.categoryId),
          club: p.club || undefined,
          pais: p.pais || 'Uruguay',
          departamentoId: depId,
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
  const { firstName, lastName, dni, categoryId, active, club, pais, departamentoId } = req.body;
  const player = await prisma.player.update({
    where: { id: Number(req.params.id) },
    data: {
      firstName,
      lastName,
      dni,
      categoryId,
      active,
      club,
      pais,
      departamentoId: departamentoId ? Number(departamentoId) : null,
    },
    include: { category: true, departamento: true },
  });
  res.json(player);
});

// DELETE /api/players/:id — borrado definitivo. Solo permitido si el jugador
// NUNCA jugó (sin partidos, sin inscripciones a circuitos ni ranking). Si tiene
// historial, se bloquea y se sugiere desactivar en vez de borrar.
router.delete('/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  try {
    const [matchesA, matchesB, circuitPlayers, rankingEntries, rankingAcumulados] = await Promise.all([
      prisma.match.count({ where: { playerAId: id } }),
      prisma.match.count({ where: { playerBId: id } }),
      prisma.circuitPlayer.count({ where: { playerId: id } }),
      prisma.rankingEntry.count({ where: { playerId: id } }),
      prisma.rankingAcumulado.count({ where: { playerId: id } }),
    ]);
    const tieneHistorial = matchesA > 0 || matchesB > 0 || circuitPlayers > 0 || rankingEntries > 0 || rankingAcumulados > 0;
    if (tieneHistorial) {
      res.status(409).json({
        error: 'Este jugador tiene historial (partidos, inscripciones o ranking) y no se puede eliminar. Desactivalo en su lugar.',
        detalle: { matchesA, matchesB, circuitPlayers, rankingEntries, rankingAcumulados },
      });
      return;
    }
    await prisma.player.delete({ where: { id } });
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
