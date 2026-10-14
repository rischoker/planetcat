// =====================================================================
//  Personajes 3D (GLB de Polygonal Mind). Los modelos vienen sin esqueleto
//  y con brazos/piernas finitos en pose T. Al cargarlos:
//   1) Se separan por islas de malla y se quitan las piernas y brazos.
//   2) Se les ponen extremidades de "manguera de goma" (estilo años 20)
//      con guantes blancos y zapatos, animadas por código:
//      caminar, correr, saltar, bailar al ritmo y K.O.
//   3) Sombreado toon + contorno negro (casco invertido).
// =====================================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export const CHARACTERS = [
  { id: 'aguacate', name: 'Aguacate' },
  { id: 'baguette', name: 'Baguette' },
  { id: 'banano', name: 'Banano' },
  { id: 'lata', name: 'Lata' },
  { id: 'mani', name: 'Maní' },
  { id: 'muslito', name: 'Muslito' },
  { id: 'palmera', name: 'Palmera' },
  { id: 'papitas', name: 'Papitas' },
  { id: 'perrocaliente', name: 'Perro Caliente' },
  { id: 'sandia', name: 'Sandía' },
  { id: 'zanahoria', name: 'Zanahoria' },
];

export const CHAR_HEIGHT = 2.0; // alto total en unidades de mundo

let gradientMap = null;
export function toonGradient() {
  if (gradientMap) return gradientMap;
  const data = new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]);
  gradientMap = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  gradientMap.minFilter = gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.needsUpdate = true;
  return gradientMap;
}

export const INK = new THREE.MeshBasicMaterial({ color: 0x111111, side: THREE.BackSide });

/** Geometría de contorno: normales suavizadas y vértices empujados hacia afuera. */
export function makeOutlineGeometry(geo, thickness) {
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', geo.attributes.position.clone());
  if (geo.index) g.setIndex(geo.index.clone());
  g = mergeVertices(g, 1e-4);
  g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) + n.getX(i) * thickness, p.getY(i) + n.getY(i) * thickness, p.getZ(i) + n.getZ(i) * thickness);
  }
  return g;
}

// ------------------------------------------------------------ análisis
function splitIslands(geo) {
  const pos = geo.attributes.position, idx = geo.index;
  const N = pos.count;
  const keyMap = new Map(); const rep = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    const k = Math.round(pos.getX(i) * 1e5) + ',' + Math.round(pos.getY(i) * 1e5) + ',' + Math.round(pos.getZ(i) * 1e5);
    if (!keyMap.has(k)) keyMap.set(k, i);
    rep[i] = keyMap.get(k);
  }
  const par = new Int32Array(N); for (let i = 0; i < N; i++) par[i] = i;
  const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  const triCount = idx ? idx.count / 3 : N / 3;
  const vi = (k) => (idx ? idx.getX(k) : k);
  for (let t = 0; t < triCount; t++) {
    const a = find(rep[vi(3 * t)]), b = find(rep[vi(3 * t + 1)]), c = find(rep[vi(3 * t + 2)]);
    par[a] = b; par[find(b)] = find(c);
  }
  const comps = new Map();
  for (let i = 0; i < N; i++) {
    const r = find(rep[i]);
    let c = comps.get(r);
    if (!c) { c = { root: r, min: new THREE.Vector3(1e9, 1e9, 1e9), max: new THREE.Vector3(-1e9, -1e9, -1e9), verts: [] }; comps.set(r, c); }
    c.verts.push(i);
    c.min.min(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
    c.max.max(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
  }
  const compOf = new Int32Array(N);
  const list = [...comps.values()];
  list.forEach((c, ci) => { c.id = ci; c.verts.forEach((v) => { compOf[v] = ci; }); });
  return { list, compOf, triCount, vi };
}

function buildTemplate(gltf, def) {
  gltf.scene.updateMatrixWorld(true);
  let mesh = null;
  gltf.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
  let geo = mesh.geometry.clone();
  geo.applyMatrix4(mesh.matrixWorld);
  const srcMat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;

  const bb = new THREE.Box3().setFromBufferAttribute(geo.attributes.position);
  const H = bb.max.y - bb.min.y;
  const { list, compOf, triCount, vi } = splitIslands(geo);
  const size = (c) => new THREE.Vector3().subVectors(c.max, c.min);
  // piernas: islas que tocan el suelo
  const legs = list.filter((c) => c.min.y < bb.min.y + H * 0.03);
  const rest = list.filter((c) => !legs.includes(c));
  // cuerpo: isla con mayor volumen de caja
  let body = rest[0];
  rest.forEach((c) => { const s = size(c), b = size(body); if (s.x * s.y * s.z > b.x * b.y * b.z) body = c; });
  const bodyHalfZ = Math.max(Math.abs(body.min.z), Math.abs(body.max.z));
  const bodyTop = body.max.y, bodyBot = body.min.y;
  // brazos: islas delgadas en Y, a media altura, que sobresalen mucho en Z
  const armCands = rest.filter((c) => {
    if (c === body) return false;
    const s = size(c); const cy = (c.min.y + c.max.y) / 2;
    const reach = Math.max(Math.abs(c.min.z), Math.abs(c.max.z));
    return s.y < H * 0.2 && cy > bodyBot && cy < bodyBot + (bodyTop - bodyBot) * 0.8 && reach > bodyHalfZ * 1.15 && s.z > s.y;
  }).sort((a, b) => Math.max(Math.abs(b.min.z), Math.abs(b.max.z)) - Math.max(Math.abs(a.min.z), Math.abs(a.max.z)));
  const arms = armCands.slice(0, 2);
  const removed = new Set([...legs, ...arms].map((c) => c.id));

  // reconstruye índices sin las extremidades
  const newIdx = [];
  for (let t = 0; t < triCount; t++) {
    const a = vi(3 * t), b = vi(3 * t + 1), c = vi(3 * t + 2);
    if (removed.has(compOf[a]) || removed.has(compOf[b]) || removed.has(compOf[c])) continue;
    newIdx.push(a, b, c);
  }
  geo.setIndex(newIdx);

  // anclas (en coordenadas originales)
  const hipY = legs.length ? Math.max(...legs.map((l) => l.max.y)) : bodyBot;
  const hips = legs.length >= 2
    ? legs.slice(0, 2).map((l) => ({ x: (l.min.x + l.max.x) / 2, z: (l.min.z + l.max.z) / 2 }))
    : [{ x: 0, z: -bodyHalfZ * 0.35 }, { x: 0, z: bodyHalfZ * 0.35 }];
  hips.sort((a, b) => a.z - b.z);
  const shoulders = arms.length === 2 ? arms.map((a) => {
    const zIn = Math.abs(a.min.z) < Math.abs(a.max.z) ? a.min.z : a.max.z;
    return { x: (a.min.x + a.max.x) / 2, y: (a.min.y + a.max.y) / 2, z: zIn };
  }) : [{ x: 0, y: bodyBot + (bodyTop - bodyBot) * 0.45, z: -bodyHalfZ * 0.9 }, { x: 0, y: bodyBot + (bodyTop - bodyBot) * 0.45, z: bodyHalfZ * 0.9 }];
  shoulders.sort((a, b) => a.z - b.z);

  // normaliza: centro en x/z, suelo en y=0, alto total = CHAR_HEIGHT
  const k = CHAR_HEIGHT / H;
  const cx = (body.min.x + body.max.x) / 2, cz = (body.min.z + body.max.z) / 2;
  geo.translate(-cx, -bb.min.y, -cz);
  geo.scale(k, k, k);
  geo.computeBoundingBox();
  geo.computeVertexNormals();

  const S = (v, base) => (v - base) * k;
  const rig = {
    legLen: S(hipY, bb.min.y),
    hips: hips.map((h) => ({ x: S(h.x, cx), z: S(h.z, cz) })),
    shoulders: shoulders.map((s) => ({ x: S(s.x, cx), y: S(s.y, bb.min.y), z: S(s.z, cz) })),
    bodyHalfZ: bodyHalfZ * k,
    bodyHalfX: Math.max(Math.abs(body.min.x - cx), Math.abs(body.max.x - cx)) * k,
    top: geo.boundingBox.max.y,
  };
  rig.armLen = Math.max(0.42, Math.min(0.7, (bodyTop - bodyBot) * k * 0.42));
  // separación mínima entre caderas para que se vean los pies
  if (Math.abs(rig.hips[1].z - rig.hips[0].z) < 0.16) { rig.hips[0].z = -0.09; rig.hips[1].z = 0.09; }

  const map = srcMat && srcMat.map ? srcMat.map : null;
  if (map) map.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshToonMaterial({
    map, color: map ? 0xffffff : (srcMat && srcMat.color ? srcMat.color : 0xffcc66),
    gradientMap: toonGradient(),
  });
  const outlineGeo = makeOutlineGeometry(geo, 0.028);
  return { def, geo, material, outlineGeo, rig };
}

export async function loadCharacters(base, onProgress) {
  const loader = new GLTFLoader();
  const out = new Map();
  let done = 0;
  await Promise.all(CHARACTERS.map(async (def) => {
    try {
      const gltf = await loader.loadAsync(base + def.id + '.glb');
      out.set(def.id, buildTemplate(gltf, def));
    } catch (e) {
      console.warn('No se pudo cargar', def.id, e);
    }
    done++;
    onProgress && onProgress(done / CHARACTERS.length);
  }));
  return out;
}

// ------------------------------------------------------- manguera (tubo)
const RADIAL = 6, SEGS = 10;
class Hose {
  constructor(radius, material) {
    this.radius = radius;
    const verts = (SEGS + 1) * RADIAL;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(verts * 3);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    const idx = [];
    for (let s = 0; s < SEGS; s++) for (let r = 0; r < RADIAL; r++) {
      const a = s * RADIAL + r, b = s * RADIAL + (r + 1) % RADIAL, c = (s + 1) * RADIAL + r, d = (s + 1) * RADIAL + (r + 1) % RADIAL;
      idx.push(a, c, b, b, c, d);
    }
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.frustumCulled = false;
    this._p = new THREE.Vector3(); this._t = new THREE.Vector3(); this._n = new THREE.Vector3(); this._b = new THREE.Vector3();
  }
  /** Curva cuadrática a→c con control b. */
  set(a, b, c) {
    const P = this._p, T = this._t, Nn = this._n, B = this._b;
    for (let s = 0; s <= SEGS; s++) {
      const u = s / SEGS, iu = 1 - u;
      P.set(iu * iu * a.x + 2 * iu * u * b.x + u * u * c.x, iu * iu * a.y + 2 * iu * u * b.y + u * u * c.y, iu * iu * a.z + 2 * iu * u * b.z + u * u * c.z);
      T.set(2 * iu * (b.x - a.x) + 2 * u * (c.x - b.x), 2 * iu * (b.y - a.y) + 2 * u * (c.y - b.y), 2 * iu * (b.z - a.z) + 2 * u * (c.z - b.z)).normalize();
      Nn.set(0, 0, 1); if (Math.abs(T.z) > 0.9) Nn.set(1, 0, 0);
      B.crossVectors(T, Nn).normalize(); Nn.crossVectors(B, T).normalize();
      const rr = this.radius * (s === 0 ? 0.9 : 1);
      for (let r = 0; r < RADIAL; r++) {
        const ang = (r / RADIAL) * Math.PI * 2, cs = Math.cos(ang) * rr, sn = Math.sin(ang) * rr;
        const o = (s * RADIAL + r) * 3;
        this.pos[o] = P.x + Nn.x * cs + B.x * sn;
        this.pos[o + 1] = P.y + Nn.y * cs + B.y * sn;
        this.pos[o + 2] = P.z + Nn.z * cs + B.z * sn;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}

const HOSE_MAT = new THREE.MeshBasicMaterial({ color: 0x141414 });
const GLOVE_GEO = new THREE.SphereGeometry(0.1, 12, 10);
const GLOVE_OUT = makeOutlineGeometry(GLOVE_GEO, 0.022);
const SHOE_GEO = (() => { const g = new THREE.SphereGeometry(0.1, 14, 10); g.scale(1.55, 0.72, 1.05); g.translate(0.06, 0.05, 0); return g; })();
const SHOE_OUT = makeOutlineGeometry(SHOE_GEO, 0.02);
let GLOVE_MAT = null, SHOE_MAT = null;

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

/** Un personaje animado. group = raíz (posición en el mundo). */
export class CharacterActor {
  constructor(template, accentColor) {
    if (!GLOVE_MAT) {
      GLOVE_MAT = new THREE.MeshToonMaterial({ color: 0xfff8ea, gradientMap: toonGradient() });
      SHOE_MAT = new THREE.MeshToonMaterial({ color: 0x2a1a14, gradientMap: toonGradient() });
    }
    this.t = template;
    const rig = template.rig;
    this.rig = rig;
    this.group = new THREE.Group();     // posición/orientación en el mundo
    this.facing = new THREE.Group();    // giro hacia la dirección de carrera
    this.group.add(this.facing);
    this.bodyPivot = new THREE.Group(); // squash & stretch + inclinación
    this.facing.add(this.bodyPivot);
    this.body = new THREE.Mesh(template.geo, template.material);
    this.outline = new THREE.Mesh(template.outlineGeo, INK);
    this.bodyPivot.add(this.body, this.outline);
    this.body.position.y = 0; // la geometría ya tiene los pies en y=0 (sin piernas, el cuerpo empieza en legLen)

    // extremidades (en el espacio de "facing", no se deforman con el squash)
    this.legs = [0, 1].map(() => new Hose(0.034, HOSE_MAT));
    this.arms = [0, 1].map(() => new Hose(0.03, HOSE_MAT));
    this.shoes = [0, 1].map(() => { const g = new THREE.Group(); g.add(new THREE.Mesh(SHOE_GEO, SHOE_MAT), new THREE.Mesh(SHOE_OUT, INK)); return g; });
    this.gloves = [0, 1].map(() => { const g = new THREE.Group(); g.add(new THREE.Mesh(GLOVE_GEO, GLOVE_MAT), new THREE.Mesh(GLOVE_OUT, INK)); return g; });
    [...this.legs, ...this.arms].forEach((h) => this.facing.add(h.mesh));
    [...this.shoes, ...this.gloves].forEach((m) => this.facing.add(m));

    // sombra/marcador de color en el suelo
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.4, 28), new THREE.MeshBasicMaterial({ color: accentColor || 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02;
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.3, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.015;
    this.ground = new THREE.Group(); this.ground.add(shadow, ring);
    this.group.add(this.ground);
    this.ring = ring;

    this.cycle = Math.random() * 10;
    this.heading = 0;       // ángulo actual de giro (y)
    this.squash = 0;        // >0 estirado, <0 aplastado
    this.squashV = 0;
    this.koSpin = 0;
  }

  setAccent(color) { this.ring.material.color.set(color); }

  /** Dirección hacia la que mira: dirX = -1 (izquierda) / +1 (derecha), con giro 3/4 a la cámara. */
  faceTowards(dirX, dt, instant) {
    const target = dirX < 0 ? Math.PI + 0.6 : -0.6; // el frente del modelo es +X; giro 3/4 hacia la cámara
    let d = target - this.heading;
    while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    this.heading = instant ? target : this.heading + d * Math.min(1, dt * 12);
    this.facing.rotation.y = this.heading;
  }

  kick(amount) { this.squashV += amount; }

  /**
   * st = { mode: 'idle'|'walk'|'run'|'jump'|'ko', speed, air (alto de salto), vyUp(bool),
   *        airT (0..1 progreso del salto), beat (fase 0..1), beatIndex }
   */
  update(dt, st) {
    const r = this.rig;
    // resorte del squash
    this.squashV += (-this.squash * 220 - this.squashV * 16) * dt;
    this.squash += this.squashV * dt;
    const sq = Math.max(-0.35, Math.min(0.35, this.squash));

    let cyc = this.cycle;
    if (st.mode === 'run') cyc = this.cycle += dt * (7 + st.speed * 1.1);
    else if (st.mode === 'walk') cyc = this.cycle += dt * 6.5;
    else cyc = this.cycle;

    const L = r.legLen;
    let bob = 0, lean = 0;
    const beatPulse = st.beat !== undefined ? Math.pow(1 - st.beat, 3) : 0;
    const legT = [], armT = [];

    if (st.mode === 'run' || st.mode === 'walk') {
      const stride = st.mode === 'run' ? Math.min(0.42, L * 0.75) : L * 0.4;
      const lift = st.mode === 'run' ? L * 0.45 : L * 0.25;
      bob = Math.abs(Math.sin(cyc)) * (st.mode === 'run' ? 0.09 : 0.05);
      lean = st.mode === 'run' ? -0.16 : -0.05;
      for (let i = 0; i < 2; i++) {
        const ph = cyc + i * Math.PI;
        legT.push({ x: Math.sin(ph) * stride, y: Math.max(0, Math.cos(ph)) * lift });
        armT.push({ x: -Math.sin(ph) * r.armLen * 0.75, y: -r.armLen * 0.55, z: 0 });
      }
    } else if (st.mode === 'jump') {
      const up = st.vyUp;
      lean = up ? -0.08 : 0.05;
      for (let i = 0; i < 2; i++) {
        legT.push({ x: (i ? 0.12 : -0.18) * (up ? 1 : 0.5), y: L * (up ? 0.5 : 0.25) });
        armT.push({ x: 0.08, y: r.armLen * (up ? 0.85 : 0.6), z: (i ? 1 : -1) * r.armLen * 0.35 });
      }
    } else if (st.mode === 'grind') {
      // postura de skater: piernas abiertas (una adelante, otra atrás), rodillas
      // flexionadas, brazos abiertos haciendo equilibrio
      this.cycle += dt * 9;
      const wob = Math.sin(this.cycle) * 0.12;
      bob = -0.06 + Math.sin(this.cycle * 2) * 0.015;
      lean = 0.05 + wob * 0.3;
      legT.push({ x: -0.32, y: 0.04 });
      legT.push({ x: 0.3, y: 0.02 });
      for (let i = 0; i < 2; i++) {
        armT.push({ x: (i ? 0.15 : -0.15), y: r.armLen * (0.15 + (i ? wob : -wob)), z: (i ? 1 : -1) * r.armLen * 0.85 });
      }
    } else if (st.mode === 'ko') {
      this.koSpin += dt * 14;
      for (let i = 0; i < 2; i++) {
        legT.push({ x: Math.sin(this.koSpin + i * 2) * 0.3, y: L * 0.4 });
        armT.push({ x: Math.cos(this.koSpin + i * 3) * 0.3, y: r.armLen * 0.7, z: (i ? 1 : -1) * r.armLen * 0.5 });
      }
    } else { // idle: baila al ritmo
      const b = st.beatIndex || 0;
      bob = -beatPulse * 0.1;
      for (let i = 0; i < 2; i++) {
        const tap = ((b + i) % 2 === 0) ? beatPulse * L * 0.3 : 0;
        legT.push({ x: (i ? 0.06 : -0.06), y: tap });
        const wave = ((b + i) % 2 === 0);
        armT.push({ x: 0.05, y: wave ? r.armLen * (0.4 + 0.5 * beatPulse) : -r.armLen * 0.4, z: (i ? 1 : -1) * r.armLen * (wave ? 0.55 : 0.35) });
      }
    }

    // cuerpo
    const sy = 1 + sq, sxz = 1 - sq * 0.5;
    this.bodyPivot.scale.set(sxz, sy, sxz);
    this.bodyPivot.position.y = bob;
    this.bodyPivot.rotation.z = lean;
    // en K.O. gira TODO el personaje (cuerpo + extremidades) como en las caricaturas
    this.bodyPivot.rotation.x = 0;
    this.facing.rotation.x = st.mode === 'ko' ? this.koSpin : 0;

    // piernas: de la cadera (dentro del cuerpo) al pie
    for (let i = 0; i < 2; i++) {
      const h = r.hips[i];
      const hipY = (L + 0.04) * sy + bob;
      _a.set(h.x, hipY, h.z);
      _c.set(h.x + legT[i].x, legT[i].y, h.z * 1.15);
      const dist = _a.distanceTo(_c);
      const slack = Math.max(0, L + 0.04 - dist);
      _b.set((_a.x + _c.x) / 2 + slack * 1.2 + 0.02, (_a.y + _c.y) / 2, (_a.z + _c.z) / 2);
      this.legs[i].set(_a, _b, _c);
      this.shoes[i].position.copy(_c);
      this.shoes[i].rotation.z = st.mode === 'jump' ? -0.5 : -legT[i].x * 0.8;
    }
    // brazos
    for (let i = 0; i < 2; i++) {
      const s = r.shoulders[i];
      const side = i ? 1 : -1;
      _a.set(s.x * sxz, (s.y - 0) * sy + bob, s.z * sxz);
      _c.set(_a.x + armT[i].x, _a.y + armT[i].y, _a.z + side * Math.abs(armT[i].z) + side * 0.12);
      const dist = _a.distanceTo(_c);
      const slack = Math.max(0, r.armLen - dist);
      _b.set((_a.x + _c.x) / 2 - slack * 0.6, (_a.y + _c.y) / 2 + slack * 0.6, (_a.z + _c.z) / 2 + side * slack * 0.3);
      this.arms[i].set(_a, _b, _c);
      this.gloves[i].position.copy(_c);
    }
  }
}
