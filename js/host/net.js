// =====================================================================
//  Red del host (pantalla). PeerJS + TURN + BroadcastChannel local.
//  Diseñado para redes difíciles:
//   - Reconexión automática al servidor de señalización (peer.reconnect)
//     y recreación del Peer si se destruye, conservando el código de sala.
//   - Cada celular tiene una clave persistente: si se reconecta recupera
//     su personaje, nombre y estado.
//   - Latidos (ping/pong) cada segundo: mide RTT y sincroniza relojes
//     para compensar el lag en los saltos.
//   - Serialización JSON (evita problemas de binarypack en Safari/Android viejos).
// =====================================================================
const CFG = window.GATO_CONFIG || {};
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function newRoomCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

export async function getIceServers() {
  const list = (CFG.iceServers || []).slice();
  const m = CFG.meteredTurn || {};
  if (m.appName && m.apiKey) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 3500);
      const r = await fetch(`https://${m.appName}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(m.apiKey)}`, { signal: ctrl.signal });
      clearTimeout(to);
      if (r.ok) { const extra = await r.json(); if (Array.isArray(extra)) list.push(...extra); }
    } catch (e) { console.warn('Metered TURN no disponible', e); }
  }
  return list;
}

/** Prueba qué tipos de candidatos ICE se pueden obtener (diagnóstico de red). */
export function probeIce(iceServers, timeout = 6000) {
  return new Promise((resolve) => {
    const res = { host: false, srflx: false, relay: false, error: null };
    let pc;
    try { pc = new RTCPeerConnection({ iceServers }); } catch (e) { res.error = 'Sin WebRTC'; return resolve(res); }
    const finish = () => { try { pc.close(); } catch (e) {} resolve(res); };
    const timer = setTimeout(finish, timeout);
    pc.onicecandidate = (e) => {
      if (!e.candidate) { clearTimeout(timer); finish(); return; }
      const c = e.candidate.candidate || '';
      if (/ typ host/.test(c)) res.host = true;
      if (/ typ srflx/.test(c)) res.srflx = true;
      if (/ typ relay/.test(c)) res.relay = true;
    };
    try {
      pc.createDataChannel('probe');
      pc.createOffer().then((o) => pc.setLocalDescription(o)).catch((e) => { res.error = String(e); clearTimeout(timer); finish(); });
    } catch (e) { res.error = String(e); clearTimeout(timer); finish(); }
  });
}

export class HostNet {
  /**
   * h.onJoin(key, hello, via) -> objeto WELCOME a enviar
   * h.onMessage(key, msg)
   * h.onLeave(key, reason)
   * h.onStatus({level:'ok'|'warn'|'bad', text})
   */
  constructor(h) {
    this.h = h;
    this.clients = new Map(); // key -> {conn, bc, lastSeen, rtt, offset, samples}
    this.peer = null;
    this.code = null;
    this.iceServers = [];
    this.destroyed = false;
    this.retry = 0;
    this.idTaken = 0;
    this.bc = null;
  }

  log(...a) { console.log('[net]', ...a); }
  status(level, text) { this.statusNow = { level, text }; this.h.onStatus && this.h.onStatus(this.statusNow); }

  async start(preferredCode) {
    let code = preferredCode;
    try { code = code || sessionStorage.getItem('gatoswing-room'); } catch (e) {}
    this.code = (code && /^[A-Z0-9]{4}$/.test(code)) ? code : newRoomCode();
    try { sessionStorage.setItem('gatoswing-room', this.code); } catch (e) {}
    this.iceServers = await getIceServers();
    this.openLocalChannel();
    this.createPeer();
    clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => this.heartbeat(), 1000);
    window.addEventListener('online', () => this.ensurePeer('online'));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.ensurePeer('visible'); });
    return this.code;
  }

  peerId() { return (CFG.roomPrefix || 'gatoswing-v1-') + this.code.toLowerCase(); }

  createPeer() {
    if (this.peer) { try { this.peer.destroy(); } catch (e) {} }
    if (typeof Peer === 'undefined') { this.status('bad', 'PeerJS no cargó · solo modo local'); return; }
    this.status('warn', 'Conectando al servidor…');
    const opts = Object.assign({ debug: 1, config: { iceServers: this.iceServers, sdpSemantics: 'unified-plan' } }, CFG.peer || {});
    const peer = new Peer(this.peerId(), opts);
    this.peer = peer;
    peer.on('open', () => {
      this.retry = 0; this.idTaken = 0;
      this.status('ok', 'En línea');
      this.log('peer abierto', peer.id);
    });
    peer.on('connection', (conn) => this.acceptConn(conn));
    peer.on('disconnected', () => {
      if (this.peer !== peer || this.destroyed) return;
      this.status('warn', 'Reconectando al servidor…');
      this.scheduleReconnect();
    });
    peer.on('close', () => { if (this.peer === peer && !this.destroyed) this.scheduleRecreate(); });
    peer.on('error', (err) => {
      const type = err && err.type;
      this.log('error peer', type, err && err.message);
      if (this.peer !== peer) return;
      if (type === 'unavailable-id') {
        // Normalmente pasa al recargar la página: el servidor aún tiene la sala vieja
        this.idTaken++;
        if (this.idTaken > 4) {
          this.code = newRoomCode();
          try { sessionStorage.setItem('gatoswing-room', this.code); } catch (e) {}
          this.h.onRoomChange && this.h.onRoomChange(this.code);
          this.idTaken = 0;
        }
        this.status('warn', 'Liberando la sala… reintento');
        this.scheduleRecreate(2500);
      } else if (type === 'browser-incompatible') {
        this.status('bad', 'Este navegador no soporta WebRTC');
      } else if (['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected'].includes(type)) {
        this.status('warn', 'Sin servidor · reintentando');
        this.scheduleReconnect();
      }
    });
  }

  scheduleReconnect() {
    clearTimeout(this.rTimer);
    const wait = Math.min(8000, 800 * Math.pow(1.6, this.retry++));
    this.rTimer = setTimeout(() => {
      this.rTimer = null;
      if (!this.peer || this.peer.destroyed) return this.createPeer();
      if (this.peer.disconnected) { try { this.peer.reconnect(); } catch (e) { this.createPeer(); } }
      // si tras 3 intentos sigue mal, recrea el Peer entero
      if (this.retry > 3 && this.peer.disconnected) this.createPeer();
    }, wait);
  }
  scheduleRecreate(ms) {
    clearTimeout(this.rTimer);
    this.rTimer = setTimeout(() => { this.rTimer = null; this.createPeer(); }, ms || Math.min(8000, 1000 * Math.pow(1.5, this.retry++)));
  }
  ensurePeer(why) {
    if (!this.peer || this.peer.destroyed) this.createPeer();
    else if (this.peer.disconnected) { this.retry = 0; this.scheduleReconnect(); }
  }

  newRoom() {
    this.code = newRoomCode();
    try { sessionStorage.setItem('gatoswing-room', this.code); } catch (e) {}
    this.clients.forEach((c, k) => { if (c.conn) try { c.conn.close(); } catch (e) {} });
    this.openLocalChannel();
    this.createPeer();
    return this.code;
  }

  // ------------------------------------------------------------ P2P
  acceptConn(conn) {
    let key = conn.metadata && conn.metadata.k;
    let helloTimer = setTimeout(() => { if (!key || !this.clients.has(key) || this.clients.get(key).conn !== conn) { try { conn.close(); } catch (e) {} } }, 10000);
    conn.on('data', (raw) => {
      let msg = raw;
      if (typeof raw === 'string') { try { msg = JSON.parse(raw); } catch (e) { return; } }
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'hello') {
        key = String(msg.k || conn.peer).slice(0, 40);
        clearTimeout(helloTimer);
        this.bind(key, { conn }, msg, 'p2p');
        return;
      }
      if (!key) return;
      const c = this.clients.get(key);
      if (!c || c.conn !== conn) return;
      this.onData(key, c, msg);
    });
    conn.on('close', () => {
      const c = key && this.clients.get(key);
      if (c && c.conn === conn) { c.conn = null; this.h.onLeave(key, 'close'); }
    });
    conn.on('error', (e) => this.log('conn error', e && e.type));
  }

  bind(key, transport, hello, via) {
    let c = this.clients.get(key);
    if (c && c.conn && transport.conn && c.conn !== transport.conn) { try { c.conn.close(); } catch (e) {} }
    if (!c) { c = { samples: [], rtt: 0, offset: 0 }; this.clients.set(key, c); }
    c.conn = transport.conn || null;
    c.bc = !!transport.bc;
    c.lastSeen = performance.now();
    c.via = via;
    const welcome = this.h.onJoin(key, hello, via);
    if (welcome === false) { this.sendTo(c, key, { t: 'full' }); return; }
    this.sendTo(c, key, Object.assign({ t: 'welcome' }, welcome));
  }

  onData(key, c, msg) {
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
    if (msg.t === 'bye') { if (c.conn) try { c.conn.close(); } catch (e) {} this.h.onLeave(key, 'bye'); return; }
    this.h.onMessage(key, msg, c);
  }

  /** Convierte un tiempo del reloj del celular a performance.now() del host. */
  clientToHost(c, clientTime) { return clientTime + (c.offset || 0); }

  heartbeat() {
    const now = performance.now();
    const stale = (CFG.staleSeconds || 6) * 1000;
    this.clients.forEach((c, key) => {
      if (!c.conn && !c.bc) return;
      this.sendTo(c, key, { t: 'ping', h: now });
      if (!c.stale && now - c.lastSeen > stale) {
        c.stale = true;
        this.log('cliente sin latido', key);
        if (c.conn) { try { c.conn.close(); } catch (e) {} c.conn = null; }
        this.h.onLeave(key, 'timeout');
      }
    });
    if (this.peer && this.peer.disconnected && !this.peer.destroyed && !this.rTimer) this.scheduleReconnect();
  }

  sendTo(c, key, msg) {
    try {
      if (c.conn && c.conn.open) c.conn.send(msg);
      else if (c.bc && this.bc) this.bc.postMessage({ to: key, msg });
    } catch (e) { this.log('send fail', e); }
  }
  send(key, msg) { const c = this.clients.get(key); if (c) this.sendTo(c, key, msg); }
  broadcast(msg) { this.clients.forEach((c, k) => this.sendTo(c, k, msg)); }
  stats(key) { const c = this.clients.get(key); return c ? { rtt: Math.round(c.minRtt || c.rtt || 0), via: c.via, online: !!(c.conn && c.conn.open) || c.bc } : null; }

  kick(key) {
    const c = this.clients.get(key);
    if (!c) return;
    this.sendTo(c, key, { t: 'kicked' });
    setTimeout(() => { if (c.conn) try { c.conn.close(); } catch (e) {} }, 300);
    this.clients.delete(key);
  }
  forget(key) { this.clients.delete(key); }

  // ------------------------------------------------- canal local (misma PC)
  openLocalChannel() {
    if (this.bc) { try { this.bc.close(); } catch (e) {} this.bc = null; }
    if (typeof BroadcastChannel === 'undefined') return;
    try {
      this.bc = new BroadcastChannel('gatoswing-' + this.code);
      this.bc.onmessage = (e) => {
        const d = e.data || {};
        if (!d.from || !d.msg || d.to) return;
        const key = String(d.from);
        if (d.msg.t === 'hello') { this.bind(key, { bc: true }, d.msg, 'local'); return; }
        const c = this.clients.get(key);
        if (c && c.bc) this.onData(key, c, d.msg);
      };
    } catch (e) { this.bc = null; }
  }
}
