// =====================================================================
//  GATO SWING · Arranque del host y la interfaz (lobby, HUD, resultados)
// =====================================================================
import { AudioEngine } from './audio.js';
import { loadCharacters, CHARACTERS } from './characters.js';
import { Game } from './game.js';
import { HostNet } from './net.js';
import { DIFFICULTY, changeAt } from './chart.js';
import { MODE_INFO, STEM_INFO } from './stemchart.js';

window.__booted = true;
clearTimeout(window.__bootTimer);

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const charName = (id) => (CHARACTERS.find((c) => c.id === id) || {}).name || id;
const portrait = (id) => `assets/portraits/${id}.png`;

let game, net, audio;
let songReady = false;
const DEFAULT_SONG = { url: 'assets/audio/ww.mp3', name: 'W&W (original)' };

function setLoad(p, text) { $('load-bar').style.width = Math.round(p * 100) + '%'; if (text) $('load-text').textContent = text; }

// ------------------------------------------------------------------ UI
const ui = {
  toastTimer: null,
  toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.remove('hide');
    clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => t.classList.add('hide'), 2600);
  },
  sendTo(p, msg) { if (p && p.remote && net) net.send(p.key, msg); },

  refreshLobby() {
    if (!game) return;
    const list = $('plist');
    const ps = [...game.players.values()];
    $('pcount').textContent = ps.length;
    if (!ps.length) {
      list.innerHTML = '<li class="empty">Esperando artistas… ¡escanea el QR!</li>';
    } else {
      list.innerHTML = ps.map((p) => {
        const st = p.remote && net ? net.stats(p.key) : null;
        const conn = p.isBot ? 'Bot' : p.kb ? 'Teclado' : (p.connected ? (st && st.via === 'local' ? 'Local' : `${st ? st.rtt : '–'} ms`) : 'Reconectando…');
        return `<li class="${p.connected || !p.remote ? '' : 'off'}">
          <div class="por" style="background-image:url('${portrait(p.charId)}');border-color:${p.color}"></div>
          <div class="nm"><b style="text-shadow:2px 2px 0 ${p.color}66">${esc(p.name)}</b><small>${esc(charName(p.charId))} · ${conn}${p.waiting ? ' · en espera' : ''}</small></div>
          <button class="x" data-kick="${esc(p.key)}" title="Expulsar">✕</button></li>`;
      }).join('');
    }
    this.updateStart();
  },
  updateStart() {
    $('btn-start').disabled = !(songReady && game && game.state === 'lobby');
  },

  onState(state, ranking) {
    $('lobby').classList.toggle('hidden', state !== 'lobby');
    $('hud').classList.toggle('hidden', state !== 'playing' && state !== 'countdown');
    if (state === 'preparing') return;
    $('results').classList.toggle('hidden', state !== 'results');
    if (state === 'lobby') { this.refreshLobby(); net && net.broadcast({ t: 'state', phase: 'lobby' }); if (game) refreshGlobal(); }
    if (state === 'countdown') {
      $('hud-bpm').textContent = Math.round(game.chart.bpm);
      $('hud-diff').textContent = DIFFICULTY[game.difficulty].label;
      game.players.forEach((p) => this.sendTo(p, { t: 'state', phase: 'countdown', alive: true, lives: game.chart.stem ? p.lives : undefined }));
    }
    if (state === 'playing') game.players.forEach((p) => this.sendTo(p, { t: 'state', phase: p.waiting ? 'spectate' : 'playing', alive: p.alive }));
    if (state === 'results') this.showResults(ranking);
    this.updateStart();
  },

  countdown(done) {
    const card = $('card');
    const seq = ['3', '2', '1', '¡MIAU!'];
    let i = 0;
    const step = () => {
      if (i >= seq.length) { card.innerHTML = ''; done(); return; }
      card.innerHTML = `<div class="title-card ${i === 3 ? 'small' : ''}">${seq[i]}</div>`;
      if (i < 3) audio.tick(false); else { audio.tick(true); audio.meow(1.1); game.cat.meow(1); }
      i++;
      setTimeout(step, i === 4 ? 520 : 680);
    };
    step();
  },

  /** Letrero de aviso: cambio de sentido y/o aceleración. */
  change(r) {
    const card = $('card');
    const arrow = r.dir > 0 ? '⟶' : '⟵';
    let html = '';
    if (r.speed) html += `<div class="sign speed"><span class="arrow">⚡</span>¡Más rápido!<span class="arrow">⚡</span></div>`;
    if (r.rev) html += `<div class="sign ${r.speed ? 'second' : ''}">${r.dir > 0 ? '' : `<span class="arrow">${arrow}</span>`}¡Al revés!${r.dir > 0 ? `<span class="arrow">${arrow}</span>` : ''}</div>`;
    card.innerHTML = html;
    clearTimeout(this.signTimer);
    this.signTimer = setTimeout(() => { if (card.querySelector('.sign')) card.innerHTML = ''; }, 1900);
  },
  /** Letrero grande del cambio de modo del gato. */
  modeSign(r) {
    const m = MODE_INFO[r.mode] || MODE_INFO.tambor;
    const card = $('card');
    let html = `<div class="sign mode ${r.mode}">${m.icon} ${m.sign}<small>${m.sub}</small></div>`;
    if (r.speed) html += `<div class="sign speed second"><span class="arrow">⚡</span>¡Más rápido!<span class="arrow">⚡</span></div>`;
    card.innerHTML = html;
    clearTimeout(this.signTimer);
    this.signTimer = setTimeout(() => { if (card.querySelector('.sign')) card.innerHTML = ''; }, 3200);
  },
  railHint() {
    const now = performance.now();
    if (now - (this.railHintT || 0) < 4000) return;
    this.railHintT = now;
    const card = $('card');
    card.innerHTML = '<div class="sign rail">🛹 ¡Salta a la baranda y MANTÉN presionado!</div>';
    clearTimeout(this.signTimer);
    this.signTimer = setTimeout(() => { if (card.querySelector('.sign')) card.innerHTML = ''; }, 2200);
    game.players.forEach((p) => this.sendTo(p, { t: 'hint', text: '🛹 ¡Baranda! Salta y MANTÉN presionado' }));
  },
  preparing(on) {
    const card = $('card');
    if (on) card.innerHTML = '<div class="title-card small" style="color:#fff">Preparando…</div>';
    else if (card.textContent.indexOf('Preparando') >= 0) card.innerHTML = '';
  },

  hudTimer: 0,
  hud(t, chart, players) {
    const now = performance.now();
    if (now - this.hudTimer < 120) return;
    this.hudTimer = now;
    const ps = [...players.values()].filter((p) => !p.waiting);
    $('hud-alive').textContent = `${ps.filter((p) => p.alive).length}/${ps.length}`;
    $('hud-prog').style.width = Math.max(0, Math.min(100, (t / chart.duration) * 100)) + '%';
    const ch = changeAt(chart, t);
    if (chart.stem) {
      const m = MODE_INFO[ch.mode] || MODE_INFO.tambor;
      $('hud-speed').textContent = `${m.icon} ${m.label}${ch.level ? ' ⚡' + (ch.level + 1) : ''}`;
    } else $('hud-speed').textContent = '⚡ x' + (chart.changes[0].travel / ch.travel).toFixed(2).replace(/0$/, '');
    if (chart.stem) ps.sort((a, b) => b.score - a.score); else ps.sort((a, b) => (b.alive - a.alive) || (b.score - a.score));
    $('hud-scores').innerHTML = ps.slice(0, 10).map((p) => `<li class="${p.alive ? '' : 'out'}"><i style="background:${p.color}"></i>${esc(p.name)} <b>${p.score}</b>${chart.stem ? `<span class="h">${'♥'.repeat(Math.max(0, p.lives || 0))}</span>` : ''}${p.combo > 2 ? `<span class="c">x${p.combo}</span>` : ''}</li>`).join('');
  },

  showResults(ranking) {
    const w = ranking[0];
    $('winner').innerHTML = w ? `<div class="por" style="background-image:url('${portrait(w.charId)}')"></div>
      <div class="nm">🏆 ${esc(w.name)}<small>${game.chart && game.chart.stem ? `${w.score} puntos${w.alive ? ' · ' + '♥'.repeat(w.lives || 0) : ''}` : (w.alive ? 'Sobrevivió a la función' : 'El último en caer')} · ${esc(charName(w.charId))}</small></div>` : '';
    $('rank').innerHTML = ranking.map((p) => `<tr data-k="${esc(p.key)}"><td>${p.place}</td><td style="text-align:left"><span style="color:${p.color};-webkit-text-stroke:1px #141414">●</span> ${esc(p.name)}</td><td>${p.score}</td><td>${p.maxCombo}</td><td>${p.perfects}</td><td class="gl">…</td></tr>`).join('');
    submitGlobal(ranking);
  },

  pause(on) { $('pause').classList.toggle('hidden', !on); },
};

// ----------------------------------------------------------------- red
function joinUrl(code) {
  const base = location.href.split('?')[0].split('#')[0].replace(/index\.html$/, '');
  return base + 'play.html?room=' + code;
}
function showRoom(code) {
  if (!code) { $('room-code').textContent = '····'; $('join-url').textContent = 'Despertando el servidor…'; return; }
  $('room-code').textContent = code; $('hud-room').textContent = code;
  const url = joinUrl(code);
  $('join-url').textContent = url;
  const qr = $('qr'); qr.innerHTML = '';
  if (window.QRCode) new QRCode(qr, { text: url, width: 380, height: 380, colorDark: '#141414', colorLight: '#fffaf0', correctLevel: QRCode.CorrectLevel.M });
  else qr.textContent = code;
}

function welcomeFor(p) {
  const w = { name: p.name, char: p.charId, charName: charName(p.charId), color: p.color, room: net.code, phase: game.state === 'lobby' ? 'lobby' : (p.waiting ? 'spectate' : game.state), alive: p.alive };
  // reconexión a mitad de partida: recupera vidas y modo (flechas de la pista, instrumento del tambor)
  if (game.chart && game.chart.stem && (game.state === 'playing' || game.state === 'countdown') && !p.waiting) {
    w.lives = p.lives; w.score = p.score;
    if (p.alive) w.modeMsg = game.modeMsg(p);
  }
  return w;
}

function setupNet() {
  net = new HostNet({
    onJoin(key, hello, via) {
      if (game.players.size >= 24 && !game.players.has(key)) return false;
      const p = game.addPlayer(key, { name: hello && hello.name });
      if (hello && hello.resume) ui.toast(`🔌 ${p.name} volvió`);
      return welcomeFor(p);
    },
    onMessage(key, msg, client) {
      const p = game.players.get(key);
      if (!p) return;
      p.connected = true;
      game.remoteInput(p, msg, client, performance.now());
    },
    onLeave(key, reason) {
      const p = game.players.get(key);
      if (!p) return;
      p.connected = false;
      ui.refreshLobby();
      if (reason === 'bye' && game.state === 'lobby') { game.removePlayer(key); net.forget(key); return; }
      // en el lobby, si no vuelve en 90 s, se libera el puesto
      clearTimeout(p.dropTimer);
      p.dropTimer = setTimeout(() => { const q = game.players.get(key); if (q && !q.connected && game.state === 'lobby') { game.removePlayer(key); net.forget(key); } }, 90000);
    },
    onStatus(st) {
      const el = $('net'); el.className = 'net ' + st.level; $('net-text').textContent = st.text;
    },
    onRoomChange(code) { showRoom(code); },
  });
  return net.start().then((code) => {
    showRoom(code);
    // diagnóstico: tipo de conexión con el servidor (no bloquea)
    const diag = () => {
      const t = net.transport();
      $('net-diag').innerHTML = t === 'websocket' ? 'Conexión: WebSocket <b class="y">✓</b> (la más rápida)'
        : t === 'polling' ? 'Conexión: HTTP long-polling <b class="y">✓</b> (la red bloquea WebSocket; funciona igual)'
        : 'Conectando con el servidor…';
    };
    diag(); setInterval(diag, 3000);
  });
}

// ------------------------------------------------------- ranking global
// Todo pasa por NUESTRO servidor (/api/scores) → Supabase. Si la red falla, los
// puntajes quedan en cola en este PC y se reenvían después.
let songKey = 'w-w', songTitle = 'W&W';
const slugify = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'cancion';
const QKEY = 'gatoswing-pending-scores';
const loadQ = () => { try { return JSON.parse(localStorage.getItem(QKEY) || '[]'); } catch (e) { return []; } };
const saveQ = (q) => { try { localStorage.setItem(QKEY, JSON.stringify(q.slice(-20))); } catch (e) {} };

async function fetchJSON(url, opts, ms = 8000) {
  const ctl = window.AbortController ? new AbortController() : null;
  const timer = setTimeout(() => ctl && ctl.abort(), ms);
  try { const r = await fetch(url, Object.assign({ signal: ctl && ctl.signal, cache: 'no-store' }, opts || {})); return await r.json(); }
  finally { clearTimeout(timer); }
}
async function refreshGlobal() {
  const box = $('global');
  const diffLabel = DIFFICULTY[game.difficulty].label;
  box.innerHTML = `<h3>🌍 Ranking global · ${esc(songTitle)} <small>${diffLabel}</small></h3><div class="gl-msg">Cargando…</div>`;
  try {
    const j = await fetchJSON(`api/scores?song=${encodeURIComponent(songKey)}&difficulty=${game.difficulty}`);
    if (!j.ok) throw new Error('sin ranking');
    box.innerHTML = `<h3>🌍 Ranking global · ${esc(songTitle)} <small>${diffLabel}</small></h3>` + (j.rows.length
      ? `<ol>${j.rows.slice(0, 5).map((r) => `<li><b>${esc(r.name)}</b><span>${r.points}</span></li>`).join('')}</ol>`
      : '<div class="gl-msg">¡Nadie todavía! El primer récord es tuyo.</div>');
  } catch (e) { box.innerHTML = `<h3>🌍 Ranking global</h3><div class="gl-msg">Sin conexión con el ranking (el juego funciona igual).</div>`; }
}
async function postScores(payload) {
  const j = await fetchJSON('api/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, 12000);
  if (!j || !j.ok) throw new Error('no guardó');
  return j;
}
async function flushQueue() {
  const q = loadQ(); if (!q.length) return;
  const left = [];
  for (const item of q) { try { await postScores(item); } catch (e) { left.push(item); } }
  saveQ(left);
}
/** Al terminar: guarda los puntajes de las personas (no los bots) y muestra su puesto mundial. */
async function submitGlobal(ranking) {
  const humans = ranking.filter((p) => !p.isBot && p.score > 0);
  const cell = (p, html) => { const td = document.querySelector(`#rank tr[data-k="${CSS.escape(p.key)}"] td.gl`); if (td) td.innerHTML = html; };
  if (!humans.length) { ranking.forEach((p) => cell(p, '–')); return; }
  const payload = { song: songKey, songTitle, difficulty: game.difficulty, players: humans.map((p) => ({ name: p.name, char: p.charId, points: p.score, maxCombo: p.maxCombo, perfects: p.perfects, livesLeft: Math.max(0, p.lives || 0), survived: !!p.alive })) };
  humans.forEach((p) => cell(p, '⏳'));
  try {
    const j = await postScores(payload);
    flushQueue();
    humans.forEach((p, i) => {
      const r = j.ranks[i]; if (!r || !r.rank) { cell(p, '✓'); return; }
      cell(p, r.rank === 1 ? '🥇 #1' : '#' + r.rank);
      ui.sendTo(p, { t: 'global', rank: r.rank, best: j.top && j.top[0] ? j.top[0].points : null });
    });
    const champ = humans.find((p, i) => j.ranks[i] && j.ranks[i].rank === 1);
    if (champ) ui.toast(`🏆 ¡${champ.name} tiene el RÉCORD MUNDIAL de ${songTitle}!`);
  } catch (e) {
    const q = loadQ(); q.push(payload); saveQ(q);
    humans.forEach((p) => cell(p, '📶'));
    ui.toast('📶 Sin conexión con el ranking: los puntajes se enviarán después');
  }
  ranking.filter((p) => p.isBot).forEach((p) => cell(p, '🤖'));
}

// ------------------------------------------------------------- canciones
let stemIndex = [];
async function loadStemIndex() {
  try {
    const r = await fetch('songs/index.json', { cache: 'no-cache' });
    if (!r.ok) return;
    const j = await r.json();
    stemIndex = (j.songs || []).filter((s) => s && s.chart && s.audio);
  } catch (e) { stemIndex = []; }
  const box = $('stem-songs');
  box.innerHTML = stemIndex.map((s, i) => `<button class="small" data-stem="${i}">🎼 ${esc(s.title)}<small>${(s.modes || []).map((m) => (MODE_INFO[m] || {}).icon || '').join(' ')} · ${Math.round(s.bpm)} BPM</small></button>`).join('');
  box.onclick = (e) => { const b = e.target.closest('[data-stem]'); if (b) loadStemSong(stemIndex[+b.dataset.stem]); };
}
function markStem(entry) { [...$('stem-songs').children].forEach((b) => b.classList.toggle('on', entry && stemIndex[+b.dataset.stem] === entry)); }

/** Canción preparada en Colab: chart.json + song.mp3 (sin análisis en el navegador). */
async function loadStemSong(entry) {
  songReady = false; ui.updateStart(); markStem(entry);
  $('song-name').textContent = '🎼 ' + entry.title;
  $('song-info').textContent = 'Cargando canción con STEMS…';
  try {
    const [chart, buf] = await Promise.all([
      fetch('songs/' + entry.chart).then((r) => { if (!r.ok) throw new Error('chart ' + r.status); return r.json(); }),
      audio.fetchBuffer('songs/' + entry.audio),
    ]);
    game.setStemSong(buf, chart, entry.title);
    songKey = entry.id; songTitle = entry.title; refreshGlobal();
    const mins = Math.floor(chart.duration / 60), secs = Math.round(chart.duration % 60).toString().padStart(2, '0');
    const modes = [...new Set((chart.sections || []).map((s) => s.mode))].map((m) => (MODE_INFO[m] || {}).icon + ' ' + (MODE_INFO[m] || {}).label).join(' · ');
    $('song-info').textContent = `${Math.round(chart.bpm)} BPM · ${mins}:${secs} · STEMS: ${modes} · 3 vidas`;
    songReady = true;
  } catch (e) {
    console.error(e);
    $('song-info').textContent = '⚠️ No se pudo cargar esa canción.';
  }
  ui.updateStart();
}

async function loadSong(source, name) {
  markStem(null);
  songReady = false; ui.updateStart();
  $('song-name').textContent = name;
  $('song-info').textContent = 'Cargando…';
  try {
    const buf = source instanceof ArrayBuffer ? await audio.decode(source) : await audio.fetchBuffer(source);
    $('song-info').textContent = 'Analizando ritmo… 0%';
    const an = await game.setSong(buf, name, (p) => { $('song-info').textContent = `Analizando ritmo… ${Math.round(p * 100)}%`; });
    songKey = 'libre-' + slugify(name); songTitle = name; refreshGlobal();
    const mins = Math.floor(an.duration / 60), secs = Math.round(an.duration % 60).toString().padStart(2, '0');
    $('song-info').textContent = `${Math.round(an.bpm)} BPM · ${mins}:${secs} · ¡lista!`;
    songReady = true;
  } catch (e) {
    console.error(e);
    $('song-info').textContent = '⚠️ No se pudo leer ese audio. Prueba con otro MP3.';
  }
  ui.updateStart();
}

// ----------------------------------------------------------------- arranque
async function boot() {
  audio = new AudioEngine();
  if (!audio.ctx) { setLoad(0, 'Este navegador no soporta Web Audio.'); return; }
  setLoad(0.05, 'Cargando artistas…');
  const templates = await loadCharacters('assets/characters/', (p) => setLoad(0.05 + p * 0.6, 'Cargando artistas…'));
  if (!templates.size) { setLoad(0.7, 'No se pudieron cargar los personajes. ¿Estás abriendo el juego desde un servidor (GitHub Pages)?'); return; }
  setLoad(0.7, 'Afinando la orquesta…');
  game = new Game({ bg: $('bg'), gl: $('gl'), fx: $('fx'), audio, templates, ui });
  window.game = game; // útil para depurar desde la consola
  await audio.loadMeow('assets/audio/meow.mp3');
  setLoad(0.85, 'Llamando a los celulares…');
  try { await setupNet(); } catch (e) { console.error(e); ui.toast('Problema de red: solo modo local'); }
  setLoad(1, '¡Listo!');
  $('loading').classList.add('hidden');
  ui.onState('lobby');
  bindUi();
  flushQueue();
  await loadStemIndex();
  if (stemIndex.length) loadStemSong(stemIndex[0]); else loadSong(DEFAULT_SONG.url, DEFAULT_SONG.name);
  setInterval(() => { if (game.state === 'lobby') ui.refreshLobby(); }, 2000);
}

function bindUi() {
  const unlock = () => audio.unlock();
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock);
  $('btn-copy').onclick = () => {
    const url = joinUrl(net.code);
    const ok = () => ui.toast('📋 ¡Enlace copiado!');
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(url).then(ok, () => ui.toast(url));
    else { const ta = document.createElement('textarea'); ta.value = url; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); ok(); } catch (e) { ui.toast(url); } ta.remove(); }
  };
  $('btn-newroom').onclick = () => { if (confirm('¿Crear una sala nueva? Los celulares conectados tendrán que volver a escanear.')) { [...game.players.values()].filter((p) => p.remote).forEach((p) => game.removePlayer(p.key)); showRoom(net.newRoom()); } };
  $('btn-bot').onclick = () => game.addBot();
  $('btn-kb1').onclick = () => game.addKeyboard(1);
  $('btn-kb2').onclick = () => game.addKeyboard(2);
  $('plist').onclick = (e) => {
    const k = e.target.closest('[data-kick]'); if (!k) return;
    const key = k.getAttribute('data-kick');
    if (net) net.kick(key);
    game.removePlayer(key);
  };
  $('file-song').onchange = async (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    if (f.size > 60 * 1024 * 1024) { ui.toast('Archivo muy grande (máx 60 MB)'); return; }
    const ab = await f.arrayBuffer();
    loadSong(ab, f.name.replace(/\.[^.]+$/, ''));
    e.target.value = '';
  };
  $('btn-default-song').onclick = () => loadSong(DEFAULT_SONG.url, DEFAULT_SONG.name);
  $('diffs').onclick = (e) => {
    const b = e.target.closest('button[data-d]'); if (!b) return;
    game.difficulty = b.dataset.d;
    [...$('diffs').children].forEach((c) => c.classList.toggle('on', c === b));
    refreshGlobal();
  };
  $('vol').oninput = (e) => audio.setVolume(e.target.value);
  $('latency').oninput = (e) => { audio.userOffset = e.target.value / 1000; $('latency-v').textContent = e.target.value + ' ms'; try { localStorage.setItem('gatoswing-lat', e.target.value); } catch (x) {} };
  try { const v = localStorage.getItem('gatoswing-lat'); if (v) { $('latency').value = v; audio.userOffset = v / 1000; $('latency-v').textContent = v + ' ms'; } } catch (x) {}
  $('film').onchange = (e) => { game.fx.lowFx = !e.target.checked; };
  $('btn-start').onclick = () => { audio.unlock(); game.startMatch(); };
  $('btn-again').onclick = () => { game.backToLobby(); setTimeout(() => game.startMatch(), 50); };
  $('btn-lobby').onclick = () => game.backToLobby();
  $('btn-resume').onclick = () => game.togglePause();
  $('btn-quit').onclick = () => game.backToLobby();
  window.addEventListener('beforeunload', () => { if (net) net.broadcast({ t: 'hostbye' }); });
}

boot().catch((e) => { console.error(e); setLoad(0, 'Error al iniciar: ' + (e && e.message)); });
