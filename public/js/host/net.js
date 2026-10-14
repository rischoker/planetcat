// =====================================================================
//  Red de la pantalla (host) — Socket.IO a través del servidor en Render.
//  Igual que Chicken Horde / Flappy Verbs / Castle Quest:
//   - Todo pasa por el MISMO dominio (el de Render): no hay WebRTC, ni
//     STUN/TURN, ni CDNs. Socket.IO empieza con HTTP long-polling y sube a
//     WebSocket si el proxy lo permite.
//   - Reconexión automática; la sala se recupera con su token tras recargar
//     la pantalla o tras un reinicio del servidor (mismo código).
//   - Cada celular tiene una clave persistente: si se reconecta recupera su
//     personaje, nombre y estado.
//   - Latidos (ping/pong) cada segundo: miden RTT y sincronizan relojes para
//     compensar el lag de los saltos.
// =====================================================================
const CFG = window.GATO_CONFIG || {};

export class HostNet {
  /**
   * h.onJoin(key, hello, via) -> objeto WELCOME a enviar (o false si la sala está llena)
   * h.onMessage(key, msg, client)
   * h.onLeave(key, reason)
   * h.onStatus({level:'ok'|'warn'|'bad', text})
   * h.onRoomChange(code)
   */
  constructor(h) {
    this.h = h;
    this.clients = new Map(); // key -> {sid, lastSeen, rtt, minRtt, offset, samples}
    this.sidKey = new Map();  // socket id del celular -> key
    this.code = null;
    this.token = null;
    this.socket = null;
  }

  log(...a) { console.log('[net]', ...a); }
  status(level, text) { this.statusNow = { level, text }; this.h.onStatus && this.h.onStatus(this.statusNow); }
  transport() { try { return this.socket.io.engine.transport.name; } catch (e) { return '?'; } }

  start() {
    try { this.code = sessionStorage.getItem('gatoswing-room'); this.token = sessionStorage.getItem('gatoswing-token'); } catch (e) {}
    if (typeof io === 'undefined') { this.status('bad', 'No cargó Socket.IO'); return Promise.resolve(null); }
    this.status('warn', 'Conectando al servidor…');
    const socket = io({
      transports: ['polling', 'websocket'], // polling primero: atraviesa proxies; sube a WebSocket si se puede
      reconnection: true, reconnectionDelay: 500, reconnectionDelayMax: 4000, timeout: 15000,
    });
    this.socket = socket;
    let firstResolve;
    const first = new Promise((r) => { firstResolve = r; });
    setTimeout(() => firstResolve(this.code), 9000); // no bloquear la carga si el servidor tarda (despertando)

    socket.on('connect', () => this.create(false, firstResolve));
    socket.on('disconnect', (reason) => { this.status('warn', 'Reconectando al servidor…'); this.log('desconectado', reason); });
    socket.on('connect_error', (e) => { this.status('warn', 'Sin servidor · reintentando'); this.log('connect_error', e && e.message); });
    socket.io.on('reconnect_attempt', (n) => this.status('warn', `Reconectando al servidor… (${n})`));
    socket.io.engine && socket.io.engine.on && socket.io.engine.on('upgrade', () => this.status('ok', 'En línea · ' + this.transport()));
    socket.on('h:open', () => { /* el celular se identifica con su 'hello' */ });
    socket.on('h:d', (m) => { if (m && m.sid && m.d) this.onData(m.sid, m.d); });
    socket.on('h:close', (m) => {
      const key = m && this.sidKey.get(m.sid);
      if (!key) return;
      this.sidKey.delete(m.sid);
      const c = this.clients.get(key);
      if (c && c.sid === m.sid) { c.sid = null; this.h.onLeave(key, m.replaced ? 'replaced' : 'close'); }
    });

    clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => this.heartbeat(), 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && !socket.connected) socket.connect(); });
    window.addEventListener('online', () => { if (!socket.connected) socket.connect(); });
    return first;
  }

  create(fresh, done) {
    this.socket.emit('h:create', { room: fresh ? null : this.code, token: fresh ? null : this.token, fresh: !!fresh }, (r) => {
      if (!r || !r.ok) { this.status('bad', 'El servidor rechazó la sala'); return; }
      const changed = r.room !== this.code;
      this.code = r.room; this.token = r.token;
      try { sessionStorage.setItem('gatoswing-room', this.code); sessionStorage.setItem('gatoswing-token', this.token); } catch (e) {}
      this.status('ok', 'En línea · ' + this.transport());
      if (changed && this.h.onRoomChange) this.h.onRoomChange(this.code);
      if (done) done(this.code);
    });
  }

  newRoom() {
    this.clients.forEach((c, k) => { if (c.sid) this.socket.emit('h:kick', { sid: c.sid }); });
    this.clients.clear(); this.sidKey.clear();
    if (this.socket && this.socket.connected) this.create(true);
    return this.code;
  }

  // ------------------------------------------------------------ mensajes
  onData(sid, msg) {
    if (typeof msg === 'string') { try { msg = JSON.parse(msg); } catch (e) { return; } }
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') {
      const key = String(msg.k || sid).slice(0, 40);
      let c = this.clients.get(key);
      if (!c) { c = { samples: [], rtt: 0, offset: 0, minRtt: 0 }; this.clients.set(key, c); }
      if (c.sid && c.sid !== sid) this.sidKey.delete(c.sid);
      c.sid = sid; c.lastSeen = performance.now(); c.stale = false; c.via = this.transport();
      this.sidKey.set(sid, key);
      const welcome = this.h.onJoin(key, msg, c.via);
      if (welcome === false) { this.sendTo(c, key, { t: 'full' }); return; }
      this.sendTo(c, key, Object.assign({ t: 'welcome' }, welcome));
      return;
    }
    const key = this.sidKey.get(sid);
    if (!key) { this.socket.emit('h:d', { sid, d: { t: 'rehello' } }); return; } // celular desconocido: que se presente
    const c = this.clients.get(key);
    if (!c) return;
    c.lastSeen = performance.now();
    if (c.stale) { c.stale = false; this.h.onJoin(key, { name: null, resume: true }, c.via); }
    if (msg.t === 'pong') {
      const now = performance.now();
      const rtt = now - msg.h;
      if (rtt >= 0 && rtt < 5000) {
        c.samples.push({ rtt, off: msg.h + rtt / 2 - msg.c });
        if (c.samples.length > 10) c.samples.shift();
        let best = c.samples[0];
        c.samples.forEach((s) => { if (s.rtt < best.rtt) best = s; });
        c.rtt = rtt * 0.3 + c.rtt * 0.7; c.offset = best.off; c.minRtt = best.rtt;
      }
      return;
    }
    if (msg.t === 'bye') { this.h.onLeave(key, 'bye'); return; }
    this.h.onMessage(key, msg, c);
  }

  heartbeat() {
    const now = performance.now();
    const stale = (CFG.staleSeconds || 6) * 1000;
    this.clients.forEach((c, key) => {
      if (!c.sid) return;
      this.sendTo(c, key, { t: 'ping', h: now });
      if (!c.stale && now - c.lastSeen > stale) {
        c.stale = true;
        this.log('celular sin latido', key);
        this.h.onLeave(key, 'timeout');
      }
    });
  }

  sendTo(c, key, msg) {
    if (!c || !c.sid || !this.socket || !this.socket.connected) return;
    this.socket.emit('h:d', { sid: c.sid, d: msg });
  }
  send(key, msg) { const c = this.clients.get(key); if (c) this.sendTo(c, key, msg); }
  broadcast(msg) { this.clients.forEach((c, k) => this.sendTo(c, k, msg)); }
  stats(key) { const c = this.clients.get(key); return c ? { rtt: Math.round(c.minRtt || c.rtt || 0), via: c.via, online: !!c.sid && !c.stale } : null; }
  clientToHost(c, clientTime) { return clientTime + (c.offset || 0); }

  kick(key) {
    const c = this.clients.get(key);
    if (!c) return;
    this.sendTo(c, key, { t: 'kicked' });
    if (c.sid) { this.socket.emit('h:kick', { sid: c.sid }); this.sidKey.delete(c.sid); }
    this.clients.delete(key);
  }
  forget(key) { const c = this.clients.get(key); if (c && c.sid) this.sidKey.delete(c.sid); this.clients.delete(key); }
}
