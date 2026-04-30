import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// GET /api/circuits
router.get('/', async (_req: Request, res: Response) => {
  try {
    const circuits = await prisma.circuit.findMany({
      include: {
        tournament: true,
        phases: { orderBy: { order: 'asc' } },
        players: {
          include: {
            player: {
              include: { category: true }
            }
          }
        }
      },
      orderBy: { order: 'asc' }
    });
    res.json(circuits);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/circuits/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const circuit = await prisma.circuit.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        tournament: true,
        phases: { orderBy: { order: 'asc' } },
        players: {
          include: {
            player: {
              include: { category: true }
            }
          }
        }
      }
    });
    if (!circuit) return res.status(404).json({ error: 'Circuito no encontrado' }) as any;
    res.json(circuit);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/circuits/:id/players — inscribir jugador
router.post('/:id/players', async (req: Request, res: Response) => {
  const circuitId = parseInt(req.params.id);
  const { playerId } = req.body;

  if (!playerId) {
    return res.status(400).json({ error: 'playerId es requerido' }) as any;
  }

  try {
    const circuit = await prisma.circuit.findUnique({ where: { id: circuitId } });
    if (!circuit) return res.status(404).json({ error: 'Circuito no encontrado' }) as any;

    const player = await prisma.player.findUnique({ where: { id: parseInt(playerId) } });
    if (!player) return res.status(404).json({ error: 'Jugador no encontrado' }) as any;

    const circuitPlayer = await prisma.circuitPlayer.create({
      data: {
        circuitId,
        playerId: parseInt(playerId)
      },
      include: {
        player: { include: { category: true } }
      }
    });

    res.status(201).json(circuitPlayer);
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'El jugador ya está inscripto en este circuito' }) as any;
    }
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/circuits/:id/players/:playerId — desinscribir jugador
router.delete('/:id/players/:playerId', async (req: Request, res: Response) => {
  const circuitId = parseInt(req.params.id);
  const playerId = parseInt(req.params.playerId);

  try {
    const record = await prisma.circuitPlayer.findUnique({
      where: {
        circuitId_playerId: { circuitId, playerId }
      }
    });

    if (!record) {
      return res.status(404).json({ error: 'El jugador no está inscripto en este circuito' }) as any;
    }

    await prisma.circuitPlayer.delete({
      where: {
        circuitId_playerId: { circuitId, playerId }
      }
    });

    res.json({ message: 'Jugador desinscripto correctamente' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
