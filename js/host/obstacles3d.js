// =====================================================================
//  Mallas 3D de los obstáculos. Se construyen con LAS MISMAS primitivas
//  del perfil de colisión (catalog.js), extruidas a lo ancho de la rueda.
//  Estilo caricatura: toon + contorno negro + texturas pintadas a mano.
// =====================================================================
import * as THREE from 'three';
import { toonGradient, makeOutlineGeometry, INK } from './characters.js';

const texCache = new Map();
function canvasTex(key, w, h, draw) {
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  texCache.set(key, t);
  return t;
}

const C = {
  wood: '#c9782e', woodDark: '#7a3b12', red: '#d81e2b', cream: '#fff3d6', black: '#151515',
  yellow: '#ffe600', maroon: '#86001c', blue: '#2b33a8', grey: '#6b6f7a', steel: '#9aa3b2',
};

const toon = (opts) => new THREE.MeshToonMaterial(Object.assign({ gradientMap: toonGradient() }, opts));

function crateTex() {
  return canvasTex('crate', 256, 256, (g, w, h) => {
    g.fillStyle = C.wood; g.fillRect(0, 0, w, h);
    g.strokeStyle = C.woodDark; g.lineWidth = 6;
    for (let y = 0; y < h; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.lineWidth = 18; g.strokeRect(9, 9, w - 18, h - 18);
    g.beginPath(); g.moveTo(18, 18); g.lineTo(w - 18, h - 18); g.stroke();
    g.fillStyle = C.black; g.font = 'bold 54px serif'; g.textAlign = 'center';
    g.save(); g.translate(w / 2, h / 2 + 18); g.rotate(-0.1); g.fillText('ACME', 0, 0); g.restore();
  });
}
function stripeTex(key, a, b, n = 6, vertical = true) {
  return canvasTex(key, 256, 256, (g, w, h) => {
    for (let i = 0; i < n; i++) {
      g.fillStyle = i % 2 ? a : b;
      if (vertical) g.fillRect((i * w) / n, 0, w / n + 1, h); else g.fillRect(0, (i * h) / n, w, h / n + 1);
    }
  });
}
function logCapTex() {
  return canvasTex('logcap', 256, 256, (g, w, h) => {
    g.fillStyle = '#e7b16a'; g.fillRect(0, 0, w, h);
    g.strokeStyle = C.woodDark; g.lineWidth = 5;
    for (let r = 20; r < 128; r += 22) { g.beginPath(); g.arc(128, 128, r, 0, Math.PI * 2); g.stroke(); }
  });
}
function barkTex() {
  return canvasTex('bark', 256, 256, (g, w, h) => {
    g.fillStyle = '#8a4a1c'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#4a2108'; g.lineWidth = 7;
    for (let x = 10; x < w; x += 36) { g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + 14, 80, x - 14, 170, x, h); g.stroke(); }
  });
}
function canTex() {
  return canvasTex('can', 256, 256, (g, w, h) => {
    g.fillStyle = C.steel; g.fillRect(0, 0, w, h);
    g.fillStyle = C.blue; g.fillRect(0, h * 0.2, w, h * 0.6);
    g.fillStyle = C.yellow; g.font = 'bold 40px serif'; g.textAlign = 'center';
    g.fillText('SARDINAS', w / 2, h / 2 + 4);
    g.fillStyle = C.cream; g.fillRect(0, h * 0.62, w, 10);
  });
}
function yarnTex() {
  return canvasTex('yarn', 256, 256, (g, w, h) => {
    g.fillStyle = '#e8384f'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#9b0f2a'; g.lineWidth = 5;
    for (let i = -10; i < 20; i++) { g.beginPath(); g.moveTo(i * 22, 0); g.lineTo(i * 22 + 120, h); g.stroke(); }
    g.strokeStyle = '#ff8d9c'; g.lineWidth = 3;
    for (let i = -10; i < 20; i++) { g.beginPath(); g.moveTo(i * 22 + 140, 0); g.lineTo(i * 22, h); g.stroke(); }
  });
}

/** Agrega malla + contorno. */
function add(group, geo, mat, outline = 0.035) {
  const m = new THREE.Mesh(geo, mat);
  group.add(m);
  if (outline) group.add(new THREE.Mesh(makeOutlineGeometry(geo, outline), INK));
  return m;
}

/**
 * Construye el obstáculo: grupo cuyo origen está en el suelo, en el centro
 * del obstáculo. x = a lo largo de la superficie, y = altura, z = profundidad.
 */
export function buildObstacleMesh(ev, depth) {
  const g = new THREE.Group();
  const spin = new THREE.Group(); // partes que ruedan
  g.add(spin);
  g.userData.spin = spin;
  const D = depth;
  const { kind, prims, w, h } = ev;

  if (kind === 'crate') {
    const p = prims[0];
    const n = Math.max(2, Math.round(D / Math.max(0.8, p.x1 - p.x0)));
    const tex = crateTex();
    for (let i = 0; i < n; i++) {
      const geo = new THREE.BoxGeometry(p.x1 - p.x0, p.y1 - p.y0, D / n - 0.04);
      geo.translate(0, (p.y0 + p.y1) / 2, -D / 2 + (i + 0.5) * (D / n));
      add(g, geo, toon({ map: tex }));
    }
  } else if (kind === 'log' || kind === 'yarn' || kind === 'bomb') {
    const p = prims[0];
    if (kind === 'log') {
      const geo = new THREE.CylinderGeometry(p.r, p.r, D, 24, 1);
      geo.rotateX(Math.PI / 2);
      const bark = barkTex().clone(); bark.needsUpdate = true; bark.repeat.set(3, 1);
      add(spin, geo, [toon({ map: bark }), toon({ map: logCapTex() }), toon({ map: logCapTex() })]);
    } else {
      const n = Math.max(2, Math.round(D / (p.r * 2)));
      for (let i = 0; i < n; i++) {
        const geo = new THREE.SphereGeometry(p.r * 0.98, 20, 14);
        geo.translate(0, 0, -D / 2 + (i + 0.5) * (D / n));
        if (kind === 'yarn') add(spin, geo, toon({ map: yarnTex() }));
        else {
          add(spin, geo, toon({ color: 0x1d1d22 }));
          // mecha (decorativa, delgada y corta para no confundir)
          const fz = -D / 2 + (i + 0.5) * (D / n);
          const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.12, 6), toon({ color: 0xcfa36b }));
          fuse.position.set(0, p.cy + p.r * 0.97 + 0.04, fz);
          g.add(fuse);
          const spark = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd23a }));
          spark.position.set(0, p.cy + p.r * 0.97 + 0.11, fz);
          spark.userData.spark = true;
          g.add(spark);
        }
      }
    }
    spin.position.y = p.cy;
  } else if (kind === 'cones') {
    const p = prims[0];
    const n = Math.max(2, Math.round(D / (p.x1 - p.x0)));
    const tex = stripeTex('tent', C.red, C.cream, 8, true);
    for (let i = 0; i < n; i++) {
      const geo = new THREE.ConeGeometry((p.x1 - p.x0) / 2, p.y1 - p.y0, 16, 1);
      geo.translate(0, (p.y1 - p.y0) / 2 + p.y0, -D / 2 + (i + 0.5) * (D / n));
      add(g, geo, toon({ map: tex }));
      const flag = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 6), toon({ color: 0xffe600 }));
      flag.position.set(0, p.y1 + 0.02, -D / 2 + (i + 0.5) * (D / n));
      g.add(flag);
    }
  } else if (kind === 'tophat') {
    const brim = prims[0], crown = prims[1];
    const n = Math.max(2, Math.round(D / (crown.x1 - crown.x0) / 1.25));
    for (let i = 0; i < n; i++) {
      const z = -D / 2 + (i + 0.5) * (D / n);
      const bg = new THREE.CylinderGeometry((brim.x1 - brim.x0) / 2, (brim.x1 - brim.x0) / 2, brim.y1 - brim.y0, 24);
      bg.translate(0, (brim.y0 + brim.y1) / 2, z);
      add(g, bg, toon({ color: 0x1b1b22 }), 0.02);
      const cg = new THREE.CylinderGeometry((crown.x1 - crown.x0) / 2, (crown.x1 - crown.x0) / 2, crown.y1 - crown.y0, 24);
      cg.translate(0, (crown.y0 + crown.y1) / 2, z);
      add(g, cg, toon({ color: 0x24242c }));
      const band = new THREE.CylinderGeometry((crown.x1 - crown.x0) / 2 + 0.01, (crown.x1 - crown.x0) / 2 + 0.01, 0.12, 24, 1, true);
      band.translate(0, crown.y0 + 0.14, z);
      g.add(new THREE.Mesh(band, toon({ color: 0xd81e2b })));
    }
  } else if (kind === 'cans') {
    const p = prims[0];
    const n = Math.max(3, Math.round(D / (p.x1 - p.x0) / 1.05));
    const tex = canTex();
    for (let i = 0; i < n; i++) {
      const geo = new THREE.CylinderGeometry((p.x1 - p.x0) / 2, (p.x1 - p.x0) / 2, p.y1 - p.y0, 20);
      geo.translate(0, (p.y0 + p.y1) / 2, -D / 2 + (i + 0.5) * (D / n));
      add(g, geo, toon({ map: tex }), 0.03);
    }
  } else if (kind === 'anvil') {
    const n = 2;
    for (let i = 0; i < n; i++) {
      const z = -D / 2 + (i + 0.5) * (D / n);
      const len = D / n - 0.25;
      prims.forEach((p, k) => {
        const geo = new THREE.BoxGeometry(p.x1 - p.x0, p.y1 - p.y0, k === 1 ? len * 0.6 : len);
        geo.translate((p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2, z);
        add(g, geo, toon({ color: k === 2 ? 0x5d6470 : 0x474c57 }), 0.03);
      });
    }
  } else if (kind === 'hurdle') {
    const p = prims[0];
    // barra superior a lo ancho + tablón pintado + patas en los extremos
    const tex = stripeTex('hurdle', C.red, C.cream, 10, true);
    const boardH = Math.min(0.45, (p.y1 - p.y0) * 0.45);
    const bgeo = new THREE.BoxGeometry(p.x1 - p.x0, boardH, D);
    bgeo.translate(0, p.y1 - boardH / 2, 0);
    add(g, bgeo, toon({ map: tex }));
    const lower = new THREE.BoxGeometry(p.x1 - p.x0, p.y1 - boardH, D);
    lower.translate(0, (p.y1 - boardH) / 2, 0);
    add(g, lower, toon({ color: 0x7a3b12 }), 0.03);
  }
  // contorno de "sombra" en el suelo
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.1, D), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }));
  sh.rotation.x = -Math.PI / 2; sh.position.y = 0.01;
  g.add(sh);
  return g;
}

/** Visualización de hitbox (depuración, tecla H). */
export function buildHitboxMesh(prims, depth) {
  const g = new THREE.Group();
  const mat = new THREE.LineBasicMaterial({ color: 0xff00ff });
  const z = depth / 2 + 0.05;
  prims.forEach((p) => {
    let pts = [];
    if (p.t === 'box') pts = [[p.x0, p.y0], [p.x1, p.y0], [p.x1, p.y1], [p.x0, p.y1], [p.x0, p.y0]];
    else if (p.t === 'tri') pts = [[p.x0, p.y0], [p.x1, p.y0], [(p.x0 + p.x1) / 2, p.y1], [p.x0, p.y0]];
    else for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI * 2; pts.push([p.cx + Math.cos(a) * p.r, p.cy + Math.sin(a) * p.r]); }
    const geo = new THREE.BufferGeometry().setFromPoints(pts.map(([x, y]) => new THREE.Vector3(x, y, z)));
    g.add(new THREE.Line(geo, mat));
  });
  return g;
}

// ---------------------------------------------------------------------
//  BARANDA para patinar: se arma por tramos cortos que siguen la curva de
//  la cabeza (cada tramo se ubica en su propia posición del arco).
//  dx = distancia del tramo al frente de la baranda (en el sentido de s).
//  Los postes y pinchos usan las mismas medidas que su hitbox (railPrims).
// ---------------------------------------------------------------------
export function buildRailParts(ev, depth, PHYS) {
  const parts = [];
  const L = ev.railL, dir = ev.dir;
  const metal = new THREE.MeshToonMaterial({ color: 0xc9ced8, gradientMap: toonGradient() });
  const metalDark = new THREE.MeshToonMaterial({ color: 0x6b7280, gradientMap: toonGradient() });
  const stripe = stripeTex('railStripe', '#141414', '#ffe600', 8, true);
  const spikeMat = new THREE.MeshToonMaterial({ map: stripeTex('spike', '#d81e2b', '#fff3d6', 6, true), gradientMap: toonGradient() });
  const segLen = 0.55;
  const n = Math.max(2, Math.ceil(L / segLen));
  const step = L / n;
  for (let k = 0; k < n; k++) {
    const g = new THREE.Group();
    // barra (dos tubos: adelante y atrás de la rueda) + travesaño
    for (const z of [depth * 0.33, -depth * 0.33]) {
      const bar = new THREE.CylinderGeometry(0.075, 0.075, step + 0.02, 10);
      bar.rotateZ(Math.PI / 2); bar.translate(0, PHYS.RAIL_H - 0.075, z);
      add(g, bar, metal, 0.02);
    }
    const plank = new THREE.BoxGeometry(step + 0.01, 0.07, depth * 0.66);
    plank.translate(0, PHYS.RAIL_H - 0.05, 0);
    add(g, plank, new THREE.MeshToonMaterial({ map: stripe, gradientMap: toonGradient() }), 0.015);
    // pinchos debajo (fila a lo ancho) — coinciden con los pinchos del hitbox
    {
      const m = 4;
      for (let i = 0; i < m; i++) {
        const cone = new THREE.ConeGeometry(step / 2, PHYS.SPIKE_H, 8);
        cone.translate(0, PHYS.SPIKE_H / 2, -depth / 2 + (i + 0.5) * (depth / m));
        g.add(new THREE.Mesh(cone, spikeMat));
      }
    }
    parts.push({ mesh: g, dx: -dir * (k + 0.5) * step });
  }
  // postes en los extremos
  for (const dx of [0, -dir * L]) {
    const g = new THREE.Group();
    for (const z of [depth * 0.33, -depth * 0.33]) {
      const post = new THREE.BoxGeometry(PHYS.POST_HW * 2, PHYS.RAIL_H, 0.16);
      post.translate(0, PHYS.RAIL_H / 2, z);
      add(g, post, metalDark, 0.02);
    }
    const cap = new THREE.SphereGeometry(0.11, 10, 8); cap.translate(0, PHYS.RAIL_H, depth * 0.33);
    add(g, cap, new THREE.MeshToonMaterial({ color: 0xd81e2b, gradientMap: toonGradient() }), 0.015);
    const cap2 = cap.clone(); cap2.translate(0, 0, -depth * 0.66);
    add(g, cap2, new THREE.MeshToonMaterial({ color: 0xd81e2b, gradientMap: toonGradient() }), 0.015);
    parts.push({ mesh: g, dx });
  }
  return parts;
}
