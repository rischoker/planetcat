// =====================================================================
//  Catálogo de obstáculos (solo datos, sin THREE). Cada tipo genera su
//  perfil de colisión a partir de un tamaño. El constructor de mallas
//  (obstacles3d.js) usa estas mismas primitivas para dibujarlos.
// =====================================================================

// w = ancho total a lo largo de la superficie, h = alto total
export const KINDS = {
  crate: {   // caja de madera
    label: 'Caja', w: [0.7, 1.5], h: [0.55, 1.25],
    prims: (w, h) => [{ t: 'box', x0: -w / 2, x1: w / 2, y0: 0, y1: h }],
  },
  log: {     // tronco rodante (círculo)
    label: 'Tronco', w: [0.7, 1.3], h: null,
    prims: (w) => [{ t: 'circ', cx: 0, cy: w / 2, r: w / 2 }],
  },
  cones: {   // carpa de circo (triángulo)
    label: 'Carpa', w: [0.9, 1.7], h: [0.6, 1.35],
    prims: (w, h) => [{ t: 'tri', x0: -w / 2, x1: w / 2, y0: 0, y1: h }],
  },
  tophat: {  // sombreros de copa: ala + copa
    label: 'Sombreros', w: [0.8, 1.2], h: [0.7, 1.3],
    prims: (w, h) => [
      { t: 'box', x0: -w / 2, x1: w / 2, y0: 0, y1: 0.12 },
      { t: 'box', x0: -w * 0.32, x1: w * 0.32, y0: 0.12, y1: h },
    ],
  },
  cans: {    // latas de sardinas
    label: 'Latas', w: [0.55, 0.9], h: [0.55, 1.2],
    prims: (w, h) => [{ t: 'box', x0: -w / 2, x1: w / 2, y0: 0, y1: h }],
  },
  anvil: {   // yunque clásico de caricatura
    label: 'Yunques', w: [1.0, 1.5], h: [0.7, 1.05],
    prims: (w, h) => [
      { t: 'box', x0: -w * 0.34, x1: w * 0.34, y0: 0, y1: h * 0.22 },
      { t: 'box', x0: -w * 0.16, x1: w * 0.16, y0: h * 0.22, y1: h * 0.62 },
      { t: 'box', x0: -w / 2, x1: w / 2, y0: h * 0.62, y1: h },
    ],
  },
  yarn: {    // ovillos de lana
    label: 'Ovillos', w: [0.6, 1.1], h: null,
    prims: (w) => [{ t: 'circ', cx: 0, cy: w / 2, r: w / 2 }],
  },
  bomb: {    // bombas de caricatura
    label: 'Bombas', w: [0.7, 1.15], h: null,
    prims: (w) => [{ t: 'circ', cx: 0, cy: w / 2, r: w / 2 }],
  },
  hurdle: {  // valla de vodevil
    label: 'Valla', w: [0.3, 0.45], h: [0.8, 1.4],
    prims: (w, h) => [{ t: 'box', x0: -w / 2, x1: w / 2, y0: 0, y1: h }],
  },
};

export const KIND_LIST = Object.keys(KINDS);

/** Crea los datos de un obstáculo con tamaño normalizado `size` (0 = mínimo, 1 = máximo). */
export function makeObstacleShape(kind, sizeW, sizeH) {
  const K = KINDS[kind];
  const w = K.w[0] + (K.w[1] - K.w[0]) * sizeW;
  const h = K.h ? K.h[0] + (K.h[1] - K.h[0]) * sizeH : w;
  return { kind, w, h, prims: K.prims(w, h) };
}
