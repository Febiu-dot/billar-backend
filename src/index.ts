import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';

import authRoutes from './routes/auth';
import venueRoutes from './routes/venues';
import tableRoutes from './routes/tables';
import playerRoutes from './routes/players';
import tournamentRoutes from './routes/tournaments';
import matchRoutes from './routes/matches';
import rankingRoutes from './routes/rankings';
import { setupSocketHandlers } from './services/socketService';

const app = express();
const httpServer = createServer(app);

// Orígenes permitidos: local + Vercel (cualquier subdominio)
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  // Vercel: acepta cualquier dominio que termine en .vercel.app o dominio propio
  /https:\/\/.*\.vercel\.app$/,
  /https:\/\/.*\.up\.railway\.app$/,
];

// Si hay un dominio de producción configurado, agregarlo
if (process.env.FRONTEND_URL) {
  allowedOrigins.push(process.env.FRONTEND_URL);
}

export const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
  },
});

app.use(cors({
  origin: (origin, callback) => {
    // Permitir requests sin origin (Postman, mobile apps)
    if (!origin) return callback(null, true);
    const allowed = allowedOrigins.some(o =>
      typeof o === 'string' ? o === origin : o.test(origin)
    );
    if (allowed) return callback(null, true);
    callback(new Error(`CORS bloqueado para: ${origin}`));
  },
  credentials: true,
}));

app.use(express.json());

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/venues', venueRoutes);
app.use('/api/tables', tableRoutes);
app.use('/api/players', playerRoutes);
app.use('/api/tournaments', tournamentRoutes);
app.use('/api/matches', matchRoutes);
app.use('/api/rankings', rankingRoutes);

// Socket.IO
setupSocketHandlers(io);

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`🎱 Servidor corriendo en http://localhost:${PORT}`);
  console.log(`   Entorno: ${process.env.NODE_ENV ?? 'development'}`);
});
// redeploy