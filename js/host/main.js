// =====================================================================
//  GATO SWING · Arranque del host y la interfaz (lobby, HUD, resultados)
// =====================================================================
import { AudioEngine } from './audio.js';
import { loadCharacters, CHARACTERS } from './characters.js';
import { Game } from './game.js';
import { HostNet, probeIce } from './net.js';
import { DIFFICULTY, changeAt } from './chart.js';

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
    if (state === 'lobby') { this.refreshLobby(); net && net.broadcast({ t: 'state', phase: 'lobby' }); }
    if (state === 'countdown') {
      $('hud-bpm').textContent = Math.round(game.chart.bpm);
      $('hud-diff').textContent = DIFFICULTY[game.difficulty].label;
      game.players.forEach((p) => this.sendTo(p, { t: 'state', phase: 'countdown', alive: true }));
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
    $('hud-speed').textContent = 'x' + (chart.changes[0].travel / ch.travel).toFixed(2).replace(/0$/, '');
    ps.sort((a, b) => (b.alive - a.alive) || (b.score - a.score));
    $('hud-scores').innerHTML = ps.slice(0, 10).map((p) => `<li class="${p.alive ? '' : 'out'}"><i style="background:${p.color}"></i>${esc(p.name)} <b>${p.score}</b>${p.combo > 2 ? `<span class="c">x${p.combo}</span>` : ''}</li>`).join('');
  },

  showResults(ranking) {
    const w = ranking[0];
    $('winner').innerHTML = w ? `<div class="por" style="background-image:url('${portrait(w.charId)}')"></div>
      <div class="nm">🏆 ${esc(w.name)}<small>${w.alive ? 'Sobrevivió a la función' : 'El último en caer'} · ${esc(charName(w.charId))}</small></div>` : '';
    $('rank').innerHTML = ranking.map((p) => `<tr><td>${p.place}</td><td style="text-align:left"><span style="color:${p.color};-webkit-text-stroke:1px #141414">●</span> ${esc(p.name)}</td><td>${p.score}</td><td>${p.maxCombo}</td><td>${p.perfects}</td></tr>`).join('');
  },

  pause(on) { $('pause').classList.toggle('hidden', !on); },
};

// ----------------------------------------------------------------- red
function joinUrl(code) {
  const base = location.href.split('?')[0].split('#')[0].replace(/index\.html$/, '');
  return base + 'play.html?room=' + code;
}
function showRoom(code) {
  $('room-code').textContent = code; $('hud-room').textContent = code;
  const url = joinUrl(code);
  $('join-url').textContent = url;
  const qr = $('qr'); qr.innerHTML = '';
  if (window.QRCode) new QRCode(qr, { text: url, width: 380, height: 380, colorDark: '#141414', colorLight: '#fffaf0', correctLevel: QRCode.CorrectLevel.M });
  else qr.textContent = code;
}

function welcomeFor(p) {
  return { name: p.name, char: p.charId, charName: charName(p.charId), color: p.color, room: net.code, phase: game.state === 'lobby' ? 'lobby' : (p.waiting ? 'spectate' : game.state), alive: p.alive };
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
    // diagnóstico (no bloquea)
    probeIce(net.iceServers).then((r) => {
      const y = (b) => (b ? '<b class="y">✓</b>' : '<b class="n">✗</b>');
      $('net-diag').innerHTML = r.error ? 'WebRTC no disponible en este navegador' :
        `Local ${y(r.host)} · Internet (STUN) ${y(r.srflx)} · Relay (TURN) ${y(r.relay)}` +
        (!r.srflx && !r.relay ? '<br>⚠️ La red bloquea WebRTC: los celulares deben estar en la misma WiFi, o configura un TURN en config.js' :
          !r.relay ? '<br>Sin TURN: en redes muy cerradas algunos celulares podrían no conectar' : '');
    });
  });
}

// ------------------------------------------------------------- canciones
async function loadSong(source, name) {
  songReady = false; ui.updateStart();
  $('song-name').textContent = name;
  $('song-info').textContent = 'Cargando…';
  try {
    const buf = source instanceof ArrayBuffer ? await audio.decode(source) : await audio.fetchBuffer(source);
    $('song-info').textContent = 'Analizando ritmo… 0%';
    const an = await game.setSong(buf, name, (p) => { $('song-info').textContent = `Analizando ritmo… ${Math.round(p * 100)}%`; });
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
  loadSong(DEFAULT_SONG.url, DEFAULT_SONG.name);
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
