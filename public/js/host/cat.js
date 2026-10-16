// =====================================================================
//  El Gato-Rueda: cabeza gigante estilo caricatura de los años 20.
//  Diseño de la hoja de personaje "Gato Swing":
//   - Cabeza negra con máscara crema (ojos + hocico + mejillas) y pico
//     negro entre los ojos; ojos "pie-eye", nariz negra, lengua rosa,
//     bigotes blancos. Las "cejas" son el borde de la máscara.
//   - 10 expresiones: normal, feliz, riendo (maullido), guiño, sorprendido,
//     enojado, escéptico (irritado), triste, aturdido y "disfrutando"
//     (ojos cerrados cuando el grupo va en racha).
//   - Lado de la rueda crema con rayas rojas; orejas negras con interior
//     rosa; brazos de manguera negros con guantes blancos que bailan.
// =====================================================================
import * as THREE from 'three';

export const PAL = {
  blue: '#3e46c9', blueDark: '#2c339d', blueLight: '#5660de',
  yellow: '#ffe800', yellowDark: '#e3c600', maroon: '#8a0a22', black: '#141414',
  white: '#fffaf0', red: '#e3262f', pink: '#ff8fa0', cream: '#f6ead0',
  // paleta de la hoja de personaje
  fur: '#17171a', furHi: '#3a3a42', gray: '#8c8c94', skin: '#f3e3c3', skinShade: '#d9c39c',
  rose: '#f48aa4', tongue: '#ef5d7c', mouthIn: '#5a0614', glove: '#fbf8f0',
};

const FS = 1024;
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
const SKIN = hexRgb(PAL.skin);

export class CatWheel {
  constructor(scene, R, D) {
    this.R = R; this.D = D;
    this.root = new THREE.Group();
    scene.add(this.root);
    // --- lado de la rueda: crema con rayas rojas de manguera
    const side = document.createElement('canvas'); side.width = 2048; side.height = 256;
    const g = side.getContext('2d');
    g.fillStyle = PAL.skin; g.fillRect(0, 0, 2048, 256);
    const n = 22;
    for (let i = 0; i < n; i++) {
      const x = (i + 0.5) * (2048 / n);
      g.fillStyle = PAL.red;
      g.beginPath();
      g.moveTo(x - 20, 0); g.quadraticCurveTo(x + 10, 128, x - 6, 256); g.lineTo(x + 22, 256); g.quadraticCurveTo(x + 30, 128, x + 26, 0);
      g.closePath(); g.fill();
    }
    // sombra gris suave junto a los bordes
    const sh = g.createLinearGradient(0, 0, 0, 256);
    sh.addColorStop(0, 'rgba(60,50,40,0.28)'); sh.addColorStop(0.18, 'rgba(60,50,40,0)');
    sh.addColorStop(0.82, 'rgba(60,50,40,0)'); sh.addColorStop(1, 'rgba(60,50,40,0.28)');
    g.fillStyle = sh; g.fillRect(0, 0, 2048, 256);
    // bordes negros (frente y atrás)
    g.fillStyle = PAL.black; g.fillRect(0, 0, 2048, 12); g.fillRect(0, 244, 2048, 12);
    // línea punteada que divide los carriles (adelante / atrás)
    g.fillStyle = 'rgba(20,20,20,0.6)';
    for (let x = 0; x < 2048; x += 48) g.fillRect(x, 124, 26, 8);
    const sideTex = new THREE.CanvasTexture(side);
    sideTex.colorSpace = THREE.SRGBColorSpace; sideTex.wrapS = THREE.RepeatWrapping; sideTex.anisotropy = 8;
    this.sideTex = sideTex;
    this.tamborTex = this.makeTamborTex();
    this.spin = new THREE.Group();
    this.root.add(this.spin);
    const cyl = new THREE.CylinderGeometry(R, R, D, 128, 1, true);
    cyl.rotateX(Math.PI / 2);
    this.sideMesh = new THREE.Mesh(cyl, new THREE.MeshBasicMaterial({ map: sideTex }));
    this.spin.add(this.sideMesh);
    // contorno (casco invertido) del cilindro
    const hull = new THREE.CylinderGeometry(R + 0.09, R + 0.09, D + 0.16, 128, 1, false);
    hull.rotateX(Math.PI / 2);
    this.hullMesh = new THREE.Mesh(hull, new THREE.MeshBasicMaterial({ color: 0x141414, side: THREE.BackSide }));
    this.root.add(this.hullMesh);

    // --- cara (tapa frontal)
    this.faceCanvas = document.createElement('canvas');
    this.faceCanvas.width = this.faceCanvas.height = FS;
    this.fg = this.faceCanvas.getContext('2d');
    this.faceTex = new THREE.CanvasTexture(this.faceCanvas);
    this.faceTex.colorSpace = THREE.SRGBColorSpace; this.faceTex.anisotropy = 8;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(R + 0.09, 128), new THREE.MeshBasicMaterial({ map: this.faceTex }));
    disc.position.z = D / 2 + 0.081;
    this.root.add(disc);
    this.discMesh = disc;
    // posiciones originales (para las ondas de la serpiente)
    [this.sideMesh, this.hullMesh, this.discMesh].forEach((m) => { m.userData.base = Float32Array.from(m.geometry.attributes.position.array); });
    this.wave = { A: 0, n: 12 };
    this.sideStyle = 'classic';

    // estado de animación
    this.blinkT = 2;
    this.blink = 0;
    this.look = 0; this.lookY = 0;
    this.mouth = 0; this.mouthTarget = 0;
    this.mood = 'idle'; this.moodT = 0;
    this.toss = [0, 0]; // animación de lanzamiento de cada pata (0..1)
    this.spinAngle = 0;
    this.time = 0;
    this.emotion = 'idle';   // idle | joy | vibe | surprised | irritated | angry | wink | sad | dizzy
    this.emoT = 0;           // tiempo desde el último cambio de emoción
    this.anger = 0;          // 0..1 (máscara roja)
    this.puffs = [];         // vapor de las orejas
    this.notes = [];         // notas musicales (disfrutando)
  }

  /** Lado de la rueda con 4 carriles de colores (modo tambor). Arriba del lienzo = carril de adelante. */
  makeTamborTex() {
    const c = document.createElement('canvas'); c.width = 2048; c.height = 256;
    const g = c.getContext('2d');
    const cols = ['#e3262f', '#ffb000', '#2fbf71', '#3e7bff']; // batería, bajo, voz, otros (adelante → atrás)
    const bh = 256 / 4;
    cols.forEach((col, i) => {
      g.fillStyle = col; g.fillRect(0, i * bh, 2048, bh);
      g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(0, i * bh + bh * 0.3, 2048, bh * 0.25);
      g.fillStyle = 'rgba(0,0,0,0.18)';
      for (let x = 0; x < 2048; x += 64) g.fillRect(x, i * bh, 22, bh);
    });
    g.fillStyle = '#141414';
    for (let i = 1; i < 4; i++) g.fillRect(0, i * bh - 4, 2048, 8);
    g.fillRect(0, 0, 2048, 10); g.fillRect(0, 246, 2048, 10);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 8;
    return t;
  }
  setSideStyle(style) {
    if (style === this.sideStyle) return;
    this.sideStyle = style;
    this.sideMesh.material.map = style === 'tambor' ? this.tamborTex : this.sideTex;
    this.sideMesh.material.needsUpdate = true;
  }

  /**
   * Ondas de la serpiente: el borde de la cabeza ondula. La onda está fija
   * en el lado que gira (viaja con los obstáculos) → alto en el mundo:
   *   A·sin(n·(φ + spinAngle)), φ = ángulo desde la cima (x = sin φ).
   */
  setWave(A, n) {
    const W = this.wave;
    if (A < 0.002 && W.A < 0.002) { W.A = 0; return; }
    W.A = A; W.n = n;
    const spinA = this.spinAngle;
    const def = (mesh, rotating) => {
      const pos = mesh.geometry.attributes.position, base = mesh.userData.base;
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3], y = base[i * 3 + 1];
        const r = Math.hypot(x, y);
        if (r < 1e-4) { pos.array[i * 3] = x; pos.array[i * 3 + 1] = y; continue; }
        const phi = Math.atan2(x, y);
        const k = 1 + (A * Math.sin(n * (rotating ? phi : phi + spinA))) / r;
        pos.array[i * 3] = x * k; pos.array[i * 3 + 1] = y * k;
      }
      pos.needsUpdate = true;
    };
    def(this.sideMesh, true); def(this.hullMesh, false); def(this.discMesh, false);
  }
  /** Altura de la onda en el ángulo φ del mundo. */
  waveAt(phi) { const W = this.wave; return W.A ? W.A * Math.sin(W.n * (phi + this.spinAngle)) : 0; }

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

  /** Expresión que se dibuja: el maullido feliz no tapa las emociones fuertes. */
  expr() {
    const e = this.emotion;
    if (this.mood === 'meow' && !['angry', 'irritated', 'surprised', 'sad', 'dizzy', 'wink'].includes(e)) return 'meow';
    if (this.mood === 'dizzy') return 'dizzy';
    return e;
  }

  // ------------------------------------------------------------- cara
  /** Ceja = borde superior de la máscara sobre cada ojo. */
  browParams(E, sd, pulse) {
    let y = -362, inDy = 0, outDy = 0, arch = 22;
    switch (E) {
      case 'joy': case 'meow': y = -378 - pulse * 8; arch = 30; break;
      case 'vibe': y = -352; arch = 16; break;
      case 'surprised': y = -402; arch = 38; break;
      case 'irritated': if (sd < 0) { y = -340; arch = 3; } else { y = -392; arch = 30; outDy = -12; } break; // escéptico
      case 'angry': y = -350; inDy = 42; outDy = -38; arch = -4; break;
      case 'sad': y = -362; inDy = -38; outDy = 28; arch = 8; break;
      case 'wink': if (sd > 0) { y = -342; arch = 10; } else { y = -388; arch = 30; } break;
      case 'dizzy': y = sd < 0 ? -384 : -350; arch = 20; inDy = Math.sin(this.time * 5) * 12 * sd; break;
    }
    return { y, inDy, outDy, arch };
  }

  /** Máscara crema (una sola ruta, misma orientación => unión). */
  maskPath(g, E, pulse) {
    const ex = 112, ey = -215, pw = 136;
    g.beginPath();
    [-1, 1].forEach((sd) => {
      const b = this.browParams(E, sd, pulse);
      const cx = sd * ex;
      const xl = cx - pw, xr = cx + pw;
      // inner = lado de la nariz
      const yl = b.y + (sd > 0 ? b.inDy : b.outDy), yr = b.y + (sd > 0 ? b.outDy : b.inDy);
      // contorno redondeado (como un huevo) con la ceja como borde superior
      g.moveTo(xl + 14, yl);
      g.quadraticCurveTo(cx, b.y - b.arch * 2 + (yl + yr - 2 * b.y) / 2, xr - 14, yr);
      g.bezierCurveTo(xr + 26, yr + 18, xr + 34, ey - 10, xr + 10, ey + 80);
      g.quadraticCurveTo(cx, ey + 210, xl - 10, ey + 80);
      g.bezierCurveTo(xl - 34, ey - 10, xl - 26, yl + 18, xl + 14, yl);
      g.closePath();
    });
    // hocico y mejillas infladas
    g.moveTo(255, -75); g.ellipse(0, -75, 255, 128, 0, 0, Math.PI * 2);
    [-1, 1].forEach((sd) => { const x = sd * 205; g.moveTo(x + 128, -112); g.ellipse(x, -112, 128, 98, 0, 0, Math.PI * 2); });
  }

  drawFace(st) {
    const g = this.fg, c = FS / 2, rad = FS / 2 - 2;
    const beat = st.beat || 0;
    const pulse = Math.pow(1 - beat, 3);
    const bob = -pulse * 10;
    g.clearRect(0, 0, FS, FS);
    g.save();
    g.beginPath(); g.arc(c, c, rad, 0, Math.PI * 2); g.closePath();
    // pelaje negro con brillo gris (volumen)
    const fur = g.createRadialGradient(c - rad * 0.38, c - rad * 0.45, rad * 0.05, c, c, rad);
    fur.addColorStop(0, PAL.furHi); fur.addColorStop(0.55, PAL.fur); fur.addColorStop(1, '#0b0b0d');
    g.fillStyle = fur; g.fill();
    g.clip();
    g.translate(c, c);
    // reflejo de caricatura (arco blanco arriba a la izquierda)
    g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = 16; g.lineCap = 'round';
    g.beginPath(); g.arc(0, 0, rad - 52, Math.PI * 1.13, Math.PI * 1.36); g.stroke();
    const E = this.expr();
    g.translate(0, bob);
    // disfrutando: los rasgos se mecen; enojo: tiembla; aturdido: tambalea
    if (E === 'vibe') g.rotate(Math.sin((st.beatIndex + beat) * Math.PI / 2) * 0.06);
    if (E === 'angry') g.translate((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 3);
    if (E === 'dizzy') g.rotate(Math.sin(this.time * 3.2) * 0.08);
    if (E === 'sad') g.translate(0, 14);
    const pop = Math.min(1, this.emoT / 0.15);
    if (pop < 1) g.scale(1 + (1 - pop) * 0.06, 1 + (1 - pop) * 0.06);

    // ---- máscara crema
    this.maskPath(g, E, pulse);
    g.fillStyle = PAL.skin; g.fill('nonzero');
    if (this.anger > 0.02) { g.fillStyle = `rgba(235,40,30,${0.34 * this.anger})`; g.fill('nonzero'); }
    // sombra gris bajo el hocico
    g.save(); this.maskPath(g, E, pulse); g.clip();
    g.fillStyle = 'rgba(150,120,80,0.22)';
    g.beginPath(); g.ellipse(0, 70, 300, 70, 0, 0, Math.PI * 2); g.fill();
    g.restore();
    // pico negro entre los ojos
    g.fillStyle = PAL.fur;
    g.beginPath();
    g.moveTo(-52, -520); g.lineTo(52, -520);
    g.quadraticCurveTo(14, -360, 0, -268);
    g.quadraticCurveTo(-14, -360, -52, -520);
    g.fill();

    // ---- ojos
    const eyeY = -215, eyeX = 112;
    let lx = this.look * 18, ly = this.lookY * 14;
    if (E === 'sad') ly += 26;
    [-1, 1].forEach((sd) => this.drawEye(g, sd * eyeX, eyeY, sd, lx, ly, pulse, E));
    // lágrima (triste)
    if (E === 'sad') {
      const ph = (this.time * 0.8) % 1;
      const tx = -eyeX - 52, ty = eyeY + 96 + ph * 150;
      g.globalAlpha = Math.min(1, (1 - ph) * 3);
      g.fillStyle = '#8fd6ff'; g.strokeStyle = PAL.black; g.lineWidth = 6;
      g.beginPath(); g.moveTo(tx, ty - 34); g.quadraticCurveTo(tx + 24, ty, tx, ty + 18); g.quadraticCurveTo(tx - 24, ty, tx, ty - 34);
      g.fill(); g.stroke(); g.globalAlpha = 1;
    }
    // mejillas
    if (E === 'angry') {
      g.fillStyle = 'rgba(200,10,20,0.5)';
      [-1, 1].forEach((sd) => { g.beginPath(); g.ellipse(sd * 222, -105, 58, 30, 0, 0, Math.PI * 2); g.fill(); });
    } else if (E === 'joy' || E === 'meow') {
      const hs = 30 * 1.25 * (1 + pulse * 0.4);
      [-1, 1].forEach((sd) => this.heart(g, sd * 222, -112, hs));
    } else if (E !== 'irritated' && E !== 'dizzy') {
      const k = E === 'vibe' || E === 'wink' ? 1.2 : E === 'sad' ? 0.7 : 1;
      g.fillStyle = `rgba(244,138,164,${0.55 + pulse * 0.2})`;
      [-1, 1].forEach((sd) => { g.beginPath(); g.ellipse(sd * 222, -108, 50 * k, 28 * k, 0, 0, Math.PI * 2); g.fill(); });
    }
    // nariz (negra, con brillo)
    g.fillStyle = PAL.black;
    g.beginPath(); g.moveTo(-30, -126); g.quadraticCurveTo(0, -136, 30, -126); g.quadraticCurveTo(10, -92, 0, -88); g.quadraticCurveTo(-10, -92, -30, -126); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.75)'; g.beginPath(); g.ellipse(-10, -122, 9, 5, -0.2, 0, Math.PI * 2); g.fill();
    // boca
    this.drawMouth(g, E, pulse);
    // bigotes blancos (con contorno oscuro para leerse sobre crema y negro)
    const wig = Math.sin(this.time * 9) * 4 + pulse * 6;
    const droop = E === 'sad' ? 26 : E === 'surprised' ? -18 : 0;
    [-1, 1].forEach((sd) => {
      [[-62, -82 - wig], [-48, -48], [-34, -10 + wig]].forEach(([y0, y1]) => {
        const y2 = y1 + droop;
        g.lineCap = 'round';
        g.strokeStyle = PAL.black; g.lineWidth = 13;
        g.beginPath(); g.moveTo(sd * 140, y0); g.lineTo(sd * 345, y2); g.stroke();
        g.strokeStyle = PAL.glove; g.lineWidth = 6;
        g.beginPath(); g.moveTo(sd * 140, y0); g.lineTo(sd * 345, y2); g.stroke();
      });
    });
    g.restore();
    // borde: negro grueso con filo gris
    g.lineWidth = 20; g.strokeStyle = PAL.black;
    g.beginPath(); g.arc(c, c, rad - 9, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 4; g.strokeStyle = 'rgba(140,140,150,0.6)';
    g.beginPath(); g.arc(c, c, rad - 22, 0, Math.PI * 2); g.stroke();
    this.faceTex.needsUpdate = true;
  }

  drawMouth(g, E, pulse) {
    g.lineWidth = 9; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = PAL.black;
    const mo = Math.max(this.mouth, E === 'joy' ? 0.55 : 0);
    const tongue = (x, y, rx, ry) => { g.fillStyle = PAL.tongue; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill(); };
    if (E === 'angry' && this.mouth < 0.5) {
      // dientes apretados
      g.fillStyle = PAL.white;
      g.beginPath(); g.moveTo(-70, -78); g.quadraticCurveTo(0, -96, 70, -78); g.lineTo(62, -38); g.quadraticCurveTo(0, -30, -62, -38); g.closePath();
      g.fill(); g.stroke();
      g.lineWidth = 5;
      g.beginPath(); g.moveTo(-66, -58); g.quadraticCurveTo(0, -66, 66, -58); g.stroke();
      for (let x = -42; x <= 42; x += 21) { g.beginPath(); g.moveTo(x, -84); g.lineTo(x, -36); g.stroke(); }
    } else if (E === 'surprised' && this.mouth < 0.5) {
      g.fillStyle = PAL.mouthIn;
      g.beginPath(); g.ellipse(0, -52, 28, 38, 0, 0, Math.PI * 2); g.fill();
      g.save(); g.clip(); tongue(0, -22, 20, 14); g.restore();
      g.beginPath(); g.ellipse(0, -52, 28, 38, 0, 0, Math.PI * 2); g.stroke();
    } else if (E === 'irritated' && this.mouth < 0.5) {
      // escéptico: boca torcida hacia un lado
      g.beginPath(); g.moveTo(-50, -66); g.quadraticCurveTo(-10, -70, 20, -62); g.quadraticCurveTo(45, -56, 66, -76); g.stroke();
    } else if (E === 'sad' && this.mouth < 0.5) {
      const w = Math.sin(this.time * 14) * 3;
      g.beginPath(); g.moveTo(-52, -40 + w); g.quadraticCurveTo(-26, -78, 0, -66); g.quadraticCurveTo(26, -78, 52, -40 - w); g.stroke();
    } else if (E === 'dizzy') {
      // boca ondulada con la lengua afuera
      g.fillStyle = PAL.tongue;
      g.beginPath(); g.moveTo(8, -62); g.quadraticCurveTo(10, -10, 32, -12); g.quadraticCurveTo(50, -16, 44, -62); g.closePath(); g.fill(); g.lineWidth = 6; g.stroke();
      g.lineWidth = 9;
      g.beginPath(); g.moveTo(-60, -66);
      for (let x = -60; x <= 60; x += 10) g.lineTo(x, -64 + Math.sin(x * 0.12 + this.time * 6) * 7);
      g.stroke();
    } else if (E === 'wink' && this.mouth < 0.4) {
      // sonrisa pícara con la lengua asomada a un lado
      g.beginPath(); g.moveTo(-60, -78); g.quadraticCurveTo(-28, -32, 0, -70); g.quadraticCurveTo(30, -26, 66, -86); g.stroke();
      g.fillStyle = PAL.tongue; g.lineWidth = 6;
      g.beginPath(); g.moveTo(18, -56); g.quadraticCurveTo(24, -18, 42, -22); g.quadraticCurveTo(56, -28, 48, -62); g.fill(); g.stroke();
    } else if (E === 'vibe' && this.mouth < 0.3) {
      // sonrisa tranquila, "tarareando"
      g.beginPath(); g.moveTo(-50, -74); g.quadraticCurveTo(-25, -48, 0, -70); g.quadraticCurveTo(25, -48, 50, -74); g.stroke();
      g.fillStyle = PAL.mouthIn; g.beginPath(); g.ellipse(0, -50, 9 + pulse * 4, 11 + pulse * 5, 0, 0, Math.PI * 2); g.fill();
    } else if (mo > 0.08) {
      // boca abierta (riendo / maullando)
      const mh = 30 + 70 * mo, mw = 42 + 26 * mo;
      const path = () => {
        g.beginPath();
        g.moveTo(-mw, -82);
        g.quadraticCurveTo(-mw * 1.05, -82 + mh, 0, -82 + mh * 1.1);
        g.quadraticCurveTo(mw * 1.05, -82 + mh, mw, -82);
        g.quadraticCurveTo(0, -70, -mw, -82);
      };
      path(); g.fillStyle = PAL.mouthIn; g.fill();
      g.save(); path(); g.clip(); tongue(0, -82 + mh * 0.95, mw * 0.62, mh * 0.32); g.restore();
      path(); g.stroke();
    } else {
      g.beginPath();
      g.moveTo(-58, -80); g.quadraticCurveTo(-30, -36, 0, -76);
      g.quadraticCurveTo(30, -36, 58, -80);
      g.stroke();
    }
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
    if (mood === 'wink' && sd > 0) { // guiño: ojo cerrado en "^" con pestañas
      g.lineWidth = 16;
      g.beginPath(); g.moveTo(-rx * 0.9, 24); g.quadraticCurveTo(0, -60, rx * 0.9, 24); g.stroke();
      g.lineWidth = 8;
      [[0.62, -0.05, 1], [0.9, 0.2, 1]].forEach(([a, b]) => { g.beginPath(); g.moveTo(a * rx, b * 100); g.lineTo(a * rx + 30, b * 100 - 24); g.stroke(); });
      g.restore(); return;
    }
    if (this.blink > 0.4 && !['meow', 'angry', 'surprised', 'dizzy', 'wink'].includes(mood)) {
      g.beginPath(); g.moveTo(-rx, 10); g.quadraticCurveTo(0, 60, rx, 10); g.stroke();
      g.restore(); return;
    }
    if (mood === 'meow') { // riendo: ojos felices ^ ^
      g.lineWidth = 16;
      g.beginPath(); g.moveTo(-rx * 0.85, 30); g.quadraticCurveTo(0, -90, rx * 0.85, 30); g.stroke();
      g.restore(); return;
    }
    const sq = mood === 'surprised' ? 1.12 : 1;
    g.fillStyle = PAL.white;
    g.beginPath(); g.ellipse(0, 0, rx * sq, ry * sq, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    if (mood === 'dizzy') { // aturdido: espirales
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
    const pr = mood === 'surprised' ? 0.7 : mood === 'angry' ? 0.62 : mood === 'irritated' ? 0.8 : mood === 'sad' ? 0.78 : 1;
    const side = mood === 'irritated' ? 26 * (this.look >= 0 ? 1 : -1) : 0; // mirada de reojo
    const px = lx + side, py = 18 + ly + (mood === 'irritated' ? 28 : 0);
    const prx = 58 * pr, pry = 86 * pr;
    const w0 = -1.25, w1 = -0.55; // cuña (ángulos)
    g.fillStyle = PAL.black;
    g.beginPath();
    g.moveTo(px + Math.cos(w0) * prx * 0.25, py + Math.sin(w0) * pry * 0.25);
    g.ellipse(px, py, prx, pry, 0, w1, w0 + Math.PI * 2);
    g.closePath(); g.fill();
    if (mood === 'joy' || mood === 'sad' || mood === 'wink') { // brillo extra (alegría / ojos llorosos)
      g.fillStyle = PAL.white;
      g.beginPath(); g.arc(px - prx * 0.35, py + pry * 0.45, mood === 'sad' ? 14 : 11, 0, Math.PI * 2); g.fill();
    }
    // párpados: escéptico (a media asta) / enojado (hacia adentro) / triste (hacia afuera)
    if (mood === 'irritated' || mood === 'angry' || mood === 'sad') {
      g.save();
      g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); g.clip();
      const a = 0.34 * this.anger;
      g.fillStyle = `rgb(${Math.round(SKIN[0] * (1 - a) + 235 * a)},${Math.round(SKIN[1] * (1 - a) + 40 * a)},${Math.round(SKIN[2] * (1 - a) + 30 * a)})`;
      // y del párpado en el lado derecho/izquierdo del ojo
      let yR, yL;
      if (mood === 'irritated') { yR = yL = -ry * 0.05; }
      else if (mood === 'angry') { yR = sd > 0 ? -ry * 0.75 : -ry * 0.05; yL = sd > 0 ? -ry * 0.05 : -ry * 0.75; }
      else { yR = sd > 0 ? -ry * 0.25 : -ry * 0.8; yL = sd > 0 ? -ry * 0.8 : -ry * 0.25; }
      g.beginPath(); g.moveTo(-rx - 5, -ry - 5); g.lineTo(rx + 5, -ry - 5); g.lineTo(rx + 5, yR); g.lineTo(-rx - 5, yL); g.closePath();
      g.fill();
      g.lineWidth = 12; g.strokeStyle = PAL.black;
      g.beginPath(); g.moveTo(rx + 5, yR); g.lineTo(-rx - 5, yL); g.stroke();
      g.restore();
      g.lineWidth = 11; g.strokeStyle = PAL.black;
      g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); g.stroke();
    }
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

    const E = this.expr();
    // ---- orejas negras con interior rosa (detrás de la cabeza)
    [-1, 1].forEach((sd) => {
      const ang = 0.78;
      const base = proj(sd * Math.sin(ang) * (R - 0.8 * k), Math.cos(ang) * (R - 0.8 * k), zb);
      const wig = (bi % 2 === (sd > 0 ? 0 : 1) ? pulse : 0) * 0.12;
      const droop = E === 'sad' ? 0.45 : E === 'angry' ? -0.12 : 0; // orejas caídas / tiesas
      ctx.save();
      ctx.translate(base.x, base.y);
      ctx.rotate(sd * (0.55 + wig + droop) + Math.sin(this.time * 2 + sd) * 0.03);
      const w = 3.6 * unit, h = 4.6 * unit;
      ctx.lineJoin = 'round';
      ctx.fillStyle = PAL.fur; ctx.strokeStyle = PAL.black; ctx.lineWidth = Math.max(4, unit * 0.22);
      ctx.beginPath();
      ctx.moveTo(-w / 2, h * 0.25);
      ctx.quadraticCurveTo(-w * 0.55, -h * 0.5, sd * w * 0.08, -h);
      ctx.quadraticCurveTo(w * 0.55, -h * 0.5, w / 2, h * 0.25);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // brillo gris en el borde
      ctx.strokeStyle = PAL.furHi; ctx.lineWidth = Math.max(2, unit * 0.14);
      ctx.beginPath(); ctx.moveTo(-sd * w * 0.38, -h * 0.1); ctx.quadraticCurveTo(-sd * w * 0.42, -h * 0.5, sd * w * 0.04, -h * 0.88); ctx.stroke();
      ctx.fillStyle = PAL.rose;
      ctx.beginPath();
      ctx.moveTo(-w * 0.26, h * 0.05);
      ctx.quadraticCurveTo(-w * 0.28, -h * 0.42, sd * w * 0.06, -h * 0.74);
      ctx.quadraticCurveTo(w * 0.28, -h * 0.42, w * 0.26, h * 0.05);
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

    // ---- vapor por las orejas (enojo), notas (disfrutando), estrellitas (aturdido)
    const dtb = st.dt || 0.016;
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
    if (E === 'dizzy') { // estrellitas girando sobre la cabeza
      const top = proj(0, R + 1.6 * k, zb);
      for (let i = 0; i < 5; i++) {
        const a = this.time * 2.6 + (i / 5) * Math.PI * 2;
        const sx = top.x + Math.cos(a) * unit * 7, sy = top.y + Math.sin(a) * unit * 1.6;
        this.star(ctx, sx, sy, unit * (0.75 + 0.25 * Math.sin(a)), a);
      }
    }

    // ---- brazos de manguera negros con guantes blancos (bailan según la emoción)
    [-1, 1].forEach((sd, i) => {
      const myBeat = (bi + i) % 2 === 0;
      let up = myBeat ? pulse : pulse * 0.3;
      if (E === 'joy' || E === 'meow') up = pulse * 1.4;                       // aplaude/agita las dos
      else if (E === 'vibe') up = 0.5 + Math.sin(this.time * 1.6 + i * Math.PI) * 0.6; // ondea lento
      else if (E === 'irritated') up = i === 1 && bi % 2 === 0 ? pulse * 0.5 : 0;    // golpecito impaciente
      else if (E === 'angry') up = 0.8 + (Math.random() - 0.5) * 0.5;              // puños temblando
      else if (E === 'sad') up = -0.8 + pulse * 0.15;                               // brazos caídos
      else if (E === 'dizzy') up = Math.sin(this.time * 3 + i * 2) * 0.7;          // tambaleo
      else if (E === 'wink' && i === 1) up = 1.3;                                   // saludo con una mano
      const toss = this.toss[i];
      const tossE = Math.sin(toss * Math.PI);
      const base = proj(sd * (R * 0.9), -R * 0.55, zb - 0.3);
      let pw = { x: sd * (R + 3.4 * k) - sd * tossE * 2.2 * k, y: R + 2.2 * k + up * 1.1 * k - tossE * 3.0 * k };
      pw.x += Math.sin(this.time * 2.2 + i) * 0.35 * k;
      const paw = proj(pw.x, pw.y, zb - 0.3);
      const thick = 1.25 * unit;
      // curva en S que ondula con el tiempo
      const wv = (Math.sin(this.time * 3 + i * 2) * 1.6 + (myBeat ? pulse * 1.2 : 0)) * k;
      const c1 = proj(sd * (R + 4.6 * k + wv), R * 0.05, zb - 0.3);
      const c2 = proj(sd * (R + 1.2 * k - wv), R * 0.75, zb - 0.3);
      const path = () => { ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, paw.x, paw.y); };
      ctx.lineCap = 'round';
      path(); ctx.strokeStyle = PAL.black; ctx.lineWidth = thick + Math.max(6, unit * 0.32); ctx.stroke();
      path(); ctx.strokeStyle = PAL.fur; ctx.lineWidth = thick; ctx.stroke();
      // brillo gris a lo largo de la manguera (volumen)
      ctx.save(); ctx.translate(-sd * thick * 0.18, -thick * 0.18);
      path(); ctx.strokeStyle = PAL.furHi; ctx.lineWidth = thick * 0.22; ctx.stroke();
      ctx.restore();
      // guante
      const ang = Math.atan2(paw.y - c2.y, paw.x - c2.x) + Math.PI / 2;
      this.drawGlove(ctx, paw.x, paw.y, unit * 1.05 * (1 + Math.max(0, up) * 0.12), ang, sd, E === 'angry');
      // líneas de movimiento junto al guante
      ctx.strokeStyle = PAL.black; ctx.lineWidth = Math.max(2, unit * 0.12);
      for (let kk = 0; kk < 3; kk++) {
        const a0 = -Math.PI / 2 - sd * (0.9 + kk * 0.35);
        const rr = unit * (2.0 + Math.max(0, up) * 0.5);
        ctx.beginPath(); ctx.arc(paw.x, paw.y, rr, a0 - 0.12, a0 + 0.12); ctx.stroke();
      }
    });
  }

  star(ctx, x, y, s, rot) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    ctx.fillStyle = PAL.yellow; ctx.strokeStyle = PAL.black; ctx.lineWidth = Math.max(2, s * 0.18); ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < 10; i++) { const r = i % 2 ? s * 0.45 : s; const a = (i / 10) * Math.PI * 2 - Math.PI / 2; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  }

  /** Guante blanco de caricatura (4 dedos, puño con costuras y doblez). */
  drawGlove(ctx, x, y, s, ang, sd, fist) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    const ol = Math.max(4, s * 0.2);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    // puño del guante (doblez acampanado) — se dibuja primero, queda detrás
    const cuff = () => { ctx.beginPath(); ctx.moveTo(-0.95 * s, 0.6 * s); ctx.quadraticCurveTo(0, 0.35 * s, 0.95 * s, 0.6 * s); ctx.lineTo(1.15 * s, 1.25 * s); ctx.quadraticCurveTo(0, 1.55 * s, -1.15 * s, 1.25 * s); ctx.closePath(); };
    cuff(); ctx.fillStyle = PAL.glove; ctx.strokeStyle = PAL.black; ctx.lineWidth = ol; ctx.fill(); ctx.stroke();
    ctx.lineWidth = Math.max(2, s * 0.1);
    ctx.beginPath(); ctx.moveTo(-1.0 * s, 0.95 * s); ctx.quadraticCurveTo(0, 1.15 * s, 1.0 * s, 0.95 * s); ctx.stroke();
    if (fist) { // puño cerrado
      ctx.lineWidth = ol; ctx.fillStyle = PAL.glove;
      ctx.beginPath(); ctx.ellipse(0, -0.45 * s, 1.35 * s, 1.2 * s, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      [-0.75, 0, 0.75].forEach((xx) => { ctx.beginPath(); ctx.arc(xx * s, -1.45 * s, 0.42 * s, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke(); });
      ctx.lineWidth = Math.max(3, s * 0.14);
      [-0.38, 0.38].forEach((xx) => { ctx.beginPath(); ctx.moveTo(xx * s, -1.6 * s); ctx.lineTo(xx * s, -0.95 * s); ctx.stroke(); });
      // pulgar cruzado
      ctx.lineWidth = ol;
      ctx.beginPath(); ctx.ellipse(-sd * 0.45 * s, -0.2 * s, 0.75 * s, 0.38 * s, -sd * 0.25, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore(); return;
    }
    // dedos (contorno primero, luego relleno => silueta unida)
    const fingers = [[-0.55, 1.75], [-0.18, 1.95], [0.2, 1.85]].map(([a, l]) => [a, l, 0.36]);
    fingers.push([-sd * 1.25, 1.25, 0.34]); // pulgar
    const seg = (a, l) => { ctx.beginPath(); ctx.moveTo(0, -0.4 * s); ctx.lineTo(Math.sin(a) * l * s, -0.4 * s - Math.cos(a) * l * s); };
    ctx.strokeStyle = PAL.black;
    fingers.forEach(([a, l, r]) => { seg(a, l); ctx.lineWidth = r * 2 * s + ol * 2; ctx.stroke(); });
    ctx.beginPath(); ctx.ellipse(0, -0.25 * s, 1.25 * s, 1.1 * s, 0, 0, Math.PI * 2); ctx.lineWidth = ol * 2; ctx.stroke();
    ctx.strokeStyle = PAL.glove; ctx.fillStyle = PAL.glove;
    fingers.forEach(([a, l, r]) => { seg(a, l); ctx.lineWidth = r * 2 * s; ctx.stroke(); });
    ctx.beginPath(); ctx.ellipse(0, -0.25 * s, 1.25 * s, 1.1 * s, 0, 0, Math.PI * 2); ctx.fill();
    // separación entre dedos y las tres costuras del dorso
    ctx.strokeStyle = PAL.black; ctx.lineWidth = Math.max(2, s * 0.1);
    [-0.37, 0.01].forEach((a) => { ctx.beginPath(); ctx.moveTo(Math.sin(a) * 0.9 * s, -0.4 * s - Math.cos(a) * 0.9 * s); ctx.lineTo(Math.sin(a) * 1.6 * s, -0.4 * s - Math.cos(a) * 1.6 * s); ctx.stroke(); });
    [-0.4, 0, 0.4].forEach((xx) => { ctx.beginPath(); ctx.moveTo(xx * s, 0.35 * s); ctx.lineTo(xx * 1.1 * s, -0.35 * s); ctx.stroke(); });
    ctx.restore();
  }
}
