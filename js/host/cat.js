// =====================================================================
//  El Gato-Rueda: cabeza gigante estilo caricatura de los años 20.
//   - Cara 2D (canvas) pintada sobre la tapa frontal de la rueda:
//     ojos "pie-eye", parpadeo, mirada, boca que maúlla, corazones,
//     bigotes; todo late con el beat.
//   - Lado de la rueda: amarillo con rayas granate que giran.
//   - Orejas y brazos de manguera con patas se dibujan en 2D detrás,
//     proyectados desde el mundo 3D, y bailan al ritmo.
// =====================================================================
import * as THREE from 'three';

export const PAL = {
  blue: '#3e46c9', blueDark: '#2c339d', blueLight: '#5660de',
  yellow: '#ffe800', yellowDark: '#e3c600', maroon: '#8a0a22', black: '#141414',
  white: '#fffaf0', red: '#ee2430', pink: '#ff8fa0', cream: '#f6ead0',
};

const FS = 1024;
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

export class CatWheel {
  constructor(scene, R, D) {
    this.R = R; this.D = D;
    this.root = new THREE.Group();
    scene.add(this.root);
    // --- lado de la rueda
    const side = document.createElement('canvas'); side.width = 2048; side.height = 256;
    const g = side.getContext('2d');
    g.fillStyle = PAL.yellow; g.fillRect(0, 0, 2048, 256);
    const n = 22;
    for (let i = 0; i < n; i++) {
      const x = (i + 0.5) * (2048 / n);
      g.fillStyle = PAL.maroon;
      g.beginPath();
      g.moveTo(x - 20, 0); g.quadraticCurveTo(x + 10, 128, x - 6, 256); g.lineTo(x + 22, 256); g.quadraticCurveTo(x + 30, 128, x + 26, 0);
      g.closePath(); g.fill();
    }
    // bordes negros (frente y atrás)
    g.fillStyle = PAL.black; g.fillRect(0, 0, 2048, 10); g.fillRect(0, 246, 2048, 10);
    // línea punteada que divide los carriles (adelante / atrás)
    g.fillStyle = 'rgba(255,250,240,0.85)';
    for (let x = 0; x < 2048; x += 48) g.fillRect(x, 124, 26, 8);
    const sideTex = new THREE.CanvasTexture(side);
    sideTex.colorSpace = THREE.SRGBColorSpace; sideTex.wrapS = THREE.RepeatWrapping; sideTex.anisotropy = 8;
    this.spin = new THREE.Group();
    this.root.add(this.spin);
    const cyl = new THREE.CylinderGeometry(R, R, D, 128, 1, true);
    cyl.rotateX(Math.PI / 2);
    this.spin.add(new THREE.Mesh(cyl, new THREE.MeshBasicMaterial({ map: sideTex })));
    // contorno (casco invertido) del cilindro
    const hull = new THREE.CylinderGeometry(R + 0.09, R + 0.09, D + 0.16, 96, 1, false);
    hull.rotateX(Math.PI / 2);
    this.root.add(new THREE.Mesh(hull, new THREE.MeshBasicMaterial({ color: 0x141414, side: THREE.BackSide })));

    // --- cara (tapa frontal)
    this.faceCanvas = document.createElement('canvas');
    this.faceCanvas.width = this.faceCanvas.height = FS;
    this.fg = this.faceCanvas.getContext('2d');
    this.faceTex = new THREE.CanvasTexture(this.faceCanvas);
    this.faceTex.colorSpace = THREE.SRGBColorSpace; this.faceTex.anisotropy = 8;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(R + 0.09, 128), new THREE.MeshBasicMaterial({ map: this.faceTex }));
    disc.position.z = D / 2 + 0.081;
    this.root.add(disc);

    // estado de animación
    this.blinkT = 2;
    this.blink = 0;
    this.look = 0; this.lookY = 0;
    this.mouth = 0; this.mouthTarget = 0;
    this.mood = 'idle'; this.moodT = 0;
    this.toss = [0, 0]; // animación de lanzamiento de cada pata (0..1)
    this.spinAngle = 0;
    this.time = 0;
    this.emotion = 'idle';   // idle | joy | vibe | surprised | irritated | angry
    this.emoT = 0;           // tiempo desde el último cambio de emoción
    this.anger = 0;          // 0..1 (cara roja)
    this.puffs = [];         // vapor de las orejas
    this.notes = [];         // notas musicales (disfrutando)
  }

  meow(intensity = 1) { this.mouthTarget = Math.max(this.mouthTarget, intensity); this.setMood('meow', 0.7); }
  setMood(m, dur) { this.mood = m; this.moodT = dur; }
  tossPaw(side) { this.toss[side > 0 ? 1 : 0] = 1; }

  update(dt, st) {
    this.time += dt;
    // giro de la rueda
    this.spinAngle -= (st.spinSpeed || 0) * dt;
    this.spin.rotation.z = this.spinAngle;
    // parpadeo
    this.blinkT -= dt;
    if (this.blinkT < 0) { this.blink = 1; this.blinkT = 2.5 + Math.random() * 3; }
    this.blink = Math.max(0, this.blink - dt * 7);
    // mirada
    const lt = st.look !== undefined ? st.look : Math.sin(this.time * 0.7) * 0.5;
    this.look += (lt - this.look) * Math.min(1, dt * 8);
    this.lookY += ((st.lookY || 0) - this.lookY) * Math.min(1, dt * 6);
    // boca
    this.mouth += (this.mouthTarget - this.mouth) * Math.min(1, dt * 18);
    this.mouthTarget = Math.max(0, this.mouthTarget - dt * 1.6);
    if (this.moodT > 0) { this.moodT -= dt; if (this.moodT <= 0) this.mood = 'idle'; }
    for (let i = 0; i < 2; i++) this.toss[i] = Math.max(0, this.toss[i] - dt * 3.2);
    const em = st.emotion || 'idle';
    if (em !== this.emotion) { this.emotion = em; this.emoT = 0; }
    this.emoT += dt;
    this.anger += ((em === 'angry' ? 1 : 0) - this.anger) * Math.min(1, dt * 3);
    this.drawFace(st);
  }

  /** Expresión que se dibuja: el maullido feliz no tapa el enojo/irritación. */
  expr() {
    const e = this.emotion;
    if (this.mood === 'meow' && e !== 'angry' && e !== 'irritated' && e !== 'surprised') return 'meow';
    return e;
  }

  // ------------------------------------------------------------- cara
  drawFace(st) {
    const g = this.fg, c = FS / 2, rad = FS / 2 - 2;
    const beat = st.beat || 0;
    const pulse = Math.pow(1 - beat, 3);
    const bob = -pulse * 10;
    g.clearRect(0, 0, FS, FS);
    g.save();
    g.beginPath(); g.arc(c, c, rad, 0, Math.PI * 2); g.closePath();
    g.fillStyle = PAL.yellow; g.fill();
    g.clip();
    g.translate(c, c);
    // rayas de la frente
    g.fillStyle = PAL.maroon;
    [-95, 0, 95].forEach((x, i) => {
      const len = i === 1 ? 150 : 115;
      g.beginPath();
      g.moveTo(x - 26, -rad - 5); g.lineTo(x + 26, -rad - 5);
      g.quadraticCurveTo(x + 10, -rad + len * 0.6, x, -rad + len);
      g.quadraticCurveTo(x - 10, -rad + len * 0.6, x - 26, -rad - 5);
      g.fill();
    });
    // rayas laterales
    [-1, 1].forEach((sd) => {
      [-260, -175, -90].forEach((y, i) => {
        const ex = Math.sqrt(Math.max(0, rad * rad - y * y));
        const len = 120 - i * 10;
        g.beginPath();
        g.moveTo(sd * (ex + 10), y - 24);
        g.quadraticCurveTo(sd * (ex - len * 0.6), y - 8, sd * (ex - len), y + 4);
        g.quadraticCurveTo(sd * (ex - len * 0.5), y + 14, sd * (ex + 10), y + 22);
        g.fill();
      });
    });
    // enojo: la cara se pone roja
    if (this.anger > 0.02) { g.fillStyle = `rgba(235,40,30,${0.32 * this.anger})`; g.fillRect(-rad, -rad, rad * 2, rad * 2); }
    const E = this.expr();
    g.translate(0, bob);
    // disfrutando: la cabeza (los rasgos) se mece con la música; enojo: tiembla
    if (E === 'vibe') g.rotate(Math.sin((st.beatIndex + beat) * Math.PI / 2) * 0.06);
    if (E === 'angry') g.translate((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 3);
    const pop = Math.min(1, this.emoT / 0.15);
    if (pop < 1) g.scale(1 + (1 - pop) * 0.06, 1 + (1 - pop) * 0.06);
    // ---- cejas
    this.drawBrows(g, E, pulse);
    // ---- ojos
    const eyeY = -215, eyeX = 112;
    const lx = this.look * 18, ly = this.lookY * 14;
    [-1, 1].forEach((sd) => this.drawEye(g, sd * eyeX, eyeY, sd, lx, ly, pulse, E));
    // mejillas
    if (E === 'angry') {
      g.fillStyle = 'rgba(200,10,20,0.55)';
      [-1, 1].forEach((sd) => { g.beginPath(); g.ellipse(sd * 222, -105, 58, 30, 0, 0, Math.PI * 2); g.fill(); });
    } else if (E !== 'irritated') {
      const big = E === 'joy' || E === 'meow' || E === 'vibe' ? 1.3 : E === 'surprised' ? 0.75 : 1;
      const hs = 30 * big * (1 + pulse * (E === 'joy' ? 0.45 : 0.25));
      [-1, 1].forEach((sd) => this.heart(g, sd * 222, -112, hs));
    }
    // nariz
    g.fillStyle = PAL.black;
    g.beginPath(); g.moveTo(-26, -122); g.lineTo(26, -122); g.quadraticCurveTo(4, -92, 0, -88); g.quadraticCurveTo(-4, -92, -26, -122); g.fill();
    // boca
    g.lineWidth = 9; g.lineCap = 'round'; g.strokeStyle = PAL.black;
    const mo = Math.max(this.mouth, E === 'joy' ? 0.55 : 0);
    if (E === 'angry' && this.mouth < 0.5) {
      // dientes apretados
      g.fillStyle = PAL.white;
      g.beginPath(); g.moveTo(-70, -78); g.quadraticCurveTo(0, -96, 70, -78); g.lineTo(62, -38); g.quadraticCurveTo(0, -30, -62, -38); g.closePath();
      g.fill(); g.stroke();
      g.lineWidth = 5;
      g.beginPath(); g.moveTo(-66, -58); g.quadraticCurveTo(0, -66, 66, -58); g.stroke();
      for (let x = -42; x <= 42; x += 21) { g.beginPath(); g.moveTo(x, -84); g.lineTo(x, -36); g.stroke(); }
    } else if (E === 'surprised' && this.mouth < 0.5) {
      g.fillStyle = '#5a0614';
      g.beginPath(); g.ellipse(0, -55, 26, 34, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    } else if (E === 'irritated' && this.mouth < 0.5) {
      g.beginPath(); g.moveTo(-55, -62); g.quadraticCurveTo(-25, -70, 0, -60); g.quadraticCurveTo(25, -50, 60, -68); g.stroke();
    } else if (E === 'vibe' && this.mouth < 0.3) {
      // sonrisa tranquila, "tarareando"
      g.beginPath(); g.moveTo(-50, -74); g.quadraticCurveTo(-25, -48, 0, -70); g.quadraticCurveTo(25, -48, 50, -74); g.stroke();
      g.fillStyle = '#5a0614'; g.beginPath(); g.ellipse(0, -50, 9 + pulse * 4, 11 + pulse * 5, 0, 0, Math.PI * 2); g.fill();
    } else if (mo > 0.08) {
      const mh = 30 + 70 * mo, mw = 42 + 26 * mo;
      g.fillStyle = '#5a0614';
      g.beginPath();
      g.moveTo(-mw, -82);
      g.quadraticCurveTo(-mw * 1.05, -82 + mh, 0, -82 + mh * 1.1);
      g.quadraticCurveTo(mw * 1.05, -82 + mh, mw, -82);
      g.quadraticCurveTo(0, -70, -mw, -82);
      g.fill(); g.stroke();
      g.fillStyle = PAL.red;
      g.beginPath(); g.ellipse(0, -82 + mh * 0.82, mw * 0.55, mh * 0.25, 0, 0, Math.PI * 2); g.fill();
    } else {
      g.beginPath();
      g.moveTo(-58, -80); g.quadraticCurveTo(-30, -36, 0, -76);
      g.quadraticCurveTo(30, -36, 58, -80);
      g.stroke();
    }
    // bigotes
    g.lineWidth = 6;
    const wig = Math.sin(this.time * 9) * 4 + pulse * 6;
    [-1, 1].forEach((sd) => {
      [[-62, -78 - wig], [-48, -44], [-34, -8 + wig]].forEach(([y0, y1], i) => {
        g.beginPath(); g.moveTo(sd * 110, y0); g.lineTo(sd * 330, y1); g.stroke();
      });
    });
    g.restore();
    // borde negro grueso
    g.lineWidth = 20; g.strokeStyle = PAL.black;
    g.beginPath(); g.arc(c, c, rad - 9, 0, Math.PI * 2); g.stroke();
    this.faceTex.needsUpdate = true;
  }

  drawEye(g, x, y, sd, lx, ly, pulse, E) {
    const rx = 84, ry = 112 * (1 + pulse * 0.05);
    g.save(); g.translate(x, y);
    g.lineWidth = 11; g.strokeStyle = PAL.black; g.lineCap = 'round';
    const mood = E || this.mood;
    if (mood === 'vibe') { // ojos cerrados disfrutando la canción, con pestañas
      g.lineWidth = 13;
      g.beginPath(); g.moveTo(-rx * 0.85, 0); g.quadraticCurveTo(0, 55, rx * 0.85, 0); g.stroke();
      g.lineWidth = 7;
      [[-0.55, 0.32], [0, 0.42], [0.55, 0.32]].forEach(([a, b]) => { g.beginPath(); g.moveTo(a * rx, b * 60); g.lineTo(a * rx * 1.25, b * 60 + 26); g.stroke(); });
      g.restore(); return;
    }
    if (this.blink > 0.4 && mood !== 'meow' && mood !== 'angry' && mood !== 'surprised') {
      g.beginPath(); g.moveTo(-rx, 10); g.quadraticCurveTo(0, 60, rx, 10); g.stroke();
      g.restore(); return;
    }
    if (mood === 'meow') { // ojos felices ^ ^
      g.lineWidth = 16;
      g.beginPath(); g.moveTo(-rx * 0.85, 30); g.quadraticCurveTo(0, -90, rx * 0.85, 30); g.stroke();
      g.restore(); return;
    }
    const sq = mood === 'surprised' ? 1.12 : 1;
    g.fillStyle = PAL.white;
    g.beginPath(); g.ellipse(0, 0, rx * sq, ry * sq, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    if (mood === 'dizzy') {
      g.lineWidth = 8;
      g.beginPath();
      for (let a = 0; a < Math.PI * 6; a += 0.2) {
        const r = 6 + a * 3.6; const ang = a + this.time * 8 * sd;
        const px = Math.cos(ang) * r, py = Math.sin(ang) * r * 1.2;
        if (a === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.stroke(); g.restore(); return;
    }
    // pupila "pie-eye" con la cuña blanca
    const pr = mood === 'surprised' ? 0.7 : mood === 'angry' ? 0.62 : mood === 'irritated' ? 0.8 : 1;
    const side = mood === 'irritated' ? 26 * (this.look >= 0 ? 1 : -1) : 0; // mirada de reojo
    const px = lx + side, py = 18 + ly + (mood === 'irritated' ? 28 : 0);
    const prx = 58 * pr, pry = 86 * pr;
    const w0 = -1.25, w1 = -0.55; // cuña (ángulos)
    g.fillStyle = PAL.black;
    g.beginPath();
    g.moveTo(px + Math.cos(w0) * prx * 0.25, py + Math.sin(w0) * pry * 0.25);
    g.ellipse(px, py, prx, pry, 0, w1, w0 + Math.PI * 2);
    g.closePath(); g.fill();
    if (mood === 'joy') { // brillo extra de alegría
      g.fillStyle = PAL.white;
      g.beginPath(); g.arc(px - prx * 0.35, py + pry * 0.45, 11, 0, Math.PI * 2); g.fill();
    }
    // párpados: irritado (a media asta) / enojado (inclinado hacia adentro)
    if (mood === 'irritated' || mood === 'angry') {
      g.save();
      g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); g.clip();
      // mismo color que la cara (amarillo + el tinte rojo del enojo)
      const a = 0.32 * this.anger;
      g.fillStyle = `rgb(${Math.round(255 * (1 - a) + 235 * a)},${Math.round(232 * (1 - a) + 40 * a)},${Math.round(30 * a)})`;
      g.beginPath();
      if (mood === 'irritated') { g.rect(-rx - 5, -ry - 5, rx * 2 + 10, ry * 0.95); }
      else {
        // párpado inclinado: alto por fuera, bajo hacia la nariz (sin cruzarse)
        const yR = sd > 0 ? -ry * 0.75 : -ry * 0.05, yL = sd > 0 ? -ry * 0.05 : -ry * 0.75;
        g.moveTo(-rx - 5, -ry - 5); g.lineTo(rx + 5, -ry - 5); g.lineTo(rx + 5, yR); g.lineTo(-rx - 5, yL); g.closePath();
      }
      g.fill();
      g.lineWidth = 12; g.strokeStyle = PAL.black;
      g.beginPath();
      if (mood === 'irritated') { g.moveTo(-rx, -ry * 0.05); g.lineTo(rx, -ry * 0.05); }
      else { const yR = sd > 0 ? -ry * 0.75 : -ry * 0.05, yL = sd > 0 ? -ry * 0.05 : -ry * 0.75; g.moveTo(rx + 5, yR); g.lineTo(-rx - 5, yL); }
      g.stroke();
      g.restore();
      g.lineWidth = 11; g.strokeStyle = PAL.black;
      g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); g.stroke();
    }
    g.restore();
  }

  /** Cejas: el arma secreta de la expresividad en las caricaturas. */
  drawBrows(g, E, pulse) {
    g.save();
    g.strokeStyle = PAL.black; g.lineCap = 'round';
    [-1, 1].forEach((sd) => {
      let y = -362, tilt = 0, arch = 22, w = 13;
      if (E === 'joy' || E === 'meow') { y = -378 - pulse * 8; arch = 30; }
      else if (E === 'vibe') { y = -352; arch = 16; }
      else if (E === 'surprised') { y = -395; arch = 34; }
      else if (E === 'irritated') { if (sd < 0) { y = -335; tilt = 0.05; arch = 4; } else { y = -380; tilt = -0.18; arch = 26; } }
      else if (E === 'angry') { y = -335; tilt = 0.42; arch = -8; w = 18; }
      const cx = sd * 112;
      g.lineWidth = w;
      g.save(); g.translate(cx, y); g.rotate(sd * tilt);
      g.beginPath(); g.moveTo(-58, 0); g.quadraticCurveTo(0, -arch, 58, 0); g.stroke();
      g.restore();
    });
    g.restore();
  }

  heart(g, x, y, s) {
    g.save(); g.translate(x, y); g.fillStyle = PAL.red;
    g.beginPath();
    g.moveTo(0, s * 0.9);
    g.bezierCurveTo(-s * 1.3, 0, -s * 0.7, -s, 0, -s * 0.35);
    g.bezierCurveTo(s * 0.7, -s, s * 1.3, 0, 0, s * 0.9);
    g.fill(); g.restore();
  }

  // ---------------------------------------------- fondo, orejas y brazos
  /**
   * proj(x,y,z) -> {x,y} en píxeles CSS. unit = píxeles por unidad a la
   * profundidad de la parte trasera.
   */
  drawBackdrop(ctx, W, H, proj, st) {
    const beat = st.beat || 0, bi = st.beatIndex || 0;
    const pulse = Math.pow(1 - beat, 3);
    const R = this.R, D = this.D, zb = -D / 2;
    const C0 = proj(0, 0, zb), CT = proj(0, R, zb);
    const k = R / 10;
    const unit = Math.abs(CT.y - C0.y) / R * k; // píxeles por 'unidad de dibujo' (escalada con R)

    // fondo con rayos de sol; el color cambia suave según la sección de la canción
    const tgt = hexRgb(st.bg || PAL.blue);
    if (!this.bgRGB) this.bgRGB = tgt.slice();
    for (let i = 0; i < 3; i++) this.bgRGB[i] += (tgt[i] - this.bgRGB[i]) * Math.min(1, (st.dt || 0.016) * 1.6);
    const [br, bgc, bb] = this.bgRGB.map(Math.round);
    ctx.fillStyle = `rgb(${br},${bgc},${bb})`; ctx.fillRect(0, 0, W, H);
    const lr = Math.round(br + (255 - br) * 0.28), lg = Math.round(bgc + (255 - bgc) * 0.28), lb = Math.round(bb + (255 - bb) * 0.28);
    ctx.save();
    ctx.translate(C0.x, C0.y);
    ctx.rotate(this.time * 0.05 * (st.dir || 1));
    const rays = 18;
    ctx.fillStyle = `rgba(${lr},${lg},${lb},${0.22 + pulse * 0.1})`;
    for (let i = 0; i < rays; i++) {
      const a0 = (i / rays) * Math.PI * 2, a1 = a0 + Math.PI / rays;
      ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a0) * 4000, Math.sin(a0) * 4000); ctx.lineTo(Math.cos(a1) * 4000, Math.sin(a1) * 4000);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();

    // ---- orejas (detrás de la cabeza)
    [-1, 1].forEach((sd) => {
      const ang = 0.78;
      const base = proj(sd * Math.sin(ang) * (R - 0.8 * k), Math.cos(ang) * (R - 0.8 * k), zb);
      const wig = (bi % 2 === (sd > 0 ? 0 : 1) ? pulse : 0) * 0.12;
      ctx.save();
      ctx.translate(base.x, base.y);
      ctx.rotate(sd * (0.55 + wig) + Math.sin(this.time * 2 + sd) * 0.03);
      const w = 3.6 * unit, h = 4.6 * unit;
      ctx.lineJoin = 'round';
      ctx.fillStyle = PAL.yellow; ctx.strokeStyle = PAL.black; ctx.lineWidth = Math.max(4, unit * 0.22);
      ctx.beginPath();
      ctx.moveTo(-w / 2, h * 0.25);
      ctx.quadraticCurveTo(-w * 0.55, -h * 0.5, sd * w * 0.08, -h);
      ctx.quadraticCurveTo(w * 0.55, -h * 0.5, w / 2, h * 0.25);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = PAL.black;
      ctx.beginPath();
      ctx.moveTo(-w * 0.28, h * 0.05);
      ctx.quadraticCurveTo(-w * 0.3, -h * 0.45, sd * w * 0.06, -h * 0.78);
      ctx.quadraticCurveTo(w * 0.3, -h * 0.45, w * 0.28, h * 0.05);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    });

    // ---- líneas de movimiento alrededor de la cabeza
    ctx.strokeStyle = PAL.black; ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2, unit * 0.12);
    const ml = 0.5 + pulse * 0.6;
    [-1, 1].forEach((sd) => {
      for (let kk = 0; kk < 3; kk++) {
        const a = 0.95 + kk * 0.22;
        const r1 = R + (0.7 + kk * 0.1) * k, r2 = r1 + ml * k;
        const p1 = proj(sd * Math.sin(a) * r1, Math.cos(a) * r1, zb), p2 = proj(sd * Math.sin(a + 0.08) * r2, Math.cos(a + 0.08) * r2, zb);
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.quadraticCurveTo((p1.x + p2.x) / 2 + sd * 6, (p1.y + p2.y) / 2, p2.x, p2.y); ctx.stroke();
      }
    });

    // ---- vapor por las orejas (enojo) y notas musicales (disfrutando)
    const dtb = st.dt || 0.016;
    const E = this.expr();
    if (E === 'angry' && Math.random() < 0.35) {
      const sd = Math.random() < 0.5 ? -1 : 1;
      const tip = proj(sd * Math.sin(0.78) * (R + 2.6 * k), Math.cos(0.78) * (R + 2.6 * k) + 1.6 * k, zb);
      this.puffs.push({ x: tip.x, y: tip.y, vx: sd * (20 + Math.random() * 30), vy: -60 - Math.random() * 40, t: 0, life: 0.9, r: unit * (0.35 + Math.random() * 0.3) });
    }
    if (E === 'vibe' && Math.random() < 0.06) {
      const sd = Math.random() < 0.5 ? -1 : 1;
      const p0 = proj(sd * (R * 0.75 + Math.random() * 2 * k), R * 0.85, zb);
      this.notes.push({ x: p0.x, y: p0.y, vx: sd * 15, t: 0, life: 2.2, ch: Math.random() < 0.5 ? '♪' : '♫', s: unit * (1.1 + Math.random() * 0.6) });
    }
    this.puffs = this.puffs.filter((p) => (p.t += dtb) < p.life);
    this.puffs.forEach((p) => {
      p.x += p.vx * dtb; p.y += p.vy * dtb;
      ctx.globalAlpha = 1 - p.t / p.life;
      ctx.fillStyle = '#f4f1e6'; ctx.strokeStyle = PAL.black; ctx.lineWidth = Math.max(2, unit * 0.1);
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 + p.t), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.globalAlpha = 1;
    });
    this.notes = this.notes.filter((n) => (n.t += dtb) < n.life);
    this.notes.forEach((n) => {
      ctx.globalAlpha = Math.min(1, (n.life - n.t) / 0.5);
      ctx.font = `${Math.round(n.s)}px serif`; ctx.textAlign = 'center';
      ctx.fillStyle = PAL.black;
      ctx.fillText(n.ch, n.x + n.vx * n.t + Math.sin(n.t * 4) * unit * 0.6, n.y - n.t * unit * 2.5);
      ctx.globalAlpha = 1;
    });

    // ---- brazos de manguera con patas (bailan distinto según la emoción)
    [-1, 1].forEach((sd, i) => {
      const myBeat = (bi + i) % 2 === 0;
      let up = myBeat ? pulse : pulse * 0.3;
      if (E === 'joy' || E === 'meow') up = pulse * 1.4;                       // aplaude/agita las dos
      else if (E === 'vibe') up = 0.5 + Math.sin(this.time * 1.6 + i * Math.PI) * 0.6; // ondea lento
      else if (E === 'irritated') up = i === 1 && bi % 2 === 0 ? pulse * 0.5 : 0;    // golpecito impaciente
      else if (E === 'angry') up = 0.8 + (Math.random() - 0.5) * 0.5;              // puños temblando
      const toss = this.toss[i];
      const tossE = Math.sin(toss * Math.PI);
      const base = proj(sd * (R * 0.9), -R * 0.55, zb - 0.3);
      let pw = { x: sd * (R + 3.4 * k) - sd * tossE * 2.2 * k, y: R + 2.2 * k + up * 1.1 * k - tossE * 3.0 * k };
      pw.x += Math.sin(this.time * 2.2 + i) * 0.35 * k;
      const paw = proj(pw.x, pw.y, zb - 0.3);
      const thick = 1.25 * unit;
      // curva en S que ondula con el tiempo (como en la referencia)
      const wv = (Math.sin(this.time * 3 + i * 2) * 1.6 + (myBeat ? pulse * 1.2 : 0)) * k;
      const c1 = proj(sd * (R + 4.6 * k + wv), R * 0.05, zb - 0.3);
      const c2 = proj(sd * (R + 1.2 * k - wv), R * 0.75, zb - 0.3);
      const path = () => { ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, paw.x, paw.y); };
      ctx.lineCap = 'round';
      path(); ctx.strokeStyle = PAL.black; ctx.lineWidth = thick + Math.max(6, unit * 0.32); ctx.stroke();
      path(); ctx.strokeStyle = PAL.yellow; ctx.lineWidth = thick; ctx.stroke();
      // pata
      const ang = Math.atan2(paw.y - c2.y, paw.x - c2.x) + Math.PI / 2;
      this.drawPaw(ctx, paw.x, paw.y, unit * 1.05 * (1 + up * 0.12), ang, sd, E === 'angry');
      // líneas de movimiento junto a la pata
      ctx.strokeStyle = PAL.black; ctx.lineWidth = Math.max(2, unit * 0.12);
      for (let k = 0; k < 3; k++) {
        const a0 = -Math.PI / 2 - sd * (0.9 + k * 0.35);
        const rr = unit * (2.0 + up * 0.5);
        ctx.beginPath(); ctx.arc(paw.x, paw.y, rr, a0 - 0.12, a0 + 0.12); ctx.stroke();
      }
    });
  }

  drawPaw(ctx, x, y, s, ang, sd, fist) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    if (fist) { // puño cerrado: dedos recogidos
      ctx.strokeStyle = PAL.black; ctx.lineWidth = Math.max(4, s * 0.2); ctx.fillStyle = PAL.yellow;
      ctx.beginPath(); ctx.ellipse(0, -0.5 * s, 1.35 * s, 1.25 * s, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.lineWidth = Math.max(3, s * 0.15);
      [-0.7, 0, 0.7].forEach((xx) => { ctx.beginPath(); ctx.moveTo(xx * s, -1.6 * s); ctx.lineTo(xx * s, -0.8 * s); ctx.stroke(); });
      ctx.restore(); return;
    }
    ctx.strokeStyle = PAL.black; ctx.lineWidth = Math.max(4, s * 0.2); ctx.lineJoin = 'round';
    ctx.fillStyle = PAL.yellow;
    // dedos + palma
    const toes = [[-0.95, -1.15, 0.55], [-0.32, -1.6, 0.6], [0.35, -1.6, 0.6], [0.97, -1.15, 0.55]];
    ctx.beginPath(); ctx.ellipse(0, -0.2 * s, 1.35 * s, 1.2 * s, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    toes.forEach(([tx, ty, r]) => { ctx.beginPath(); ctx.arc(tx * s, ty * s, r * s, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); });
    ctx.beginPath(); ctx.ellipse(0, -0.2 * s, 1.3 * s, 1.12 * s, 0, 0, Math.PI * 2); ctx.fill();
    // almohadillas
    ctx.fillStyle = PAL.maroon;
    toes.forEach(([tx, ty, r]) => { ctx.beginPath(); ctx.ellipse(tx * s, (ty + 0.05) * s, r * 0.55 * s, r * 0.65 * s, 0, 0, Math.PI * 2); ctx.fill(); });
    ctx.beginPath();
    ctx.moveTo(0, 0.55 * s);
    ctx.bezierCurveTo(-1.0 * s, 0.55 * s, -0.85 * s, -0.55 * s, 0, -0.35 * s);
    ctx.bezierCurveTo(0.85 * s, -0.55 * s, 1.0 * s, 0.55 * s, 0, 0.55 * s);
    ctx.fill();
    ctx.restore();
  }
}
