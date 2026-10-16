/* =====================================================================
   GATO SWING · Control del celular
   ---------------------------------------------------------------------
   Escrito en ES5 a propósito (var/function, sin flechas ni plantillas)
   para que funcione en Android viejos y iPhone antiguos.
   Red: Socket.IO contra el MISMO servidor de Render que sirve la página
   (HTTPS/443). Empieza con HTTP long-polling y sube a WebSocket si el
   proxy lo permite → funciona en la red restringida de la academia.
   Robustez de conexión:
     - Clave persistente por celular → al reconectar recuperas tu personaje.
     - Socket.IO reintenta solo, sin límite; si la sala no existe todavía
       (pantalla recargando o servidor despertando) se reintenta cada 2 s.
     - Latido: si la pantalla no responde en 6 s se vuelve a unir a la sala.
     - Reconecta al volver a la app (iOS duerme la pestaña), al recuperar
       red (online) y al volver de la caché (pageshow).
     - El salto se envía con la hora del celular → el host compensa el lag.
   ===================================================================== */
(function () {
  'use strict';
  var CFG = window.GATO_CONFIG || {};
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
  var myName = store('gatoswing-name') || '';
  var me = { name: myName, phase: 'connecting', alive: true };

  var socket = null, joined = false, joinTimer = null;
  var lastHost = 0, connected = false, everConnected = false, firstTry = now();
  var fatal = false, seq = 0, attempts = 0;

  // ---------------------------------------------------------------- red
  function connectServer() {
    if (typeof io === 'undefined') {
      fatalMsg('No se pudo cargar', 'Recarga la página. Si sigue fallando, abre el enlace en Chrome (Android) o Safari (iPhone).');
      return;
    }
    setNet('warn', 'Conectando…');
    socket = io({
      transports: ['polling', 'websocket'],   // polling primero: atraviesa proxies
      reconnection: true, reconnectionDelay: 500, reconnectionDelayMax: 3000, timeout: 15000
    });
    socket.on('connect', function () { attempts = 0; joinRoom(); });
    socket.on('disconnect', function () { joined = false; connected = false; setNet('warn', 'Reconectando…'); banner('🔌 Se cortó la conexión · reconectando…'); });
    socket.on('connect_error', function () {
      attempts++;
      setNet('warn', 'Reconectando… (' + attempts + ')');
      banner('🔌 Buscando el servidor… (intento ' + attempts + ')');
      if (now() - firstTry > 20000 && !everConnected) showHelp();
    });
    socket.on('c:d', function (d) { onMessage(d); });
    socket.on('c:rejoin', function () { hello(); });
    socket.on('c:hostgone', function (m) {
      connected = false;
      setNet('warn', 'Esperando la pantalla…');
      banner('🎬 La pantalla se recargó o perdió conexión… esperando');
      if (m && m.closed) { joined = false; scheduleJoin(); }
    });
  }

  function joinRoom() {
    clearTimeout(joinTimer);
    if (fatal || !socket || !socket.connected) return;
    setNet('warn', 'Entrando a la sala ' + room + '…');
    socket.emit('c:join', { room: room, clientId: key }, function (r) {
      if (fatal) return;
      if (r && r.ok) {
        joined = true;
        lastHost = now();
        if (r.hostOnline) hello(); else { setNet('warn', 'Esperando la pantalla…'); banner('🎬 Esperando a que la pantalla vuelva…'); }
      } else if (r && r.error === 'full') {
        fatalMsg('Sala llena', 'Ya no caben más artistas en esta función.', true);
      } else {
        // la sala aún no existe: pantalla recargando o servidor despertando
        setNet('warn', 'Buscando la sala ' + room + '…');
        banner('🔎 Buscando la sala ' + room + '… (¿la pantalla está abierta?)');
        if (now() - firstTry > 20000 && !everConnected) showHelp();
        scheduleJoin();
      }
    });
  }
  function scheduleJoin() { clearTimeout(joinTimer); joinTimer = setTimeout(joinRoom, 2000); }
  function hello() { send({ t: 'hello', k: key, name: me.name, v: 2, ua: inApp ? 'inapp' : '' }); }

  function send(msg) {
    try { if (socket && socket.connected && joined) { socket.emit('c:d', msg); return true; } } catch (e) {}
    return false;
  }

  // latido / vigilancia: si la pantalla deja de responder, volver a unirse
  setInterval(function () {
    if (!connected || !socket) return;
    if (now() - lastHost > 6000) { connected = false; setNet('warn', 'La pantalla no responde…'); joinRoom(); }
  }, 1000);

  function wake(why) {
    requestWakeLock();
    if (!room || fatal || !socket) return;
    if (!socket.connected) { socket.connect(); return; }
    if (!connected || now() - lastHost > 2500) joinRoom();
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) wake('visible'); });
  window.addEventListener('pageshow', function (e) { if (e.persisted) wake('pageshow'); });
  window.addEventListener('online', function () { wake('online'); });
  window.addEventListener('focus', function () { wake('focus'); });

  // ------------------------------------------------------------ mensajes
  function onMessage(d) {
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { return; } }
    if (!d || !d.t) return;
    lastHost = now();
    if (d.t === 'ping') { send({ t: 'pong', h: d.h, c: now() }); if (!connected) markConnected(); return; }
    if (d.t === 'rehello') { hello(); return; }
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
    if (d.t === 'mode') { setMode(d); return; }
    if (d.t === 'lane') { if (d.color) $('mode').style.setProperty('--lane', d.color); return; }
    if (d.t === 'hit') { me.lives = d.lives; vibrate([60, 30, 60]); judge(d.lives === 1 ? '¡ÚLTIMA VIDA!' : '¡AY! -1 ♥', null); showLives(); return; }
    if (d.t === 'ko') { vibrate([80, 40, 160]); me.alive = false; setPhase('ko', false, d); return; }
    if (d.t === 'kicked') { fatalMsg('Fuera del reparto', 'La pantalla te sacó de la sala.', true); return; }
    if (d.t === 'full') { fatalMsg('Sala llena', 'Ya no caben más artistas en esta función.', true); return; }
    if (d.t === 'hostbye') { connected = false; setNet('warn', 'La pantalla se cerró'); banner('🎬 La pantalla se cerró o se recargó… esperando'); return; }
  }

  // ------------------------------------------------- modos del gato (STEMS)
  var curMode = null;
  function setMode(d) {
    curMode = d.mode;
    var m = $('mode'), pista = d.mode === 'pista';
    $('btn-left').classList[pista ? 'remove' : 'add']('hidden');
    $('btn-right').classList[pista ? 'remove' : 'add']('hidden');
    if (!d.mode || d.mode === 'classic') { m.classList.add('hidden'); return; }
    var txt = d.mode === 'tambor' ? '🥁 TAMBOR · tu instrumento: <b>' + (d.label || '') + '</b>'
      : d.mode === 'serpiente' ? '🐍 SERPIENTE · ¡salta al ritmo!'
      : '🛹 PISTA · ◀ ▶ cambia de carril · mantén = patinar';
    m.innerHTML = txt;
    m.style.setProperty('--lane', d.color || '');
    m.classList.remove('hidden');
    vibrate(20);
  }
  function showLives() {
    if (me.lives === undefined || me.lives === null) return;
    var h = ''; for (var i = 0; i < me.lives; i++) h += '♥';
    var sc = $('score'); var base = (sc.getAttribute('data-pts') || '0') + ' pts';
    sc.innerHTML = base + (h ? ' · <span class="lives">' + h + '</span>' : '');
  }

  function markConnected() {
    var was = connected;
    connected = true; everConnected = true; attempts = 0;
    var tr = ''; try { tr = socket.io.engine.transport.name === 'websocket' ? '' : ' (polling)'; } catch (e) {}
    setNet('ok', 'Conectado' + tr);
    banner(null); hideHelp();
    if (!was) vibrate(15);
  }

  function setPhase(phase, alive, d) {
    me.phase = phase; me.alive = alive;
    if (d && d.lives !== undefined && d.lives !== null) me.lives = d.lives; else if (phase === 'lobby') me.lives = undefined;
    var pad = $('pad');
    pad.classList.toggle('ko', phase === 'ko' || (phase === 'playing' && !alive) || phase === 'spectate');
    var st = $('status');
    var editable = phase === 'lobby';
    $('btn-edit').style.display = editable ? '' : 'none';
    if (phase === 'lobby') { st.textContent = '🎟️ En el lobby · ¡prueba a saltar! (toca 2 veces = doble salto)'; judge('¡Listo!', null); }
    else if (phase === 'countdown') { st.textContent = '🎬 ¡Empieza la función!'; judge('3… 2… 1…', 0); }
    else if (phase === 'playing') st.textContent = alive ? '🎵 ¡Salta al ritmo!' : '💫 Fuera de juego';
    if (phase !== 'playing' && phase !== 'countdown') setMode({ mode: null });
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
    if (score !== null && score !== undefined) { $('score').setAttribute('data-pts', score); $('score').textContent = score + ' pts'; showLives(); }
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
  bindPress($('btn-left'), function () { send({ t: 'lane', d: -1, c: now() }); vibrate(8); });
  bindPress($('btn-right'), function () { send({ t: 'lane', d: 1, c: now() }); vibrate(8); });
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
    if (e.keyCode === 37 || e.keyCode === 65) send({ t: 'lane', d: -1, c: now() });
    if (e.keyCode === 39 || e.keyCode === 68) send({ t: 'lane', d: 1, c: now() });
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
    tips += 'Revisa que el código sea <b>' + room + '</b> y que la pantalla del juego siga abierta. Si el servidor estaba dormido puede tardar hasta 1 minuto en despertar; esta página reintenta sola.';
    h.innerHTML = tips + '<br><button id="help-x">Entendido</button>';
    h.classList.remove('hidden');
    $('help-x').onclick = hideHelp;
  }
  function hideHelp() { $('help').classList.add('hidden'); }

  function fatalMsg(title, text, rejoin) {
    fatal = true;
    clearTimeout(joinTimer);
    if (socket) try { socket.io.opts.reconnection = false; socket.disconnect(); } catch (e) {}
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
    connectServer();
    if (inApp) setTimeout(function () { if (!everConnected) showHelp(); }, 6000);
  }
  start();
})();
