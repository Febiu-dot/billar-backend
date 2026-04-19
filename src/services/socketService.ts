import { Server } from 'socket.io';

export function setupSocketHandlers(io: Server) {
  io.on('connection', (socket) => {
    console.log(`🔌 Cliente conectado: ${socket.id}`);

    socket.on('join:venue', (venueId: number) => {
      socket.join(`venue:${venueId}`);
      console.log(`Socket ${socket.id} unido a venue:${venueId}`);
    });

    socket.on('join:public', () => {
      socket.join('public');
    });

    socket.on('disconnect', () => {
      console.log(`🔌 Cliente desconectado: ${socket.id}`);
    });
  });
}

export function emitMatchUpdate(io: Server, match: any) {
  io.emit('match:updated', match);
  io.to('public').emit('match:updated', match);
}

export function emitTableUpdate(io: Server, table: any) {
  io.emit('table:updated', table);
  io.to('public').emit('table:updated', table);
  if (table.venueId) {
    io.to(`venue:${table.venueId}`).emit('table:updated', table);
  }
}
