// Test de red de punta a punta (opcional). Requiere: npm i -D playwright peer
// 1) node -e "require('peer').PeerServer({port:9000,path:'/',host:'127.0.0.1'})" &
// 2) npx serve -l 8080 .   3) node tests/red.e2e.cjs
// Prueba: conexión de 2 celulares, reconexión con el mismo personaje, recarga del host y saltos con lag real.
const { chromium } = require('playwright');
const OUT = require('os').tmpdir() + '/';
const OVR = `window.GATO_CONFIG_OVERRIDE={peer:{host:'127.0.0.1',port:9000,path:'/',secure:false},iceServers:[]};`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const mk = async (w, h, mobile, name) => { const c = await b.newContext({ viewport: { width: w, height: h }, hasTouch: !!mobile, isMobile: !!mobile }); await c.addInitScript(OVR + (name ? `try{if(!localStorage.getItem('gatoswing-name'))localStorage.setItem('gatoswing-name','${name}')}catch(e){}` : '')); return c; };
  const hostCtx = await mk(1600, 900);
  const host = await hostCtx.newPage();
  host.on('console', (m) => { const t = m.text(); if (/\[net\]|ERR|rror/.test(t) && !/404/.test(t)) console.log('HOST:', t); });
  host.on('pageerror', (e) => console.log('HOST ERR', e.message));
  await host.goto('http://localhost:8080/index.html');
  await host.waitForFunction(() => window.game && document.getElementById('net-text').textContent === 'En línea' && document.getElementById('song-info').textContent.includes('lista'), null, { timeout: 90000 });
  const code = await host.evaluate(() => document.getElementById('room-code').textContent);
  console.log('sala', code);
  const phones = [];
  for (let i = 0; i < 2; i++) {
    const ctx = await mk(390, 760, true, ['Ana', 'Beto'][i]);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => console.log('PHONE ERR', e.message));
    p.on('console', (m) => { const t = m.text(); if (/rror/.test(t)) console.log('PHONE' + i + ':', t); });
    await p.goto('http://localhost:8080/play.html?room=' + code);
    phones.push({ ctx, p });
  }
  for (const [i, ph] of phones.entries()) {
    await ph.p.waitForFunction(() => document.getElementById('net-text').textContent.indexOf('Conectado') === 0, null, { timeout: 30000 });
    console.log('teléfono', i, 'conectado:', await ph.p.evaluate(() => document.getElementById('my-name').textContent + ' / ' + document.getElementById('my-char').textContent));
  }
  await sleep(2500);
  let st = await host.evaluate(() => [...game.players.values()].map((p) => ({ n: p.name, c: p.charId, con: p.connected })));
  console.log('host jugadores', JSON.stringify(st));
  await host.screenshot({ path: OUT + 'e2e_lobby.png' });
  await phones[0].p.screenshot({ path: OUT + 'e2e_phone_lobby.png' });
  // salto de prueba en el lobby
  await phones[0].p.tap('#btn-jump');
  await sleep(150);
  console.log('salto lobby registrado:', await host.evaluate(() => [...game.players.values()].some((p) => p.t0 !== null)));
  // nombre
  const keyA = await phones[0].p.evaluate(() => localStorage.getItem('gatoswing-key'));
  // ---- reconexión del celular: cerrar la pestaña y volver a abrirla
  const charBefore = await host.evaluate((k) => game.players.get(k).charId, keyA);
  const rosterBefore = await host.evaluate(() => [...game.players.values()].map((p) => p.name + ':' + p.charId).sort().join(','));
  await phones[0].p.close();
  await sleep(7500);
  console.log('tras cerrar: conectado=', await host.evaluate((k) => game.players.get(k).connected, keyA));
  phones[0].p = await phones[0].ctx.newPage();
  await phones[0].p.goto('http://localhost:8080/play.html?room=' + code);
  await phones[0].p.waitForFunction(() => document.getElementById('net-text').textContent.indexOf('Conectado') === 0, null, { timeout: 30000 });
  const after = await host.evaluate((k) => ({ n: game.players.size, c: game.players.get(k).charId, con: game.players.get(k).connected }), keyA);
  console.log('reconectado: mismo personaje =', after.c === charBefore, JSON.stringify(after));
  // ---- recarga del host: los celulares deben volver solos
  await host.reload();
  await host.waitForFunction(() => window.game && document.getElementById('net-text').textContent === 'En línea', null, { timeout: 90000 });
  const code2 = await host.evaluate(() => document.getElementById('room-code').textContent);
  console.log('host recargado, sala', code2, code2 === code ? '(misma)' : '(CAMBIÓ)');
  const t0 = Date.now();
  await host.waitForFunction(() => game.players.size >= 2 && [...game.players.values()].every((p) => p.connected), null, { timeout: 40000 }).catch(() => {});
  const rosterAfter = await host.evaluate(() => [...game.players.values()].map((p) => p.name + ':' + p.charId).sort().join(','));
  console.log('mismos personajes tras recargar host:', rosterBefore === rosterAfter, rosterAfter);
  console.log('celulares de vuelta tras', ((Date.now() - t0) / 1000).toFixed(1), 's:', await host.evaluate(() => [...game.players.values()].map((p) => p.name + (p.connected ? '✓' : '✗')).join(', ')));
  // ---- partida: A salta en ritmo según el host (trampa de test: usa el plan perfecto), B no salta
  await host.waitForFunction(() => document.getElementById('song-info').textContent.includes('lista'), null, { timeout: 90000 });
  // regresión: saltar en el lobby tras un rato no debe bloquear los saltos en la partida
  await host.evaluate(() => { game.lobbyClock += 300; });
  await phones[0].p.tap('#btn-jump');
  await sleep(300);
  await host.evaluate(() => { game.difficulty = 'facil'; const b = game.addBot(); b.skill = 1; game.startMatch(); });
  await host.waitForFunction(() => game.state === 'playing', null, { timeout: 40000 });
  const keyA2 = keyA;
  // jugador A: saltos guiados por el chart (simula a un humano perfecto con su latencia real)
  // toques guiados por el plan de la partitura para el carril de A: salto, doble salto y
  // barandas (presionar y MANTENER hasta el final). Se recalcula con la posición ACTUAL de A.
  const nextAction = (k, after) => host.evaluate(([k, after]) => { const p = game.players.get(k); const out = [];
    for (const c of game.chart.clusters) { const pl = c.plans[p.laneName]; if (!pl) continue; const a = c.anchor + c.dir * p.s / c.v;
      out.push({ t: a + pl.t0, d: 1 });
      if (c.rail) out.push({ t: a + pl.tEnd + 0.25, d: 0 }); else out.push({ t: a + pl.t0 + 0.08, d: 0 });
      if (pl.t1 !== null) { out.push({ t: a + pl.t1, d: 1 }); out.push({ t: a + pl.t1 + 0.06, d: 0 }); } }
    out.sort((x, y) => x.t - y.t); return out.find((x) => x.t > after) || null; }, [k, after]);
  let last = 0, touches = 0;
  const railsTotal = await host.evaluate(() => game.chart.clusters.filter((c) => c.rail && c.anchor < 75).length);
  while (true) {
    const ac = await nextAction(keyA2, last + 0.001);
    if (!ac || ac.t > 75) break;
    while (true) { const t = await host.evaluate(() => game.audio.songTime()); if (t >= ac.t - 0.03) break; await sleep(6); }
    await phones[0].p.evaluate((d) => { const b = document.getElementById('btn-jump'); const ev = new Event(d ? 'touchstart' : 'touchend', { cancelable: true }); b.dispatchEvent(ev); }, ac.d);
    last = ac.t; if (ac.d) touches++;
    if (!(await host.evaluate((k) => game.players.get(k).alive, keyA2))) break;
  }
  console.log('toques de A:', touches, 'hasta t =', last.toFixed(1), '· barandas en ese tramo:', railsTotal);
  await sleep(1500);
  const res = await host.evaluate(() => [...game.players.values()].map((p) => ({ n: p.name, lane: p.laneName, alive: p.alive, score: p.score, perf: p.perfects, cleared: p.cleared, grinds: p.grindsDone || 0 })));
  console.log('resultado parcial', JSON.stringify(res));
  await host.screenshot({ path: OUT + 'e2e_game.png' });
  await phones[0].p.screenshot({ path: OUT + 'e2e_phone_game.png' });
  await phones[1].p.screenshot({ path: OUT + 'e2e_phone_ko.png' });
  console.log('teléfono B estado:', await phones[1].p.evaluate(() => document.getElementById('status').textContent));
  await b.close();
})().catch((e) => { console.error('FALLO', e); process.exit(1); });
