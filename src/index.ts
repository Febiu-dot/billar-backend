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
import categoryRoutes from './routes/categories';
import circuitRoutes from './routes/circuits';
import departamentoRoutes from './routes/departamentos';
import userRoutes from './routes/users';
import faseconfigRoutes from './routes/faseconfig';
import reportsRoutes from './routes/reports';
import { setupSocketHandlers } from './services/socketService';

const app = express();
const httpServer = createServer(app);

app.use(cors({
  origin: true,
  credentials: true,
}));

export const io = new Server(httpServer, {
  cors: {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
  },
});

app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/venues', venueRoutes);
app.use('/api/tables', tableRoutes);
app.use('/api/players', playerRoutes);
app.use('/api/tournaments', tournamentRoutes);
app.use('/api/matches', matchRoutes);
app.use('/api/rankings', rankingRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/circuits', circuitRoutes);
app.use('/api/departamentos', departamentoRoutes);
app.use('/api/users', userRoutes);
app.use('/api/faseconfig', faseconfigRoutes);
app.use('/api/reports', reportsRoutes);

setupSocketHandlers(io);

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`🎱 Servidor corriendo en http://localhost:${PORT}`);
  console.log(`   Entorno: ${process.env.NODE_ENV ?? 'development'}`);
});
