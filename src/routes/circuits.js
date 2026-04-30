const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// GET /circuits — listar todos los circuitos
router.get('/', async (req, res) => {
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
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /circuits/:id — obtener un circuito
router.get('/:id', async (req, res) => {
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
    if (!circuit) return res.status(404).json({ error: 'Circuito no encontrado' });
    res.json(circuit);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /circuits/:id/players — inscribir jugador al circuito
router.post('/:id/players', async (req, res) => {
  const circuitId = parseInt(req.params.id);
  const { playerId } = req.body;

  if (!playerId) {
    return res.status(400).json({ error: 'playerId es requerido' });
  }

  try {
    // verificar que el circuito existe
    const circuit = await prisma.circuit.findUnique({ where: { id: circuitId } });
    if (!circuit) return res.status(404).json({ error: 'Circuito no encontrado' });

    // verificar que el jugador existe
    const player = await prisma.player.findUnique({ where: { id: parseInt(playerId) } });
    if (!player) return res.status(404).json({ error: 'Jugador no encontrado' });

    // inscribir (la constraint @@unique evita duplicados)
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
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'El jugador ya está inscripto en este circuito' });
    }
    res.status(500).json({ error: error.message });
  }
});

// DELETE /circuits/:id/players/:playerId — desinscribir jugador del circuito
router.delete('/:id/players/:playerId', async (req, res) => {
  const circuitId = parseInt(req.params.id);
  const playerId = parseInt(req.params.playerId);

  try {
    const record = await prisma.circuitPlayer.findUnique({
      where: {
        circuitId_playerId: { circuitId, playerId }
      }
    });

    if (!record) {
      return res.status(404).json({ error: 'El jugador no está inscripto en este circuito' });
    }

    await prisma.circuitPlayer.delete({
      where: {
        circuitId_playerId: { circuitId, playerId }
      }
    });

    res.json({ message: 'Jugador desinscripto correctamente' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
