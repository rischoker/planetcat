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
// ---- Ranking global (Supabase) ---------------------------------------------
// La pantalla y los celulares SOLO hablan con este servidor (mismo dominio de
// Render): el proxy de la academia no necesita dejar pasar supabase.co.
const SB_URL = process.env.SUPABASE_URL || 'https://vjbcqhkfvctzwecmzcqa.supabase.co';
const SB_KEY = process.env.SUPABASE_KEY || 'sb_publishable_mJlZ7Ym9LXAhTkWncksX6A_Czg0mbv6'; // clave pública (RLS protege la tabla)
const SB_TABLE = 'gato_swing_scores';
const DIFFS = ['facil', 'normal', 'dificil'];
const topCache = new Map();   // song|diff -> { t, rows }
const postLimit = new Map();  // ip -> [tiempos]

async function sb(pathAndQuery, opts = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 7000);
  try {
    const r = await fetch(SB_URL + '/rest/v1/' + pathAndQuery, {
      method: opts.method || 'GET', signal: ctl.signal,
      headers: Object.assign({ apikey: SB_KEY, 'Content-Type': 'application/json' }, opts.headers || {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!r.ok) throw new Error('supabase ' + r.status + ' ' + (await r.text()).slice(0, 200));
    return r;
  } finally { clearTimeout(timer); }
}
const cleanText = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
const int = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));

async function top(song, diff) {
  const key = song + '|' + diff;
  const c = topCache.get(key);
  if (c && Date.now() - c.t < 20000) return c.rows;
  const q = `${SB_TABLE}?select=name,char,points,max_combo,perfects,survived,created_at&song=eq.${encodeURIComponent(song)}&difficulty=eq.${diff}&order=points.desc&limit=10`;
  const rows = await (await sb(q)).json();
  topCache.set(key, { t: Date.now(), rows });
  return rows;
}
async function rankOf(song, diff, points) {
  const q = `${SB_TABLE}?select=id&song=eq.${encodeURIComponent(song)}&difficulty=eq.${diff}&points=gt.${points}`;
  const r = await sb(q, { headers: { Prefer: 'count=exact', Range: '0-0' } });
  const cr = r.headers.get('content-range') || '';   // "0-0/123" o "*/0"
  const n = parseInt(cr.split('/')[1], 10);
  return (isNaN(n) ? 0 : n) + 1;
}

app.get('/api/scores', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const song = cleanText(req.query.song, 60), diff = DIFFS.includes(req.query.difficulty) ? req.query.difficulty : 'normal';
  if (!song) return res.status(400).json({ ok: false });
  try { res.json({ ok: true, rows: await top(song, diff) }); }
  catch (e) { console.warn('[ranking] lectura', e.message); res.json({ ok: false, rows: [] }); }
});

app.post('/api/scores', express.json({ limit: '32kb' }), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const now = Date.now();
  const hits = (postLimit.get(ip) || []).filter((t) => now - t < 60000);
  if (hits.length >= 6) return res.status(429).json({ ok: false, error: 'muy seguido' });
  hits.push(now); postLimit.set(ip, hits);
  const b = req.body || {};
  const song = cleanText(b.song, 60), diff = DIFFS.includes(b.difficulty) ? b.difficulty : 'normal';
  const players = Array.isArray(b.players) ? b.players.slice(0, 32) : [];
  const rows = players.map((p) => ({
    name: cleanText(p.name, 16) || 'Gato', char: cleanText(p.char, 30) || null,
    song, song_title: cleanText(b.songTitle, 80) || song, difficulty: diff,
    points: int(p.points, 0, 2000000), max_combo: int(p.maxCombo, 0, 5000), perfects: int(p.perfects, 0, 5000),
    lives_left: int(p.livesLeft, 0, 3), survived: !!p.survived,
  })).filter((r) => r.points > 0);
  if (!song || !rows.length) return res.json({ ok: true, ranks: [] });
  try {
    await sb(SB_TABLE, { method: 'POST', body: rows, headers: { Prefer: 'return=minimal' } });
    topCache.delete(song + '|' + diff);
    const ranks = await Promise.all(rows.map((r) => rankOf(song, diff, r.points).catch(() => null)));
    const best = await top(song, diff).catch(() => []);
    res.json({ ok: true, ranks: rows.map((r, i) => ({ name: r.name, points: r.points, rank: ranks[i] })), top: best });
  } catch (e) { console.warn('[ranking] guardar', e.message); res.json({ ok: false, ranks: [] }); }
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
