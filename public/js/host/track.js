// =====================================================================
//  PISTA (modo "pista"): el gato se estira al infinito. Una autopista de
//  4 carriles de colores (estilo Rock Band) que sale de la boca del gato y
//  llega hasta los jugadores. Las líneas de compás avanzan al ritmo y cada
//  carril brilla con la energía de la música.
// =====================================================================
import * as THREE from 'three';
import { TRACK, LANE_COLORS } from './stemchart.js';

export const PISTA_CAT = { Z: -72, SCALE: 2.2 };

export function laneX(i) { return (i - 1.5) * TRACK.LANE_W; }

export class Track {
  constructor(scene, R) {
    this.R = R;
    this.far = -PISTA_CAT.Z - 2;           // distancia desde z=0 hasta el fondo (boca del gato)
    this.len = this.far + TRACK.NEAR;      // largo total
    this.width = 4 * TRACK.LANE_W;
    this.group = new THREE.Group();
    this.group.position.set(0, R, -this.far);
    this.group.visible = false;
    scene.add(this.group);
    // la geometría empieza en z=0 (fondo) y crece hacia +z: escalar z = "estirarse"
    const W = this.width, L = this.len;

    // ---- base: carriles de color con separadores
    const base = document.createElement('canvas'); base.width = 512; base.height = 16;
    const g = base.getContext('2d');
    const lw = 512 / 4;
    LANE_COLORS.forEach((c, i) => {
      g.fillStyle = c; g.fillRect(i * lw, 0, lw, 16);
      g.fillStyle = 'rgba(10,10,30,0.55)'; g.fillRect(i * lw, 0, lw, 16);         // más oscuro: el brillo lo da la energía
      g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(i * lw + lw * 0.3, 0, lw * 0.4, 16);
    });
    g.fillStyle = '#141414';
    for (let i = 1; i < 4; i++) g.fillRect(i * lw - 3, 0, 6, 16);
    const baseTex = new THREE.CanvasTexture(base); baseTex.colorSpace = THREE.SRGBColorSpace; baseTex.anisotropy = 8;
    const geo = new THREE.PlaneGeometry(W, L); geo.rotateX(-Math.PI / 2); geo.translate(0, 0, L / 2);
    this.base = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: baseTex }));
    this.group.add(this.base);

    // ---- brillo por carril (energía de cada instrumento)
    this.glows = LANE_COLORS.map((c, i) => {
      const gg = new THREE.PlaneGeometry(TRACK.LANE_W * 0.9, L); gg.rotateX(-Math.PI / 2); gg.translate(laneX(i), 0.01, L / 2);
      const m = new THREE.Mesh(gg, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.group.add(m);
      return m;
    });

    // ---- líneas de compás (se mueven al ritmo)
    const fr = document.createElement('canvas'); fr.width = 32; fr.height = 256;
    const f = fr.getContext('2d');
    f.clearRect(0, 0, 32, 256);
    for (let k = 0; k < 4; k++) {
      const y = 256 - (k * 64) - (k === 0 ? 12 : 6);
      f.fillStyle = k === 0 ? 'rgba(255,250,240,0.95)' : 'rgba(255,250,240,0.45)';
      f.fillRect(0, y, 32, k === 0 ? 12 : 6);
    }
    this.fretTex = new THREE.CanvasTexture(fr);
    this.fretTex.wrapT = THREE.RepeatWrapping; this.fretTex.colorSpace = THREE.SRGBColorSpace;
    const fg = new THREE.PlaneGeometry(W, L); fg.rotateX(-Math.PI / 2); fg.translate(0, 0.02, L / 2);
    this.frets = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ map: this.fretTex, transparent: true, depthWrite: false }));
    this.group.add(this.frets);

    // ---- bordes: listones crema con rayas rojas y contorno negro
    const ed = document.createElement('canvas'); ed.width = 64; ed.height = 64;
    const e = ed.getContext('2d');
    e.fillStyle = '#f3e3c3'; e.fillRect(0, 0, 64, 64); e.fillStyle = '#e3262f'; e.fillRect(0, 0, 64, 28);
    const edTex = new THREE.CanvasTexture(ed); edTex.wrapS = edTex.wrapT = THREE.RepeatWrapping; edTex.repeat.set(1, L / 2); edTex.colorSpace = THREE.SRGBColorSpace;
    this.edgeTex = edTex;
    [-1, 1].forEach((sd) => {
      const bg = new THREE.BoxGeometry(0.35, 0.32, L); bg.translate(sd * (W / 2 + 0.17), 0.1, L / 2);
      this.group.add(new THREE.Mesh(bg, new THREE.MeshBasicMaterial({ map: edTex })));
      const og = new THREE.BoxGeometry(0.47, 0.44, L + 0.1); og.translate(sd * (W / 2 + 0.17), 0.1, L / 2);
      this.group.add(new THREE.Mesh(og, new THREE.MeshBasicMaterial({ color: 0x141414, side: THREE.BackSide })));
    });
    // costado oscuro (para que la pista tenga grosor)
    const sg = new THREE.BoxGeometry(W + 0.7, 1.2, L); sg.translate(0, -0.62, L / 2);
    this.group.add(new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: 0x1b1240 })));
    this.k = 0;
  }

  /**
   * k = 0..1 cuánto se ha estirado; beatPos = beats desde el último tiempo 1
   * (índice + fase); v = velocidad de los obstáculos; energies = [4] 0..1.
   */
  update(k, beatPos, bd, v, energies) {
    this.k = k;
    const vis = k > 0.002;
    this.group.visible = vis;
    if (!vis) return;
    const ek = k < 1 ? 1 - Math.pow(1 - k, 3) : 1;
    this.group.scale.set(1, 1, Math.max(0.001, ek));
    // líneas de compás: una textura = 1 compás (4 beats); avanzan con la música
    const rep = this.len / Math.max(0.5, v * bd * 4);
    this.fretTex.repeat.set(1, rep);
    const v0 = TRACK.NEAR / this.len; // coordenada v del jugador (z = 0)
    const bar = ((beatPos % 4) + 4) % 4 / 4;
    this.fretTex.offset.y = bar - v0 * rep;
    this.edgeTex.offset.y = -bar * 2;
    this.glows.forEach((m, i) => { m.material.opacity = 0.08 + 0.5 * Math.min(1, (energies && energies[i]) || 0); });
  }
}
