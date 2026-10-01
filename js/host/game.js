// =====================================================================
//  GATO SWING · Lógica del juego en el host
// =====================================================================
import * as THREE from 'three';
import { PHYS, hitTest, heightAt, landTime, makeTraj, reachOf, overRail } from './physics.js';
import { generateChart, dirAt, changeAt, playerSpacing, laneHits } from './chart.js';
import { CatWheel, PAL } from './cat.js';
import { CharacterActor, CHARACTERS, CHAR_HEIGHT } from './characters.js';
import { buildObstacleMesh, buildHitboxMesh, buildRailParts } from './obstacles3d.js';
import { FX } from './fx.js';

export const PLAYER_COLORS = ['#ff3b4e', '#22d3ee', '#a3e635', '#ff9f1c', '#e879f9', '#ffffff', '#fb7185', '#2dd4bf', '#facc15', '#a78bfa', '#4ade80', '#f97316'];

const R = PHYS.R, DEPTH = PHYS.DEPTH;

// Colores de fondo según la energía de cada sección (dos opciones por nivel)
export const BG_PALETTES = [
  ['#3e46c9', '#1f7f86'],   // tranquilo: azul / verde azulado
  ['#5a2ca0', '#3e46c9'],   // con ritmo: morado / azul
  ['#b8262f', '#8a1f9e'],   // intenso: rojo / magenta
  ['#d4541c', '#b8262f'],   // a tope: naranja / rojo
];

// Slang de breakdance / b-boys para los globos de los personajes
export const SLANG = ['¡COOL!', '¡SUPERFLY!', '¡FRESH!', '¡FUNKY!', '¡DOPE!', '¡SMOOTH!', '¡FLY!', '¡GROOVY!',
  '¡B-BOY!', '¡FREEZE!', '¡WINDMILL!', '¡HEADSPIN!', '¡BOOGIE!', '¡OLD SCHOOL!', '¡TOPROCK!', '¡POWER MOVE!', '¡ON BEAT!', '¡FLARE!'];
export const GRIND_SLANG = ['¡GRIND!', '¡SUPERFLY!', '¡SMOOTH!', '¡RADICAL!', '¡FLY!', '¡SICK!'];

/** Genera la partitura en un Worker (no congela la pantalla). */
function makeChartAsync(analysis, opts) {
  return new Promise((resolve) => {
    let w = null;
    try { w = new Worker(new URL('./chart-worker.js', import.meta.url), { type: 'module' }); } catch (e) { w = null; }
    const sync = () => setTimeout(() => resolve(generateChart(analysis, opts)), 20);
    if (!w) return sync();
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; w.terminate(); sync(); } }, 20000);
    w.onmessage = (e) => { if (done) return; done = true; clearTimeout(timer); w.terminate(); if (e.data && e.data.ok) resolve(e.data.chart); else sync(); };
    w.onerror = () => { if (done) return; done = true; clearTimeout(timer); w.terminate(); sync(); };
    w.postMessage({ an: analysis, opts });
  });
}
const tmpV = new THREE.Vector3();

function cleanName(n) {
  n = String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 14);
  return n || ('Gato ' + Math.floor(100 + Math.random() * 900));
}

export class Game {
  constructor({ bg, gl, fx, audio, templates, ui }) {
    this.audio = audio; this.templates = templates; this.ui = ui;
    this.bgCanvas = bg; this.bg = bg.getContext('2d');
    this.renderer = new THREE.WebGLRenderer({ canvas: gl, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8890c0, 1.7));
    const sun = new THREE.DirectionalLight(0xffffff, 2.3); sun.position.set(6, 14, 12); this.scene.add(sun);
    this.camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.5, 200);
    this.camLook = new THREE.Vector3(0, 12, 0); this.camPos = new THREE.Vector3(0, 22, 36);
    this.camTarget = { look: new THREE.Vector3(0, 12, 0), pos: new THREE.Vector3(0, 22, 36) };
    this.cat = new CatWheel(this.scene, R, DEPTH);
    this.fx = new FX(fx);
    this.obsLayer = new THREE.Group(); this.scene.add(this.obsLayer);
    this.playersLayer = new THREE.Group(); this.scene.add(this.playersLayer);

    this.players = new Map();
    this.state = 'lobby';
    this.difficulty = 'normal';
    this.analysis = null;
    this.chart = null;
    this.active = [];           // obstáculos vivos
    this.nextEv = 0;
    this.t = 0; this.simT = 0;
    this.revIdx = 0;
    this.showHitboxes = false;
    this.spinSpeed = 0.25;
    this.lobbyClock = 0;
    this.usedChars = [];
    this.colorIdx = 0;
    this.paused = false;
    this.endTimer = null;
    this.lastFrame = performance.now();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.setupKeyboard();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  // -------------------------------------------------------------- vista
  resize() {
    const W = window.innerWidth, H = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = W; this.H = H;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(W, H, false);
    this.bgCanvas.width = Math.round(W * dpr); this.bgCanvas.height = Math.round(H * dpr);
    this.bgDpr = dpr;
    this.fx.resize(W, H, dpr);
    this.camera.aspect = W / H;
    this.camera.updateProjectionMatrix();
    this.updateCamTargets();
  }
  updateCamTargets() {
    const aspect = this.W / this.H;
    // distancia para que quepan cabeza + brazos a lo ancho
    const halfW = R * 1.5;
    const dist = Math.max(R * 3.2, halfW / (Math.tan(THREE.MathUtils.degToRad(17)) * aspect));
    if (this.state === 'lobby' || this.state === 'loading') {
      this.camTarget.pos.set(0, R * 1.9, dist * 1.08); this.camTarget.look.set(0, R * 1.42, 0);
    } else {
      this.camTarget.pos.set(0, R * 2.15, dist); this.camTarget.look.set(0, R * 1.08, 0);
    }
  }
  project(x, y, z) {
    tmpV.set(x, y, z).project(this.camera);
    return { x: (tmpV.x * 0.5 + 0.5) * this.W, y: (-tmpV.y * 0.5 + 0.5) * this.H };
  }

  // ----------------------------------------------------------- jugadores
  pickChar() {
    const ids = CHARACTERS.map((c) => c.id).filter((id) => this.templates.has(id));
    const reserved = Object.keys(this.loadRoster()).filter((k) => !this.players.has(k)).map((k) => this.loadRoster()[k].charId);
    let free = ids.filter((id) => !this.usedChars.includes(id) && !reserved.includes(id));
    if (!free.length) free = ids.filter((id) => !this.usedChars.includes(id));
    if (!free.length) free = ids;
    const id = free[Math.floor(Math.random() * free.length)];
    this.usedChars.push(id);
    return id;
  }
  nextColor() {
    const used = new Set([...this.players.values()].map((p) => p.color));
    for (let i = 0; i < PLAYER_COLORS.length; i++) { const c = PLAYER_COLORS[(this.colorIdx + i) % PLAYER_COLORS.length]; if (!used.has(c)) { this.colorIdx++; return c; } }
    return PLAYER_COLORS[this.colorIdx++ % PLAYER_COLORS.length];
  }

  addPlayer(key, opts = {}) {
    let p = this.players.get(key);
    if (p) {
      p.connected = true;
      if (opts.name) { p.name = cleanName(opts.name); this.saveRoster(); }
      this.ui.refreshLobby();
      return p;
    }
    // si la pantalla se recargó, recupera el mismo personaje/color de este celular
    const saved = this.loadRoster()[key];
    let charId, color;
    const usedColors = new Set([...this.players.values()].map((q) => q.color));
    if (saved && this.templates.has(saved.charId) && !this.usedChars.includes(saved.charId)) { charId = saved.charId; this.usedChars.push(charId); }
    else charId = this.pickChar();
    if (saved && saved.color && !usedColors.has(saved.color)) color = saved.color; else color = this.nextColor();
    if (!opts.name && saved && saved.name) opts.name = saved.name;
    const actor = new CharacterActor(this.templates.get(charId), color);
    this.playersLayer.add(actor.group);
    p = {
      key, name: cleanName(opts.name), charId, color, actor,
      isBot: !!opts.bot, kb: opts.kb || 0, remote: !opts.bot && !opts.kb,
      connected: true, alive: true, waiting: this.state !== 'lobby',
      score: 0, combo: 0, maxCombo: 0, cleared: 0, perfects: 0, place: 0,
      jump: null, landT: -99, buffered: false, pending: null, lastMeow: 0, lastT0: -99,
      laneName: 'front', holding: false, releaseT: -99, grind: null, prevFeet: 0, grindTime: 0, lastSlang: 0,
      lane: 0, s: (Math.random() - 0.5) * 6, walkTarget: 0, walkPause: Math.random() * 2,
      facingDir: Math.random() < 0.5 ? -1 : 1, ko: null, skill: 0.55 + Math.random() * 0.4,
      lastJumpReq: 0,
    };
    if (p.waiting) actor.group.visible = false;
    this.players.set(key, p);
    this.saveRoster();
    this.layoutLanes();
    this.ui.refreshLobby();
    if (p.waiting) this.ui.toast(`${p.name} entrará en la próxima función`);
    return p;
  }

  loadRoster() { try { return JSON.parse(sessionStorage.getItem('gatoswing-roster') || '{}'); } catch (e) { return {}; } }
  saveRoster(removedKey) {
    try {
      const r = this.loadRoster(); // fusiona: los que aún no vuelven tras recargar conservan su puesto
      if (removedKey) delete r[removedKey];
      this.players.forEach((p) => { if (p.remote) r[p.key] = { name: p.name, charId: p.charId, color: p.color }; });
      sessionStorage.setItem('gatoswing-roster', JSON.stringify(r));
    } catch (e) {}
  }

  removePlayer(key) {
    const p = this.players.get(key);
    if (!p) return;
    this.playersLayer.remove(p.actor.group);
    this.players.delete(key);
    const i = this.usedChars.indexOf(p.charId); if (i >= 0) this.usedChars.splice(i, 1);
    this.saveRoster(key);
    this.layoutLanes();
    this.ui.refreshLobby();
  }

  layoutLanes() {
    // lobby: profundidad escalonada para que se vean todos
    const list = [...this.players.values()].filter((p) => !p.waiting);
    list.forEach((p, i) => { p.lane = (i % 2 ? -0.7 : 0.7) * (DEPTH / 4.4); });
  }

  /**
   * Coloca a los jugadores en fila sobre la cabeza, separados por una
   * subdivisión musical (ver playerSpacing). Se llama al empezar y en cada
   * cambio de sentido (cuando no hay obstáculos cerca).
   */
  layoutPlay(t, instant) {
    const ch = changeAt(this.chart, t + 0.01);
    const list = [...this.players.values()].filter((p) => !p.waiting && p.alive);
    const n = list.length;
    const { spacing, sub } = playerSpacing(ch.v, this.chart.beatDur, n);
    this.spacingInfo = { spacing, sub };
    list.sort((a, b) => a.s - b.s);
    const lo = -Math.floor((n - 1) / 2);
    list.forEach((p, k) => {
      p.targetS = (lo + k) * spacing;
      // carriles alternados: adelante / atrás (los obstáculos de "medio carril" solo golpean uno)
      p.laneName = k % 2 ? 'back' : 'front';
      p.lane = (k % 2 ? -1 : 1) * DEPTH * 0.25;
      if (instant) p.s = p.targetS;
    });
  }

  addBot() {
    const names = ['Don Gato', 'Fígaro', 'Misifú', 'Garfio', 'Pelusa', 'Tom', 'Bigotes', 'Silvestre', 'Michín', 'Botitas'];
    const key = 'bot-' + Math.random().toString(36).slice(2, 7);
    const used = new Set([...this.players.values()].map((p) => p.name));
    const free = names.filter((n) => !used.has('🤖 ' + n));
    const pick = free.length ? free[Math.floor(Math.random() * free.length)] : names[Math.floor(Math.random() * names.length)] + ' ' + (this.players.size + 1);
    return this.addPlayer(key, { bot: true, name: '🤖 ' + pick });
  }
  addKeyboard(slot) {
    const key = 'kb-' + slot;
    if (this.players.has(key)) return;
    this.addPlayer(key, { kb: slot, name: slot === 1 ? 'Teclado 1' : 'Teclado 2' });
  }

  setupKeyboard() {
    window.addEventListener('keyup', (e) => {
      const k1 = this.players.get('kb-1'), k2 = this.players.get('kb-2');
      if ((e.code === 'Space' || e.code === 'KeyW') && k1) this.release(k1);
      if ((e.code === 'ArrowUp' || e.code === 'Enter') && k2) this.release(k2);
    });
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.repeat) return;
      const k1 = this.players.get('kb-1'), k2 = this.players.get('kb-2');
      if (e.code === 'Space' || e.code === 'KeyW') { e.preventDefault(); if (k1) this.jump(k1, this.nowSong()); }
      if (e.code === 'ArrowUp' || e.code === 'Enter' && this.state === 'playing') { if (k2) { e.preventDefault(); this.jump(k2, this.nowSong()); } }
      if (e.code === 'KeyM' && k1) this.meow(k1);
      if (e.code === 'KeyN' && k2) this.meow(k2);
      if (e.code === 'KeyH') { this.showHitboxes = !this.showHitboxes; this.ui.toast(this.showHitboxes ? 'Hitboxes visibles (H)' : 'Hitboxes ocultas'); }
      if ((e.code === 'Escape' || e.code === 'KeyP') && this.state === 'playing') this.togglePause();
    });
  }

  // --------------------------------------------------------------- tiempo
  nowSong() {
    if (this.state === 'playing') return this.audio.songTime();
    return this.lobbyClock;
  }
  beatInfo(t) {
    if (this.chart && this.state === 'playing') {
      const b = this.chart.beats;
      let lo = 0, hi = b.length - 1;
      if (t < b[0]) { const bd = this.chart.beatDur; const k = Math.floor((t - b[0]) / bd); return { index: k, phase: ((t - b[0]) / bd) - k }; }
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (b[m] <= t) lo = m; else hi = m - 1; }
      const next = b[lo + 1] || (b[lo] + this.chart.beatDur);
      return { index: lo - (this.chart.downbeatPhase || 0), phase: Math.min(1, (t - b[lo]) / (next - b[lo])) };
    }
    const bd = 60 / 104; const k = Math.floor(t / bd);
    return { index: k, phase: t / bd - k };
  }

  // ---------------------------------------------------------------- input
  /**
   * tPress = tiempo de canción en que el jugador presionó (compensado por lag).
   * Primer toque = salto; segundo toque en el aire = DOBLE SALTO.
   */
  jump(p, tPress) {
    if (!p || p.waiting) return;
    const now = this.nowSong();
    // anti-spam con reloj real (NO con el reloj de la canción: el del lobby
    // es distinto y bloqueaba todos los saltos al empezar la partida)
    const real = performance.now();
    if (real - p.lastJumpReq < 50) return;
    p.lastJumpReq = real;
    if (this.state === 'playing') { if (!p.alive) return; tPress = Math.min(now, tPress); }
    else tPress = now; // lobby: salto de prueba (también con doble salto)
    p.holding = true;
    if (p.grind) return; // patinando: presionar = seguir agarrado a la baranda
    const J = p.jump;
    if (!J) {
      const t0 = Math.max(tPress, p.landT);
      p.jump = { segs: makeTraj(t0, null), dj: false };
      p.lastT0 = t0;
      p.actor.kick(-3);
      this.audio.jump();
      if (p.pending) this.recheckPending(p);
    } else if (!J.dj && tPress < landTime(J.segs)) {
      const tt = Math.max(tPress, J.segs[0].t + PHYS.DJ_MIN);
      const h = heightAt(J.segs, tt);
      if (h > 0.02) {
        J.segs.push({ t: tt, h, v: PHYS.DJ_V });
        J.dj = true;
        p.actor.kick(-2);
        this.audio.doubleJump();
        if (p.pending) this.recheckPending(p);
      }
    } else if (J.dj && landTime(J.segs) - tPress < PHYS.JUMP_BUFFER) {
      p.buffered = true;
    }
  }

  /** Soltó el botón (para las barandas hay que mantener presionado). */
  release(p) {
    if (!p) return;
    p.holding = false;
    p.releaseT = this.nowSong();
  }

  meow(p) {
    const now = performance.now();
    if (!p || now - p.lastMeow < 1000) return;
    p.lastMeow = now;
    this.cat.meow(0.9);
    this.audio.meow();
    this.fx.bubble(p.key, '¡MIAU!');
  }

  remoteInput(p, msg, client, hostNowMs) {
    if (msg.t === 'jump') {
      let delay = 0;
      if (client && typeof msg.c === 'number' && client.samples && client.samples.length) {
        const pressHost = msg.c + client.offset;
        delay = (hostNowMs - pressHost) / 1000;
        const cap = Math.min(0.2, ((client.minRtt || client.rtt || 0) / 2000) + 0.05);
        delay = Math.max(0, Math.min(cap, delay));
      }
      p.lagGrace = Math.max(0.05, Math.min(0.2, ((client && (client.minRtt || client.rtt)) || 60) / 2000 + 0.06));
      this.jump(p, this.nowSong() - delay);
    } else if (msg.t === 'up') this.release(p);
    else if (msg.t === 'meow') this.meow(p);
    else if (msg.t === 'name' && this.state === 'lobby') { p.name = cleanName(msg.name); this.saveRoster(); this.ui.refreshLobby(); }
  }

  // --------------------------------------------------------------- partida
  async setSong(buffer, name, onProgress) {
    this.audio.song = buffer;
    this.audio.songName = name;
    this.analysis = await this.audio.analyze(buffer, onProgress);
    this.chart = null;
    return this.analysis;
  }

  startMatch() {
    if (!this.analysis || this.state !== 'lobby') return false;
    if (![...this.players.values()].length) this.addBot();
    this.audio.unlock();
    this.players.forEach((p) => {
      p.waiting = false; p.alive = true; p.score = 0; p.combo = 0; p.maxCombo = 0; p.cleared = 0; p.perfects = 0; p.place = 0;
      p.jump = null; p.landT = -99; p.buffered = false; p.pending = null; p.ko = null; p.elimT = null; p.lastJumpReq = 0;
      p.lastT0 = -99; p.handled = null; p.botPlan = null; p.judged = new Map();
      p.grind = null; p.holding = !!p.isBot; p.releaseT = -99; p.prevFeet = 0; p.grindTime = 0; p.lastSlang = 0;
      p.actor.group.visible = true; p.actor.bodyPivot.rotation.set(0, 0, 0); p.actor.facing.rotation.x = 0; p.actor.group.scale.setScalar(1);
    });
    this.layoutLanes();
    this.chart = null;
    const chartReady = makeChartAsync(this.analysis, { difficulty: this.difficulty, seed: (Math.random() * 1e9) | 0 });
    this.clearObstacles();
    this.nextEv = 0; this.simT = -0.5; this.warned = new Set();
    this.emo = { recent: [], kos: [], joyUntil: 0, surpriseUntil: 0, angryUntil: 0, current: 'idle' };
    this.startCount = this.players.size;
    this.state = 'countdown';
    this.ui.onState('preparing');
    this.fx.startIris('close', 0.55, 0.5, 0.62, async () => {
      const t0 = performance.now();
      if (!this.chartIsReady) this.ui.preparing(true);
      this.chart = await chartReady;
      this.ui.preparing(false);
      if (this.state !== 'countdown') return; // canceló mientras tanto
      this.layoutPlay(0, true);
      this.prewarm();
      this.updateCamTargets();
      this.camPos.copy(this.camTarget.pos); this.camLook.copy(this.camTarget.look);
      const d0 = dirAt(this.chart, 0);
      this.players.forEach((p) => p.actor.faceTowards(-d0, 0, true));
      this.ui.onState('countdown');
      this.fx.startIris('open', 0.6, 0.5, 0.5);
      this.ui.countdown(() => {
        if (this.state !== 'countdown') return;
        this.state = 'playing';
        this.audio.playSong(0, 0.06);
        this.simT = this.audio.songTime();
        this.ui.onState('playing');
      });
      console.log('partitura lista en', Math.round(performance.now() - t0), 'ms ·', this.chart.events.length, 'obstáculos');
    });
    this.updateCamTargets();
    return true;
  }

  /**
   * Pre-compila los shaders de todos los tipos de obstáculo (y la baranda)
   * durante la cuenta regresiva, para que el primero de cada tipo no dé un
   * "tirón" en PCs modestos.
   */
  prewarm() {
    if (this.warmed) return;
    try {
      const g = new THREE.Group();
      const seen = new Set();
      for (const ev of this.chart.events) {
        if (seen.has(ev.kind)) continue;
        seen.add(ev.kind);
        if (ev.kind === 'rail') buildRailParts(ev, DEPTH - 0.15, PHYS).forEach((pt) => g.add(pt.mesh));
        else g.add(buildObstacleMesh(ev, DEPTH - 0.15));
      }
      g.position.set(0, R + 1, 0);
      this.scene.add(g);
      this.renderer.compile(this.scene, this.camera);
      this.renderer.render(this.scene, this.camera);
      this.scene.remove(g);
      this.warmed = seen.size >= 9;
    } catch (e) { console.warn('prewarm', e); }
  }

  clearObstacles() {
    this.active.forEach((o) => this.obsLayer.remove(o.mesh));
    this.active = [];
  }

  togglePause() {
    if (this.state !== 'playing') return;
    this.paused = !this.paused;
    if (this.paused) { this.audio.ctx.suspend(); } else { this.audio.ctx.resume(); }
    this.ui.pause(this.paused);
  }

  backToLobby() {
    this.audio.stopSong();
    if (this.paused) { this.paused = false; this.audio.ctx.resume(); this.ui.pause(false); }
    clearTimeout(this.endTimer);
    this.state = 'lobby';
    this.clearObstacles();
    this.players.forEach((p) => {
      p.waiting = false; p.alive = true; p.ko = null; p.jump = null; p.pending = null; p.landT = -99;
      p.actor.group.visible = true; p.actor.bodyPivot.rotation.set(0, 0, 0); p.actor.facing.rotation.x = 0; p.actor.group.scale.setScalar(1);
      p.s = (Math.random() - 0.5) * 6;
    });
    this.layoutLanes();
    this.updateCamTargets();
    this.cat.setMood('idle', 0);
    this.ui.onState('lobby');
  }

  // --------------------------------------------------------- simulación
  obstacleS(ev, t) { return -ev.dir * ev.v * (ev.tArr - t); }

  spawnObstacles(t) {
    const ch = this.chart;
    while (this.nextEv < ch.events.length && ch.events[this.nextEv].tSpawn - 0.2 <= t) {
      const ev = ch.events[this.nextEv++];
      if (ev.kind === 'rail') {
        const holder = new THREE.Group();
        const parts = buildRailParts(ev, DEPTH - 0.15, PHYS);
        parts.forEach((pt) => { holder.add(pt.mesh); pt.mesh.visible = false; pt.born = null; });
        this.obsLayer.add(holder);
        this.active.push({ ev, mesh: holder, parts, passed: false, passedBy: new Set(), reach: reachOf(ev.prims), born: t, hb: this.showHitboxes, rail: true });
        this.cat.tossPaw(-ev.dir);
        this.audio.spring();
        this.ui.railHint();
        continue;
      }
      // medio carril: la mitad de la profundidad, adelante (+z) o atrás (-z)
      const half = ev.lane !== 'all';
      const depthUse = half ? DEPTH / 2 - 0.12 : DEPTH - 0.15;
      const mesh = buildObstacleMesh(ev, depthUse);
      const zOff = half ? (ev.lane === 'front' ? 1 : -1) * DEPTH / 4 : 0;
      mesh.position.z = zOff;
      const holder = new THREE.Group(); holder.add(mesh);
      holder.userData.zOff = zOff; holder.userData.depth = half ? DEPTH / 2 : DEPTH;
      if (this.showHitboxes) holder.add(this.hitboxFor(ev, holder));
      this.obsLayer.add(holder);
      this.active.push({ ev, mesh: holder, inner: mesh, passed: false, passedBy: new Set(), reach: reachOf(ev.prims), born: t, hb: this.showHitboxes });
      this.cat.tossPaw(-ev.dir);
      this.audio.spring();
    }
  }

  hitboxFor(ev, holder) {
    const hb = buildHitboxMesh(ev.prims, holder.userData.depth);
    hb.position.z = holder.userData.zOff;
    return hb;
  }

  stepPhysics(t) {
    // pasos fijos desde simT hasta t
    let steps = 0;
    while (this.simT + PHYS.STEP <= t && steps < 400) {
      this.simT += PHYS.STEP; steps++;
      this.physicsAt(this.simT);
    }
    if (steps >= 400) this.simT = t;
  }

  feetAt(p, t) { return p.grind ? PHYS.RAIL_H : (p.jump ? heightAt(p.jump.segs, t) : 0); }

  physicsAt(t) {
    this.players.forEach((p) => {
      if (!p.alive || p.waiting) return;
      // aterrizaje
      if (p.jump && !p.grind && t >= landTime(p.jump.segs)) {
        p.landT = landTime(p.jump.segs);
        p.jump = null;
        p.actor.kick(-2.2);
        if (p.buffered) { p.buffered = false; p.jump = { segs: makeTraj(p.landT, null), dj: false }; p.lastT0 = p.landT; p.actor.kick(-3); this.audio.jump(); }
      }
      if (p.isBot) this.botThink(p, t);
      // ---- patinando sobre una baranda
      if (p.grind) {
        const g = p.grind;
        const rel = this.obstacleS(g.ev, t) - p.s;
        p.grindTime += PHYS.STEP;
        if (!overRail(rel, g.ev.railL, g.ev.dir)) {
          // fin de la baranda: saltito automático con voltereta
          p.grind = null;
          p.jump = { segs: [{ t, h: PHYS.RAIL_H, v: PHYS.POP_V }], dj: false, pop: true };
          this.onGrindEnd(p, g, t);
        } else if (!p.holding && t - Math.max(p.releaseT, g.t) > PHYS.SLIP_GRACE) {
          // soltó el botón: se resbala y cae
          p.grind = null;
          p.jump = { segs: [{ t, h: PHYS.RAIL_H, v: 0.5 }], dj: false, slip: true };
          this.fx.popup('¡RESBALÓN!', p.actor.group.position.clone().setY(p.actor.group.position.y + CHAR_HEIGHT), '#ff8fa0', 0.8);
          this.ui.sendTo(p, { t: 'hint', text: '¡Mantén presionado para patinar!' });
        }
      }
      // colisiones (posición relativa al jugador)
      let feet = this.feetAt(p, t);
      // ---- aterrizar sobre una baranda (bajando, cruzando su altura, encima de ella)
      if (!p.grind && p.jump && feet < PHYS.RAIL_H && p.prevFeet >= PHYS.RAIL_H) {
        for (const o of this.active) {
          if (o.ev.kind !== 'rail') continue;
          if (overRail(this.obstacleS(o.ev, t) - p.s, o.ev.railL, o.ev.dir)) {
            p.grind = { ev: o.ev, o, t }; p.jump = null; p.grindTime = 0; feet = PHYS.RAIL_H;
            p.actor.kick(-2.5);
            this.audio.grindStart();
            break;
          }
        }
      }
      p.prevFeet = feet;
      let hitObs = null;
      for (const o of this.active) {
        if (!laneHits(o.ev.lane, p.laneName)) continue;
        const rel = this.obstacleS(o.ev, t) - p.s;
        if (Math.abs(rel) > 3.2) continue;
        if (hitTest(rel, feet, o.ev.prims)) { hitObs = o; break; }
      }
      if (hitObs) {
        if (p.remote && p.connected) { if (!p.pending) p.pending = { t, grace: p.lagGrace || 0.08, o: hitObs }; }
        else this.eliminate(p, hitObs, t);
      }
      if (p.pending && t - p.pending.t > p.pending.grace) this.eliminate(p, p.pending.o, t);
      // obstáculos que ya me pasaron → puntaje
      for (const o of this.active) {
        if (o.passedBy.has(p.key)) continue;
        const rel = this.obstacleS(o.ev, t) - p.s;
        if (rel * o.ev.dir > o.reach) { o.passedBy.add(p.key); if (!p.pending && laneHits(o.ev.lane, p.laneName)) this.scoreObstacle(o.ev, p); }
      }
    });
  }

  recheckPending(p) {
    // ¿con el salto compensado por lag, de verdad chocó? Re-simula desde el choque hasta ahora.
    const from = p.pending.t, to = this.simT;
    for (let t = from; t <= to + 1e-9; t += PHYS.STEP) {
      const feet = this.feetAt(p, t);
      for (const o of this.active) {
        if (!laneHits(o.ev.lane, p.laneName)) continue;
        const rel = this.obstacleS(o.ev, t) - p.s;
        if (Math.abs(rel) < 3.2 && hitTest(rel, feet, o.ev.prims)) return; // sigue chocando: se mantiene el choque
      }
    }
    p.pending = null;
  }

  /** Bots: siguen el plan del grupo (salto + doble salto) con un error humano. */
  botThink(p, t) {
    const ch = this.chart;
    if (!p.handled) p.handled = new Set();
    if (p.botPlan && p.botPlan.t1 !== null && p.jump && !p.jump.dj && t >= p.botPlan.t1) { this.jump(p, t); p.botPlan.t1 = null; }
    if (p.jump) return;
    if (!p.botPlan) {
      for (const c of ch.clusters) {
        if (p.handled.has(c.id)) continue;
        const pl = c.plans[p.laneName];
        if (!pl) { if (c.anchor < t) p.handled.add(c.id); continue; }
        const anchor = c.anchor + c.dir * p.s / c.v;
        if (anchor + pl.t0 < t - 0.3) { p.handled.add(c.id); continue; }
        if (anchor + pl.t0 - t > 1.5) break;
        const sigma = pl.window * (0.08 + (1 - p.skill) * 0.25);
        const g = (Math.random() + Math.random() + Math.random() - 1.5) * 1.15;
        p.botPlan = { id: c.id, t0: anchor + pl.t0 + g * sigma, t1: pl.t1 === null ? null : anchor + pl.t1 + (Math.random() - 0.5) * 0.06 + g * sigma };
        break;
      }
    }
    if (p.grind) return;
    if (p.botPlan && t >= p.botPlan.t0) {
      p.handled.add(p.botPlan.id);
      const t1 = p.botPlan.t1;
      this.jump(p, t);
      p.botPlan = t1 === null ? null : { id: p.botPlan.id, t0: Infinity, t1 };
      if (t1 === null) p.botPlan = null;
    }
    if (p.botPlan && p.botPlan.t0 === Infinity && p.botPlan.t1 === null) p.botPlan = null;
  }

  /**
   * Puntaje al pasar un obstáculo. Se juzga el despegue en el PRIMER obstáculo
   * del grupo (contra el plan ideal); los siguientes suman combo.
   */
  scoreObstacle(ev, p) {
    const c = this.chart.clusters[ev.cluster];
    const pl = c && c.plans[p.laneName];
    const firstMine = c ? c.members.find((m) => laneHits(m.lane, p.laneName)) : ev;
    let j, mult, color, text;
    if (pl && firstMine === ev) {
      const ideal = c.anchor + c.dir * p.s / c.v + pl.t0;
      const diff = Math.abs(p.lastT0 - ideal);
      if (diff <= Math.max(0.05, pl.window * 0.15)) { j = 'perfect'; mult = 3; color = PAL.yellow; text = '¡PERFECTO!'; p.perfects++; }
      else if (diff <= Math.max(0.1, pl.window * 0.32)) { j = 'great'; mult = 2; color = '#7cf2ff'; text = '¡GENIAL!'; }
      else { j = 'ok'; mult = 1; color = PAL.white; text = 'BIEN'; }
      p.judged.set(c.id, mult);
    } else {
      mult = (c && p.judged.get(c.id)) || 1;
      j = mult === 3 ? 'perfect' : mult === 2 ? 'great' : 'ok';
      text = '+' + (c ? c.members.indexOf(ev) + 1 : ''); color = '#ffd36b';
    }
    if (ev.kind === 'rail') return; // el puntaje de la baranda se da al terminar de patinar (onGrindEnd)
    p.combo++; p.maxCombo = Math.max(p.maxCombo, p.combo); p.cleared++;
    const gain = Math.round(100 * mult * (1 + Math.min(p.combo, 30) * 0.1));
    p.score += gain;
    const head = p.actor.group.position.clone(); head.y += CHAR_HEIGHT + 0.5;
    if (!p.isBot || this.players.size <= 2) this.fx.popup(text, head, color, j === 'perfect' ? 0.95 : 0.75);
    if (j === 'perfect' && !p.isBot && firstMine === ev) this.audio.perfect();
    if (firstMine === ev) this.emoJudge(j);
    // globo de slang: rachas y grupos con doble salto perfectos
    let sl = null;
    const djPerfect = j === 'perfect' && c && c.members.length > 1 && ev === c.members[c.members.length - 1];
    if ((p.combo >= 5 && p.combo % 5 === 0) || djPerfect) sl = this.slang(p, SLANG);
    this.ui.sendTo(p, { t: 'judge', j, combo: p.combo, score: p.score, sl });
  }

  /** Terminó de patinar una baranda: bonus por tiempo patinado. */
  onGrindEnd(p, g, t) {
    const c = this.chart.clusters[g.ev.cluster];
    const pl = c && c.plans[p.laneName];
    let mult = 1, j = 'ok';
    if (pl) {
      const ideal = c.anchor + c.dir * p.s / c.v + pl.t0;
      const diff = Math.abs(p.lastT0 - ideal);
      if (diff <= Math.max(0.06, pl.window * 0.2)) { mult = 3; j = 'perfect'; p.perfects++; }
      else if (diff <= Math.max(0.12, pl.window * 0.4)) { mult = 2; j = 'great'; }
    }
    p.combo += 2; p.maxCombo = Math.max(p.maxCombo, p.combo); p.cleared++;
    p.grindsDone = (p.grindsDone || 0) + 1;
    const gain = Math.round((150 + p.grindTime * 500) * mult * (1 + Math.min(p.combo, 30) * 0.1));
    p.score += gain;
    const head = p.actor.group.position.clone(); head.y += CHAR_HEIGHT + 0.6;
    this.fx.popup('GRIND +' + gain, head, PAL.yellow, 0.9);
    this.audio.grindEnd();
    this.emoJudge(j); this.emoJudge('grind');
    const sl = this.slang(p, GRIND_SLANG, true);
    this.ui.sendTo(p, { t: 'judge', j, combo: p.combo, score: p.score, sl });
  }

  /** Globo de slang sobre el personaje (con límite para no saturar). */
  slang(p, list, force) {
    const now = performance.now();
    if (!force && now - p.lastSlang < 2200) return null;
    p.lastSlang = now;
    const text = list[Math.floor(Math.random() * list.length)];
    if (!p.isBot || this.players.size <= 3 || Math.random() < 0.35) this.fx.slang(p.key, text);
    return text;
  }

  // ------------------------------------------------- emociones del gato
  emoJudge(j) {
    if (!this.emo) return;
    if (j === 'grind') { this.emo.joyUntil = this.nowSong() + 1.6; return; }
    this.emo.recent.push(j);
    if (this.emo.recent.length > 10) this.emo.recent.shift();
    if (j === 'perfect') {
      const last = this.emo.recent.slice(-5);
      if (last.filter((x) => x === 'perfect').length >= 3) this.emo.joyUntil = this.nowSong() + 1.4;
    }
  }
  /**
   * Elige la emoción del gato según cómo juegan todos:
   *  enojo (varios K.O. seguidos) > sorpresa (alguien cae / cambio) > alegría
   *  (perfectos) > disfrutando (racha: cierra los ojos) > irritación (timing
   *  descuidado) > normal.
   */
  updateEmotion(t) {
    const E = this.emo;
    if (!E || this.state !== 'playing') return this.state === 'results' ? 'joy' : 'idle';
    E.kos = E.kos.filter((k) => t - k < 6);
    const alive = [...this.players.values()].filter((p) => p.alive && !p.waiting);
    const bestCombo = alive.reduce((m, p) => Math.max(m, p.combo), 0);
    const r = E.recent.slice(-8);
    const good = r.filter((x) => x === 'perfect' || x === 'great').length;
    const sloppy = r.slice(-6).filter((x) => x === 'ok').length;
    let e = 'idle';
    if (t < E.angryUntil) e = 'angry';
    else if (t < E.surpriseUntil) e = 'surprised';
    else if (t < E.joyUntil) e = 'joy';
    else if (bestCombo >= 8 && r.length >= 6 && good / r.length >= 0.75) e = 'vibe';
    else if (sloppy >= 4) e = 'irritated';
    E.current = e;
    return e;
  }

  eliminate(p, o, t) {
    if (!p.alive) return;
    p.alive = false; p.pending = null; p.combo = 0;
    p.elimT = t;
    const alive = [...this.players.values()].filter((q) => q.alive && !q.waiting).length;
    p.place = alive + 1;
    const dir = o ? o.ev.dir : 1;
    p.ko = { vx: dir * 7, vy: 13, vz: 5, t: 0 };
    p.actor.kick(4);
    this.audio.hit();
    const pos = p.actor.group.position.clone(); pos.y += 1.2;
    this.fx.poof(pos, 1.2); this.fx.koStars(pos);
    this.fx.popup('¡K.O.!', pos, PAL.red, 1.3);
    if (this.emo) {
      this.emo.kos.push(t);
      if (this.emo.kos.filter((k) => t - k < 5).length >= 2) this.emo.angryUntil = t + 3;
      else this.emo.surpriseUntil = t + 1.3;
      this.emo.recent.push('ko');
    }
    p.grind = null;
    this.cat.meow(0.4);
    this.ui.toast(`💥 ¡${p.name} quedó fuera!`);
    this.ui.sendTo(p, { t: 'ko', place: p.place, score: p.score });
    this.checkEnd(t);
  }

  checkEnd(t) {
    if (this.state !== 'playing' || this.endTimer) return;
    const inGame = [...this.players.values()].filter((p) => !p.waiting);
    const alive = inGame.filter((p) => p.alive);
    const songOver = t >= this.chart.duration - 0.25;
    if (songOver || alive.length === 0 || (this.startCount > 1 && alive.length <= 1)) {
      this.endTimer = setTimeout(() => { this.endTimer = null; this.finish(); }, songOver ? 300 : 1800);
    }
  }

  finish() {
    if (this.state !== 'playing') return;
    this.state = 'results';
    this.audio.stopSong();
    this.audio.fanfare();
    const inGame = [...this.players.values()].filter((p) => !p.waiting);
    // orden: vivos por puntaje, luego eliminados por momento de eliminación (más tarde = mejor) y puntaje
    inGame.sort((a, b) => {
      if (a.alive !== b.alive) return a.alive ? -1 : 1;
      if (!a.alive && a.elimT !== b.elimT) return (b.elimT || 0) - (a.elimT || 0);
      return b.score - a.score;
    });
    inGame.forEach((p, i) => { p.place = i + 1; });
    this.cat.meow(1);
    this.ui.onState('results', inGame);
    inGame.forEach((p) => this.ui.sendTo(p, { t: 'state', phase: 'results', place: p.place, total: inGame.length, score: p.score, alive: p.alive }));
  }

  // ------------------------------------------------------------ bucle
  loop(nowMs) {
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (nowMs - this.lastFrame) / 1000);
    this.lastFrame = nowMs;
    if (this.paused) { this.render(0); return; }
    if (this.state !== 'playing') this.lobbyClock += dt;

    const t = this.state === 'playing' ? this.audio.songTime() : this.lobbyClock;
    this.t = t;
    const beat = this.beatInfo(t);
    this.beat = beat;

    if (this.state === 'playing') {
      this.spawnObstacles(t);
      this.stepPhysics(t);
      this.handleChanges(t);
      this.checkEnd(t);
      this.ui.hud(t, this.chart, this.players);
    } else {
      if (this.state === 'countdown' && this.chart) this.ui.hud(0, this.chart, this.players);
      // salto de prueba en el lobby
      this.players.forEach((p) => { if (p.jump && t >= landTime(p.jump.segs)) { p.jump = null; p.landT = -99; p.actor.kick(-2); } });
    }
    this.updateObstacles(t, dt);
    this.updateActors(t, dt, beat);

    // cámara suave
    this.camPos.lerp(this.camTarget.pos, Math.min(1, dt * 3));
    this.camLook.lerp(this.camTarget.look, Math.min(1, dt * 3));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);

    // gato
    if (this.state === 'playing') this.lastSongT = t;
    const dir = this.chart && this.state !== 'lobby' ? dirAt(this.chart, this.state === 'playing' ? t : (this.state === 'results' ? (this.lastSongT || 0) : 0)) : 1;
    let look, spin;
    if (this.state === 'playing' || this.state === 'results') {
      const incoming = this.active.filter((o) => !o.passed).sort((a, b) => a.ev.tArr - b.ev.tArr)[0];
      look = incoming ? Math.max(-1, Math.min(1, this.obstacleS(incoming.ev, t) / (R * 0.9))) : -dir * 0.6;
      const vNow = incoming ? incoming.ev.v : (this.chart ? changeAt(this.chart, t).v : 6);
      spin = this.state === 'playing' ? dir * vNow / R : 0.05;
    } else { look = undefined; spin = 0.12; }
    this.spinSpeed += (spin - this.spinSpeed) * Math.min(1, dt * 4);
    this.dir = dir;
    const emotion = this.updateEmotion(t);
    this.cat.update(dt, { beat: beat.phase, beatIndex: beat.index, look, spinSpeed: this.spinSpeed, lookY: 0, emotion });
    // color de fondo según la sección de la canción
    this.bgTarget = BG_PALETTES[0][0];
    if (this.chart && (this.state === 'playing' || this.state === 'results')) {
      const tt = this.state === 'playing' ? t : (this.lastSongT || 0);
      let si = 0;
      const secs = this.chart.sections;
      for (let i = 0; i < secs.length; i++) if (secs[i].t <= tt) si = i;
      const sec = secs[si];
      if (sec) this.bgTarget = BG_PALETTES[sec.level][Math.floor(si / 2) % 2];
    }
    this.render(dt);
  }

  /** Avisos y efectos de los cambios de sentido y de velocidad. */
  handleChanges(t) {
    const ch = this.chart;
    for (let i = 1; i < ch.changes.length; i++) {
      const r = ch.changes[i];
      if (r.t > t + 3) break;
      const warnT = r.t - 2 * ch.beatDur;
      if (t >= warnT && !this.warned.has(i)) {
        this.warned.add(i);
        this.ui.change(r);
        this.cat.meow(1); this.audio.meow(r.speed ? 1.25 : 0.8);
        if (this.emo) this.emo.surpriseUntil = t + 1.2;
      }
      if (t >= r.t && !this.warned.has('done' + i)) {
        this.warned.add('done' + i);
        if (r.rev) this.audio.screech();
        if (r.speed) { this.audio.speedUp(); this.fx.flash(); }
        // lo que quedaba en la rueda se va en una nube y los jugadores se reacomodan
        this.active.forEach((o) => { o.kill = true; });
        this.layoutPlay(t);
      }
    }
  }

  updateObstacles(t, dt) {
    if (!this.chart) return;
    const keep = [];
    for (const o of this.active) {
      const ev = o.ev;
      const s = this.state === 'playing' ? this.obstacleS(ev, t) : this.obstacleS(ev, o.lastT || t);
      if (this.state === 'playing') o.lastT = t;
      o.passed = s * ev.dir > 0;
      if (o.rail) {
        // cada tramo sigue la curva; aparece al entrar al arco visible
        for (const pt of o.parts) {
          const sp = s + pt.dx;
          const ph = sp / R;
          pt.mesh.position.set(R * Math.sin(ph), R * Math.cos(ph), 0);
          pt.mesh.rotation.z = -ph;
          const inside = Math.abs(sp) <= PHYS.SPAWN_ARC * R + 0.2 && sp * ev.dir <= PHYS.EXIT_ARC * R;
          if (inside && pt.born === null) pt.born = t;
          pt.mesh.visible = inside;
          if (inside) {
            const k = Math.min(1, Math.max(0, (t - pt.born) / 0.25));
            pt.mesh.scale.set(1, k < 1 ? Math.max(0.01, (1 - Math.pow(1 - k, 3)) * (1 + Math.sin(k * Math.PI) * 0.3)) : 1, 1);
          }
        }
        const tail = (s - ev.dir * ev.railL) * ev.dir;
        if ((tail > PHYS.EXIT_ARC * R || o.kill) && this.state === 'playing') { this.obsLayer.remove(o.mesh); continue; }
        keep.push(o);
        continue;
      }
      const phi = s / R;
      o.mesh.position.set(R * Math.sin(phi), R * Math.cos(phi), 0);
      o.mesh.rotation.z = -phi;
      // aparición con rebote
      const age = t - (ev.tSpawn - 0.2);
      const k = Math.min(1, Math.max(0, age / 0.32));
      const pop = k < 1 ? (1 - Math.pow(1 - k, 3)) * (1 + Math.sin(k * Math.PI) * 0.35) : 1;
      o.inner.scale.set(1, Math.max(0.01, pop), 1);
      // rodar troncos/ovillos
      if (o.inner.userData.spin && (ev.kind === 'log' || ev.kind === 'yarn' || ev.kind === 'bomb')) {
        const r = ev.w / 2; o.inner.userData.spin.rotation.z = -(s / r) * 0.5;
      }
      if (this.showHitboxes !== o.hb) {
        o.hb = this.showHitboxes;
        if (o.hb) o.mesh.add(this.hitboxFor(ev, o.mesh)); else o.mesh.children.slice(1).forEach((c) => o.mesh.remove(c));
      }
      const gone = s * ev.dir > PHYS.EXIT_ARC * R || o.kill;
      if (gone && this.state === 'playing') {
        this.obsLayer.remove(o.mesh);
        const wp = o.mesh.position.clone(); wp.y += ev.h / 2;
        this.fx.poof(wp, 0.9);
        continue;
      }
      keep.push(o);
    }
    this.active = keep;
  }

  updateActors(t, dt, beat) {
    const playing = this.state === 'playing' || this.state === 'countdown' || this.state === 'results';
    const dir = this.chart && playing ? dirAt(this.chart, this.state === 'playing' ? Math.max(0, t) : (this.state === 'results' ? (this.lastSongT || 0) : 0)) : 1;
    const v = this.spinSpeed * R;
    this.players.forEach((p) => {
      const a = p.actor;
      if (p.waiting) { a.group.visible = false; return; }
      if (p.ko) {
        p.ko.t += dt;
        p.ko.vy -= 30 * dt;
        a.group.position.x += p.ko.vx * dt; a.group.position.y += p.ko.vy * dt; a.group.position.z += p.ko.vz * dt;
        a.update(dt, { mode: 'ko' });
        if (p.ko.t > 1.6) a.group.visible = false;
        return;
      }
      let s, z = p.lane, air = 0, mode;
      if (playing) {
        if (p.targetS !== undefined && p.alive) {
          const d = p.targetS - p.s;
          p.s += Math.sign(d) * Math.min(Math.abs(d), dt * 5);
        }
        s = p.s;
        air = this.state === 'playing' ? this.feetAt(p, t) : 0;
        if (this.state === 'results') mode = p.alive ? 'idle' : 'ko';
        else if (this.state === 'countdown') mode = 'idle';
        else if (p.grind) mode = 'grind';
        else mode = air > 0 ? 'jump' : 'run';
        a.faceTowards(-dir, dt);
      } else {
        // lobby: pasean por la cabeza y bailan
        air = this.feetAt(p, t);
        p.walkPause -= dt;
        if (p.walkPause <= 0 && Math.abs(p.s - p.walkTarget) < 0.05) {
          p.walkTarget = (Math.random() - 0.5) * 7; p.walkPause = 1.5 + Math.random() * 3;
        }
        const d = p.walkTarget - p.s;
        if (Math.abs(d) > 0.05 && p.walkPause < 1.2) {
          const step = Math.sign(d) * Math.min(Math.abs(d), dt * 1.6);
          p.s += step; mode = 'walk'; a.faceTowards(Math.sign(d), dt);
        } else { mode = 'idle'; a.faceTowards(p.s > 0 ? -1 : 1, dt); }
        if (air > 0) mode = 'jump';
        s = p.s;
      }
      const phi = s / R;
      const rr = R + 0.02 + air;
      a.group.position.set(Math.sin(phi) * rr, Math.cos(phi) * rr, z);
      // voltereta en el doble salto (hacia donde corre)
      let flip = 0;
      if (p.jump && (p.jump.dj || p.jump.pop)) {
        const k = Math.min(1, Math.max(0, (t - p.jump.segs[p.jump.pop ? 0 : 1].t) / 0.55));
        flip = (1 - Math.pow(1 - k, 2)) * Math.PI * 2 * (playing ? dir : (a.heading > 1.5 ? 1 : -1));
      }
      a.group.rotation.z = -phi + flip;
      a.ground.visible = flip === 0;
      a.ground.position.y = -air; // sombra se queda en el suelo
      a.ground.scale.setScalar(Math.max(0.35, 1 - air * 0.15));
      const ls = p.jump ? p.jump.segs[p.jump.segs.length - 1] : null;
      const vyUp = ls ? (ls.v - PHYS.G * (t - ls.t)) > 0 : false;
      a.update(dt, { mode, speed: Math.abs(v), vyUp, beat: beat.phase, beatIndex: beat.index + (p.key.length % 2) });
      if (p.grind && Math.random() < 0.7) {
        const fp = a.group.position.clone();
        fp.y -= 0.02;
        this.fx.spark(fp, dir);
      }
      if (p.pending) a.group.position.x += (Math.random() - 0.5) * 0.02;
    });
  }

  render(dt) {
    // fondo 2D (orejas, brazos) proyectado
    const ctx = this.bg;
    ctx.setTransform(this.bgDpr, 0, 0, this.bgDpr, 0, 0);
    this.camera.updateMatrixWorld();
    this.cat.drawBackdrop(ctx, this.W, this.H, (x, y, z) => this.project(x, y, z), { beat: this.beat ? this.beat.phase : 0, beatIndex: this.beat ? this.beat.index : 0, dir: this.dir, bg: this.bgTarget, dt });
    this.renderer.render(this.scene, this.camera);
    // placas de nombre
    const plates = [];
    this.players.forEach((p) => {
      if (p.waiting || !p.actor.group.visible || p.ko) return;
      const gp = p.actor.group.position;
      const up = new THREE.Vector3(Math.sin(-p.actor.group.rotation.z), Math.cos(p.actor.group.rotation.z), 0);
      const top = gp.clone().addScaledVector(up, CHAR_HEIGHT + 0.15);
      const head = this.project(top.x, top.y, top.z);
      plates.push({ id: p.key, name: p.name, color: p.color, head, alive: p.alive, connected: p.connected || !p.remote });
    });
    this.fx.draw(dt, (x, y, z) => this.project(x, y, z), plates);
  }
}
