// =====================================================================
//  Gato Swing — servidor Express + Socket.IO (Render Web Service)
//  - Sirve el juego desde public/ (todas las librerías son locales: sin CDNs).
//  - Retransmite los mensajes entre la pantalla (host) y los celulares por salas.
//    Socket.IO empieza con HTTP long-polling y sube a WebSocket si la red lo
//    permite: funciona detrás de proxies que bloquean WebSockets o WebRTC.
//  - Celulares y pantalla se reconectan solos; la sala sobrevive a caídas
//    cortas de la pantalla (y si el servidor reinicia, la pantalla recupera
//    su mismo código para que los celulares que reintentan vuelvan a entrar).
//  - GET /healthz para el health check de Render.
// =====================================================================
'use strict';
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const compression = require('compression');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT) || 3000;
const HOST_GRACE_MS = 3 * 60 * 1000;   // la sala sigue viva este tiempo si la pantalla se cae
const MAX_PLAYERS = 32;
const started = Date.now();

const app = express();
app.disable('x-powered-by');
app.use(compression());

app.get('/healthz', (req, res) => {
  res.set('Cache-Control', 'no-store').json({ ok: true, game: 'gato-swing', uptime: Math.round((Date.now() - started) / 1000), rooms: rooms.size, sockets: io.engine.clientsCount });
});
app.get('/host', (req, res) => res.redirect('/'));
app.get('/play', (req, res) => res.redirect('/play.html' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '')));

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, file) {
    if (/\.html$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
    else if (/\.(glb|png|jpg|mp3|woff2?)$/.test(file)) res.setHeader('Cache-Control', 'public, max-age=604800');
    else res.setHeader('Cache-Control', 'public, max-age=600');
  },
}));

// ---- Salas --------------------------------------------------------------------
const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 8000, pingTimeout: 10000, maxHttpBufferSize: 256 * 1024,
  cors: { origin: true },
});
// code -> { code, token, hostId, clients: Map<sid, {socketId, clientId}>, hostGoneTimer }
const rooms = new Map();
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newCode() { let c; do { c = Array.from(crypto.randomBytes(4), (b) => ALPHABET[b % ALPHABET.length]).join(''); } while (rooms.has(c)); return c; }
function closeRoom(room) { for (const c of room.clients.values()) io.to(c.socketId).emit('c:hostgone', { closed: true }); rooms.delete(room.code); }

io.on('connection', (socket) => {
  // La pantalla crea una sala (o la recupera tras reconectar con su token).
  socket.on('h:create', (msg, ack) => {
    if (typeof ack !== 'function') return;
    msg = msg || {};
    const wanted = String(msg.room || '').toUpperCase();
    let room = rooms.get(wanted);
    if (room && room.token === msg.token) {
      clearTimeout(room.hostGoneTimer); room.hostGoneTimer = null;
      room.hostId = socket.id;
    } else {
      // Tras un reinicio del servidor la sala ya no existe: devolvemos el mismo
      // código (si está libre) para que los celulares que reintentan entren solos.
      const code = /^[A-Z0-9]{4}$/.test(wanted) && !rooms.has(wanted) && !msg.fresh ? wanted : newCode();
      room = { code, token: crypto.randomBytes(16).toString('hex'), hostId: socket.id, clients: new Map(), hostGoneTimer: null };
      rooms.set(code, room);
    }
    socket.data.role = 'host'; socket.data.room = room.code;
    ack({ ok: true, room: room.code, token: room.token });
    // Los celulares que siguieron conectados se vuelven a anunciar.
    for (const [sid, c] of room.clients) { socket.emit('h:open', { sid }); io.to(c.socketId).emit('c:rejoin'); }
    console.log(`[sala ${room.code}] pantalla conectada (${room.clients.size} celulares)`);
  });

  // Un celular entra a una sala.
  socket.on('c:join', (msg, ack) => {
    if (typeof ack !== 'function') return;
    const room = rooms.get(String((msg && msg.room) || '').toUpperCase().trim());
    if (!room) return ack({ ok: false, error: 'no-room' });
    const clientId = String((msg && msg.clientId) || '').slice(0, 60);
    const returning = [...room.clients.values()].some((c) => clientId && c.clientId === clientId);
    if (!room.clients.has(socket.id) && !returning && room.clients.size >= MAX_PLAYERS) return ack({ ok: false, error: 'full' });
    // Si el mismo celular vuelve con otra conexión, la vieja se reemplaza.
    for (const [sid, c] of room.clients) {
      if (clientId && c.clientId === clientId && sid !== socket.id) {
        room.clients.delete(sid);
        io.to(room.hostId).emit('h:close', { sid, replaced: true });
        const old = io.sockets.sockets.get(c.socketId); if (old) old.disconnect(true);
      }
    }
    room.clients.set(socket.id, { socketId: socket.id, clientId });
    socket.data.role = 'client'; socket.data.room = room.code;
    ack({ ok: true, hostOnline: !room.hostGoneTimer });
    if (!room.hostGoneTimer) io.to(room.hostId).emit('h:open', { sid: socket.id });
  });

  // Datos: celular → pantalla y pantalla → un celular / todos.
  socket.on('c:d', (d) => {
    const room = rooms.get(socket.data.room);
    if (!room || socket.data.role !== 'client' || room.hostGoneTimer || !room.clients.has(socket.id)) return;
    io.to(room.hostId).emit('h:d', { sid: socket.id, d });
  });
  socket.on('h:d', (msg) => {
    const room = rooms.get(socket.data.room);
    if (!room || room.hostId !== socket.id || !msg || !room.clients.has(msg.sid)) return;
    io.to(msg.sid).emit('c:d', msg.d);
  });
  socket.on('h:kick', (msg) => {
    const room = rooms.get(socket.data.room);
    if (!room || room.hostId !== socket.id || !msg) return;
    const c = room.clients.get(msg.sid);
    if (c) { room.clients.delete(msg.sid); const s = io.sockets.sockets.get(c.socketId); if (s) setTimeout(() => s.disconnect(true), 300); }
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.room);
    if (!room) return;
    if (socket.data.role === 'client' && room.clients.get(socket.id)) {
      room.clients.delete(socket.id);
      io.to(room.hostId).emit('h:close', { sid: socket.id });
    } else if (socket.data.role === 'host' && room.hostId === socket.id) {
      for (const c of room.clients.values()) io.to(c.socketId).emit('c:hostgone', { closed: false });
      room.hostGoneTimer = setTimeout(() => closeRoom(room), HOST_GRACE_MS);
      console.log(`[sala ${room.code}] pantalla desconectada — esperando ${HOST_GRACE_MS / 1000}s`);
    }
  });
});

server.listen(PORT, () => console.log(`Gato Swing en :${PORT}`));
