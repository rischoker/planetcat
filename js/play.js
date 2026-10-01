/* =====================================================================
   GATO SWING · Control del celular
   ---------------------------------------------------------------------
   Escrito en ES5 a propósito (var/function, sin flechas ni plantillas)
   para que funcione en Android viejos y iPhone antiguos.
   Robustez de conexión:
     - Clave persistente por celular → al reconectar recuperas tu personaje.
     - Latido cada segundo; si la pantalla no responde en 5 s se reconecta.
     - Reintentos con espera creciente, sin límite.
     - Cada 3 fallos alterna a "solo TURN" (relay) para atravesar proxies/NAT.
     - Reconecta al volver a la app (iOS duerme la pestaña), al recuperar
       red (online) y al volver de la caché (pageshow).
     - El salto se envía con la hora del celular → el host compensa el lag.
   ===================================================================== */
(function () {
  'use strict';
  var CFG = window.GATO_CONFIG || {};
  var PREFIX = CFG.roomPrefix || 'gatoswing-v1-';
  var $ = function (id) { return document.getElementById(id); };
  var now = function () { return (window.performance && performance.now) ? performance.now() : Date.now(); };

  // ---------------------------------------------------------- utilidades
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e2) {} } return null; }
  function randId(n) { var s = '', a = 'abcdefghijkmnpqrstuvwxyz23456789'; for (var i = 0; i < n; i++) s += a.charAt(Math.floor(Math.random() * a.length)); return s; }
  function show(id) { var s = ['join', 'pad', 'msg']; for (var i = 0; i < s.length; i++) $(s[i]).classList[s[i] === id ? 'remove' : 'add']('hidden'); }
  function setNet(level, text) { $('net').className = 'net ' + level; $('net-text').textContent = text; }
  function banner(text) { var b = $('banner'); if (!text) { b.classList.add('hidden'); return; } b.textContent = text; b.classList.remove('hidden'); }
  function vibrate(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {} }
  function fixVh() { document.documentElement.style.setProperty('--vh', (window.innerHeight * 0.01) + 'px'); }
  fixVh();
  window.addEventListener('resize', fixVh);
  window.addEventListener('orientationchange', function () { setTimeout(fixVh, 300); });
  // iOS: evitar zoom con gestos y doble toque
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
  var lastTouchEnd = 0;
  document.addEventListener('touchend', function (e) { var t = now(); if (t - lastTouchEnd < 350 && e.target.tagName !== 'INPUT') e.preventDefault(); lastTouchEnd = t; }, { passive: false });

  var ua = navigator.userAgent || '';
  var inApp = /FBAN|FBAV|Instagram|Line\/|MicroMessenger|TikTok|Snapchat|; wv\)/i.test(ua);

  // ------------------------------------------------------------- estado
  var key = store('gatoswing-key');
  if (!key) { key = 'c-' + randId(10); store('gatoswing-key', key); }
  var params = {};
  location.search.replace(/^\?/, '').split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) params[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); });
  var room = (params.room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  var localMode = params.local === '1';
  var myName = store('gatoswing-name') || '';
  var me = { name: myName, phase: 'connecting', alive: true };

  var peer = null, conn = null, bc = null;
  var attempts = 0, relayOnly = false, retryTimer = null, openTimer = null;
  var lastHost = 0, connected = false, everConnected = false, firstTry = now();
  var wantConnect = false, fatal = false, seq = 0;

  // ---------------------------------------------------------------- red
  function iceConfig() {
    var c = { iceServers: CFG.iceServers || [] };
    if (relayOnly) c.iceTransportPolicy = 'relay';
    return c;
  }

  function createPeer() {
    if (peer) { try { peer.destroy(); } catch (e) {} peer = null; }
    if (typeof Peer === 'undefined' || !window.RTCPeerConnection) {
      fatalMsg('Navegador no compatible', 'Este navegador no soporta conexiones WebRTC. Abre el enlace en Chrome (Android) o Safari (iPhone) actualizados.');
      return;
    }
    var opts = { debug: 1, config: iceConfig() };
    var extra = CFG.peer || {};
    for (var k in extra) opts[k] = extra[k];
    try { peer = new Peer(opts); } catch (e) { scheduleRetry('No se pudo crear la conexión'); return; }
    var mine = peer;
    peer.on('open', function () { if (mine !== peer) return; if (wantConnect) connectToHost(); });
    peer.on('disconnected', function () {
      if (mine !== peer) return;
      // la señalización se cayó; si el canal de datos sigue vivo no pasa nada
      if (!(conn && conn.open)) scheduleRetry('Sin servidor');
      else { try { peer.reconnect(); } catch (e) {} }
    });
    peer.on('error', function (err) {
      if (mine !== peer) return;
      var t = err && err.type;
      if (t === 'peer-unavailable') scheduleRetry('Buscando la sala ' + room + '…');
      else if (t === 'browser-incompatible') fatalMsg('Navegador no compatible', 'Abre el enlace en Chrome o Safari.');
      else scheduleRetry('Problema de red (' + (t || 'error') + ')');
    });
  }

  function connectToHost() {
    if (fatal) return;
    if (conn) { try { conn.close(); } catch (e) {} conn = null; }
    setNet('warn', attempts ? 'Reconectando… (' + attempts + ')' : 'Conectando…');
    var c;
    try {
      c = peer.connect(PREFIX + room.toLowerCase(), { reliable: true, serialization: 'json', metadata: { k: key } });
    } catch (e) { scheduleRetry('Error al conectar'); return; }
    if (!c) { scheduleRetry('Error al conectar'); return; }
    conn = c;
    clearTimeout(openTimer);
    openTimer = setTimeout(function () { if (conn === c && !c.open) { scheduleRetry('La conexión tarda demasiado'); } }, relayOnly ? 14000 : 9000);
    c.on('open', function () {
      if (conn !== c) return;
      clearTimeout(openTimer);
      lastHost = now();
      send({ t: 'hello', k: key, name: me.name, v: 1, ua: inApp ? 'inapp' : '' });
    });
    c.on('data', function (d) { if (conn === c) onMessage(d); });
    c.on('close', function () { if (conn === c) scheduleRetry('Se cortó la conexión'); });
    c.on('error', function () { if (conn === c) scheduleRetry('Error en la conexión'); });
  }

  function retryNow() {
    clearTimeout(retryTimer); retryTimer = null;
    if (fatal) return;
    wantConnect = true;
    if (localMode) { openLocal(); return; }
    if (!peer || peer.destroyed) { createPeer(); return; }
    if (peer.disconnected) { try { peer.reconnect(); } catch (e) { createPeer(); } return; } // 'open' llamará connectToHost
    if (peer.open) connectToHost(); // si aún no abre, el evento 'open' conectará
  }

  function scheduleRetry(reason) {
    if (fatal) return;
    connected = false;
    if (conn) { try { conn.close(); } catch (e) {} conn = null; }
    if (retryTimer) return;
    attempts++;
    // cada 3 intentos alterna a solo-TURN y recrea el peer (otro camino de red)
    var recreate = attempts % 3 === 0;
    if (recreate) relayOnly = !relayOnly && hasTurn();
    var wait = Math.min(5000, 400 * Math.pow(1.5, Math.min(attempts, 8)));
    setNet('warn', reason || 'Reconectando…');
    banner('🔌 ' + (reason || 'Reconectando') + ' · reintento en ' + Math.round(wait / 1000) + ' s');
    if (now() - firstTry > 15000 && !everConnected) showHelp();
    retryTimer = setTimeout(function () { retryTimer = null; if (recreate) { wantConnect = true; createPeer(); } else retryNow(); }, wait);
  }
  function hasTurn() { var l = CFG.iceServers || []; for (var i = 0; i < l.length; i++) { var u = [].concat(l[i].urls || l[i].url || []); for (var j = 0; j < u.length; j++) if (/^turns?:/.test(u[j])) return true; } return !!(CFG.meteredTurn && CFG.meteredTurn.apiKey); }

  function send(msg) {
    try {
      if (localMode) { if (bc) bc.postMessage({ from: key, msg: msg }); return true; }
      if (conn && conn.open) { conn.send(msg); return true; }
    } catch (e) {}
    return false;
  }

  function openLocal() {
    if (typeof BroadcastChannel === 'undefined') { fatalMsg('Modo local no disponible', 'Este navegador no soporta BroadcastChannel.'); return; }
    if (bc) try { bc.close(); } catch (e) {}
    bc = new BroadcastChannel('gatoswing-' + room);
    bc.onmessage = function (e) { var d = e.data || {}; if (d.to === key) onMessage(d.msg); };
    send({ t: 'hello', k: key, name: me.name, v: 1 });
    setTimeout(function () { if (!connected) scheduleRetry('Buscando la pantalla local…'); }, 3000);
  }

  // latido / vigilancia
  setInterval(function () {
    if (!connected) return;
    if (now() - lastHost > 5000) { scheduleRetry('La pantalla no responde'); }
  }, 1000);

  function wake(why) {
    requestWakeLock();
    if (!room || fatal) return;
    if (!connected || now() - lastHost > 2500) { attempts = 0; retryNow(); }
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) wake('visible'); });
  window.addEventListener('pageshow', function (e) { if (e.persisted) wake('pageshow'); });
  window.addEventListener('online', function () { wake('online'); });
  window.addEventListener('focus', function () { wake('focus'); });
  window.addEventListener('pagehide', function () { send({ t: 'bye-soft' }); });

  // ------------------------------------------------------------ mensajes
  function onMessage(d) {
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { return; } }
    if (!d || !d.t) return;
    lastHost = now();
    if (d.t === 'ping') { send({ t: 'pong', h: d.h, c: now() }); if (!connected) markConnected(); return; }
    if (d.t === 'welcome') {
      markConnected();
      me.name = d.name; me.char = d.char; me.color = d.color; me.phase = d.phase; me.alive = d.alive !== false;
      store('gatoswing-name', d.name);
      $('my-name').textContent = d.name;
      $('my-char').textContent = 'Tu personaje: ' + (d.charName || d.char) + ' · Sala ' + d.room;
      $('por').style.backgroundImage = 'url(assets/portraits/' + d.char + '.png)';
      document.documentElement.style.setProperty('--accent', d.color || '#ff3b4e');
      setPhase(d.phase, me.alive);
      show('pad');
      return;
    }
    if (d.t === 'state') { setPhase(d.phase, d.alive !== false, d); return; }
    if (d.t === 'judge') {
      var txt = d.j === 'perfect' ? '¡PERFECTO!' : d.j === 'great' ? '¡GENIAL!' : 'BIEN';
      judge(d.sl ? d.sl : txt + (d.combo > 1 ? ' x' + d.combo : ''), d.score);
      if (d.j === 'perfect') vibrate(8);
      return;
    }
    if (d.t === 'hint') { hint(d.text); vibrate([20, 30, 20]); return; }
    if (d.t === 'ko') { vibrate([80, 40, 160]); me.alive = false; setPhase('ko', false, d); return; }
    if (d.t === 'kicked') { fatalMsg('Fuera del reparto', 'La pantalla te sacó de la sala.', true); return; }
    if (d.t === 'full') { fatalMsg('Sala llena', 'Ya no caben más artistas en esta función.', true); return; }
    if (d.t === 'hostbye') { connected = false; setNet('warn', 'La pantalla se cerró'); banner('🎬 La pantalla se cerró o se recargó… esperando'); return; }
  }

  function markConnected() {
    var was = connected;
    connected = true; everConnected = true; attempts = 0;
    setNet('ok', localMode ? 'Conectado (local)' : (relayOnly ? 'Conectado (relay)' : 'Conectado'));
    banner(null); hideHelp();
    if (!was) vibrate(15);
  }

  function setPhase(phase, alive, d) {
    me.phase = phase; me.alive = alive;
    var pad = $('pad');
    pad.classList.toggle('ko', phase === 'ko' || (phase === 'playing' && !alive) || phase === 'spectate');
    var st = $('status');
    var editable = phase === 'lobby';
    $('btn-edit').style.display = editable ? '' : 'none';
    if (phase === 'lobby') { st.textContent = '🎟️ En el lobby · ¡prueba a saltar! (toca 2 veces = doble salto)'; judge('¡Listo!', null); }
    else if (phase === 'countdown') { st.textContent = '🎬 ¡Empieza la función!'; judge('3… 2… 1…', 0); }
    else if (phase === 'playing') st.textContent = alive ? '🎵 ¡Salta al ritmo!' : '💫 Fuera de juego';
    else if (phase === 'spectate') st.textContent = '⏳ Entras en la próxima función';
    else if (phase === 'ko') { st.textContent = '💫 ¡K.O.! Puesto ' + (d && d.place ? d.place : '?') + ' · ¡maúlla para animar!'; judge('¡K.O.!', d && d.score); }
    else if (phase === 'results') {
      var p = d && d.place;
      st.textContent = p === 1 ? '🏆 ¡GANASTE LA FUNCIÓN!' : '🎭 Terminaste en el puesto ' + p + ' de ' + (d && d.total);
      judge(p === 1 ? '¡GANASTE!' : 'Puesto ' + p, d && d.score);
      if (p === 1) vibrate([60, 40, 60, 40, 200]);
    }
  }

  var hintTimer = null;
  function hint(text) {
    var h = $('hint');
    h.textContent = text; h.classList.remove('hidden');
    clearTimeout(hintTimer); hintTimer = setTimeout(function () { h.classList.add('hidden'); }, 2400);
  }

  function judge(text, score) {
    var el = $('judge-text');
    el.textContent = text;
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    if (score !== null && score !== undefined) $('score').textContent = score + ' pts';
  }

  // ------------------------------------------------------------- botones
  // Cada dedo nuevo cuenta como un toque (doble salto con dos dedos funciona);
  // "soltar" se envía solo cuando ya no queda ningún dedo sobre el botón.
  function bindPress(el, fn, upFn) {
    var active = 0;
    function start(e) { if (e && e.cancelable) e.preventDefault(); active++; el.classList.add('down'); fn(); }
    function endTouch(e) {
      if (e && e.cancelable) e.preventDefault();
      var left = 0;
      if (e && e.targetTouches) left = e.targetTouches.length;
      active = left;
      if (active <= 0) { active = 0; el.classList.remove('down'); if (upFn) upFn(); }
    }
    function endPtr(e) { active = Math.max(0, active - 1); if (active === 0) { el.classList.remove('down'); if (upFn) upFn(); } }
    if ('ontouchstart' in window) {
      el.addEventListener('touchstart', start, { passive: false });
      el.addEventListener('touchend', endTouch, { passive: false });
      el.addEventListener('touchcancel', endTouch, { passive: false });
    } else if (window.PointerEvent) {
      el.addEventListener('pointerdown', start);
      el.addEventListener('pointerup', endPtr);
      el.addEventListener('pointercancel', endPtr);
      el.addEventListener('pointerleave', function () { if (active) { active = 0; el.classList.remove('down'); if (upFn) upFn(); } });
    } else {
      var end = function () { active = 0; el.classList.remove('down'); if (upFn) upFn(); };
      el.addEventListener('mousedown', start);
      el.addEventListener('mouseup', end);
    }
  }

  var meowAudio = null;
  bindPress($('btn-jump'), function () {
    requestWakeLock();
    send({ t: 'jump', c: now(), s: ++seq });
    vibrate(12);
  }, function () {
    send({ t: 'up', c: now() });
  });
  bindPress($('btn-meow'), function () {
    send({ t: 'meow' });
    try {
      if (!meowAudio) meowAudio = new Audio('assets/audio/meow.mp3');
      meowAudio.currentTime = 0; meowAudio.volume = 0.6;
      var pr = meowAudio.play(); if (pr && pr.catch) pr.catch(function () {});
    } catch (e) {}
  });
  // teclado (por si se juega desde un PC/tablet con teclado)
  document.addEventListener('keyup', function (e) {
    if (e.target && e.target.tagName === 'INPUT') return;
    if (e.keyCode === 32 || e.keyCode === 38) send({ t: 'up', c: now() });
  });
  document.addEventListener('keydown', function (e) {
    if (e.target && e.target.tagName === 'INPUT') return;
    if (e.keyCode === 32 || e.keyCode === 38) { e.preventDefault(); if (!e.repeat) send({ t: 'jump', c: now(), s: ++seq }); }
    if (e.keyCode === 77) send({ t: 'meow' });
  });

  $('btn-edit').addEventListener('click', function () {
    var n = window.prompt('Tu nombre (máx. 14 letras):', me.name || '');
    if (n === null) return;
    n = String(n).replace(/[<>]/g, '').replace(/^\s+|\s+$/g, '').slice(0, 14);
    if (!n) return;
    me.name = n; store('gatoswing-name', n); $('my-name').textContent = n;
    send({ t: 'name', name: n });
  });

  // ----------------------------------------------------------- wake lock
  var wakeLock = null;
  function requestWakeLock() {
    try {
      if ('wakeLock' in navigator && !wakeLock && !document.hidden) {
        navigator.wakeLock.request('screen').then(function (l) { wakeLock = l; l.addEventListener('release', function () { wakeLock = null; }); }).catch(function () {});
      }
    } catch (e) {}
  }

  // ------------------------------------------------------- ayuda / errores
  function showHelp() {
    var h = $('help');
    var tips = '<b>¿No conecta?</b> ';
    if (inApp) tips += 'Estás en el navegador de una app (WhatsApp/Instagram/Facebook). <b>Ábrelo en Chrome o Safari</b> (menú ⋮ → "Abrir en el navegador"). ';
    tips += 'Revisa que el código sea <b>' + room + '</b> y que la pantalla siga abierta. Si estás en una red de colegio/empresa con proxy, prueba con <b>datos móviles</b> o pide que configuren un servidor TURN.';
    h.innerHTML = tips + '<br><button id="help-x">Entendido</button>';
    h.classList.remove('hidden');
    $('help-x').onclick = hideHelp;
  }
  function hideHelp() { $('help').classList.add('hidden'); }

  function fatalMsg(title, text, rejoin) {
    fatal = true;
    if (conn) try { conn.close(); } catch (e) {}
    banner(null);
    setNet('bad', title);
    $('msg-title').textContent = title; $('msg-text').textContent = text;
    $('msg-btn').textContent = rejoin ? 'Volver a entrar' : 'Reintentar';
    $('msg-btn').onclick = function () { location.reload(); };
    show('msg');
  }

  // --------------------------------------------------------------- inicio
  function start() {
    // Pantalla de entrada: si falta el código o aún no tienes nombre
    if (!room || room.length !== 4 || !myName) {
      show('join');
      $('in-room').value = room;
      $('in-name').value = myName;
      $('in-room').addEventListener('input', function () { this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); });
      setNet('warn', room ? 'Escribe tu nombre' : 'Escribe el código');
      setTimeout(function () { try { (room ? $('in-name') : $('in-room')).focus(); } catch (e) {} }, 300);
      $('btn-join').onclick = function () {
        var r = $('in-room').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (r.length !== 4) { $('in-room').focus(); return; }
        var n = $('in-name').value.replace(/[<>]/g, '').replace(/^\s+|\s+$/g, '').slice(0, 14);
        if (!n) n = 'Gato ' + Math.floor(100 + Math.random() * 900);
        store('gatoswing-name', n);
        myName = n; me.name = n;
        if (r !== room) { location.href = location.pathname + '?room=' + r; return; }
        begin();
      };
      return;
    }
    begin();
  }
  function begin() {
    me.name = myName;
    show('pad');
    $('my-name').textContent = me.name || 'Artista';
    $('status').textContent = 'Conectando con la sala ' + room + '…';
    wantConnect = true;
    if (localMode) openLocal(); else createPeer();
    if (inApp) setTimeout(function () { if (!everConnected) showHelp(); }, 6000);
  }
  start();
})();
