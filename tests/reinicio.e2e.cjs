// Prueba de reinicio del servidor (opcional). Requiere: npm i -D playwright y el servidor corriendo (npm start).
// Apaga el servidor, lo vuelve a encender y verifica que la pantalla recupere la MISMA sala y el celular su personaje.
const { chromium } = require('playwright');
const { execSync, spawn } = require('child_process');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const hc = await b.newContext({ viewport: { width: 1280, height: 720 } });
  const host = await hc.newPage();
  await host.goto('http://localhost:3000/');
  await host.waitForFunction(() => window.game && document.getElementById('net-text').textContent.indexOf('En línea') === 0, null, { timeout: 90000 });
  const code = await host.evaluate(() => document.getElementById('room-code').textContent);
  const pc = await b.newContext({ viewport: { width: 390, height: 760 }, hasTouch: true, isMobile: true });
  await pc.addInitScript("localStorage.setItem('gatoswing-name','Caro')");
  const ph = await pc.newPage();
  await ph.goto('http://localhost:3000/play.html?room=' + code);
  await ph.waitForFunction(() => document.getElementById('net-text').textContent.indexOf('Conectado') === 0, null, { timeout: 30000 });
  const charBefore = await host.evaluate(() => [...game.players.values()][0].charId);
  console.log('sala', code, '· Caro conectada con', charBefore);
  // reinicio del servidor
  execSync('kill ' + execSync("pgrep -f '^node server.js$'").toString().trim().split(/\s+/).join(' '));
  console.log('servidor apagado…');
  await sleep(4000);
  console.log('celular durante la caída:', await ph.evaluate(() => document.getElementById('net-text').textContent), '| pantalla:', await host.evaluate(() => document.getElementById('net-text').textContent));
  const srv = spawn('node', ['server.js'], { cwd: require('path').join(__dirname, '..'), env: Object.assign({}, process.env, { PORT: '3000' }), detached: true, stdio: 'ignore' });
  srv.unref();
  const t0 = Date.now();
  await ph.waitForFunction(() => document.getElementById('net-text').textContent.indexOf('Conectado') === 0, null, { timeout: 60000 });
  await host.waitForFunction(() => [...game.players.values()].every((p) => p.connected), null, { timeout: 30000 });
  const code2 = await host.evaluate(() => document.getElementById('room-code').textContent);
  const charAfter = await host.evaluate(() => [...game.players.values()][0].charId);
  console.log('servidor de vuelta: celular reconectado en', ((Date.now() - t0) / 1000).toFixed(1), 's · sala', code2, code2 === code ? '(misma ✓)' : '(CAMBIÓ ✗)', '· mismo personaje', charAfter === charBefore ? '✓' : '✗', '· jugadores', await host.evaluate(() => game.players.size));
  await b.close();
})().catch((e) => { console.error('FALLO', e.message); process.exit(1); });
