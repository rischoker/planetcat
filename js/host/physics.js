// =====================================================================
//  GATO SWING · Física compartida (juego + generador de ritmo + tests)
//  Todas las medidas en "unidades de mundo". El radio de la rueda (cabeza
//  del gato) es R. "s" es la distancia a lo largo de la superficie.
//
//  Salto "flotante" de caricatura (~1,1 s en el aire) + DOBLE SALTO.
//  Una trayectoria es una lista de tramos {t, h, v}: despegue en t con
//  altura h y velocidad vertical v. El doble salto agrega un segundo tramo.
// =====================================================================

export const PHYS = {
  R: 7.5,             // radio de la cabeza-rueda
  DEPTH: 4.4,         // grosor de la rueda (carriles de jugadores en z)
  G: 16.5,            // gravedad (baja = más "vuelo")
  JUMP_V: 8.9,        // velocidad del primer salto
  DJ_V: 6.6,          // velocidad del doble salto
  DJ_MIN: 0.08,       // tiempo mínimo en el aire antes de poder hacer doble salto
  PLAYER_HALF_W: 0.26,// mitad del ancho del hitbox del jugador (más angosto que el modelo = justo)
  PLAYER_H: 1.25,     // alto del hitbox del jugador
  SPAWN_ARC: 1.3,     // ángulo (rad) desde la cima donde aparecen los obstáculos
  EXIT_ARC: 0.75,     // ángulo (rad) pasado el jugador donde desaparecen (puf)
  STEP: 1 / 240,      // paso fijo de simulación de colisiones
  JUMP_BUFFER: 0.15,  // si presionas saltar justo antes de aterrizar, se guarda
  // ---- barandas para patinar (notas largas)
  RAIL_H: 1.55,       // altura de la baranda
  SPIKE_H: 0.5,       // pinchos debajo de la baranda
  POP_V: 6.0,         // saltito automático al terminar la baranda
  SLIP_GRACE: 0.28,   // s que puedes soltar el botón antes de resbalar
  POST_HW: 0.07,      // medio ancho del poste de la baranda
};
PHYS.AIR_TIME = (2 * PHYS.JUMP_V) / PHYS.G;                         // ≈ 1,08 s
PHYS.APEX = (PHYS.JUMP_V * PHYS.JUMP_V) / (2 * PHYS.G);              // ≈ 2,4 u
PHYS.DJ_EXTRA = (PHYS.DJ_V * PHYS.DJ_V) / (2 * PHYS.G);              // ≈ +1,3 u

// ------------------------------------------------------------ trayectorias
export function segHeight(seg, t) {
  const dt = t - seg.t;
  return seg.h + seg.v * dt - 0.5 * PHYS.G * dt * dt;
}
/** Momento en que la trayectoria vuelve al suelo. */
export function landTime(segs) {
  const s = segs[segs.length - 1];
  return s.t + (s.v + Math.sqrt(s.v * s.v + 2 * PHYS.G * s.h)) / PHYS.G;
}
/** Altura de los pies en el tiempo t (0 en el suelo). */
export function heightAt(segs, t) {
  if (!segs || !segs.length || t <= segs[0].t) return 0;
  let s = segs[0];
  for (let i = 1; i < segs.length; i++) if (segs[i].t <= t) s = segs[i];
  const h = segHeight(s, t);
  return h > 0 ? h : 0;
}
/** Crea una trayectoria: salto en t0 y (opcional) doble salto en t1. */
export function makeTraj(t0, t1) {
  const segs = [{ t: t0, h: 0, v: PHYS.JUMP_V }];
  if (t1 !== null && t1 !== undefined && t1 >= t0 + PHYS.DJ_MIN && t1 < landTime(segs)) {
    segs.push({ t: t1, h: segHeight(segs[0], t1), v: PHYS.DJ_V });
  }
  return segs;
}

// ---------------------------------------------------------------------
//  Perfiles de colisión. Cada obstáculo es una unión de primitivas en
//  coordenadas locales (x = a lo largo de la superficie, centrado en el
//  obstáculo; y = altura desde el suelo). Los MISMOS números construyen
//  la malla 3D, así que lo que ves es exactamente lo que golpea.
//    box:  {t:'box', x0, x1, y0, y1}
//    circ: {t:'circ', cx, cy, r}
//    tri:  {t:'tri', x0, x1, y0, y1}   (triángulo isósceles, punta arriba)
// ---------------------------------------------------------------------

/** ¿Choca el rectángulo del jugador (pies en `feet`) con el obstáculo centrado en `s`? */
export function hitTest(s, feet, prims) {
  const hw = PHYS.PLAYER_HALF_W;
  const top = feet + PHYS.PLAYER_H;
  for (let i = 0; i < prims.length; i++) {
    const p = prims[i];
    if (p.t === 'box') {
      if (s + p.x0 < hw && s + p.x1 > -hw && feet < p.y1 && top > p.y0) return true;
    } else if (p.t === 'circ') {
      const cx = s + p.cx;
      const nx = Math.max(-hw, Math.min(hw, cx));
      const ny = Math.max(feet, Math.min(top, p.cy));
      const dx = cx - nx, dy = p.cy - ny;
      if (dx * dx + dy * dy < p.r * p.r) return true;
    } else if (p.t === 'tri') {
      const a = Math.max(-hw, s + p.x0);
      const b = Math.min(hw, s + p.x1);
      if (a >= b) continue;
      const c = s + (p.x0 + p.x1) / 2;
      const half = (p.x1 - p.x0) / 2;
      let peak;
      if (c >= a && c <= b) peak = p.y1;
      else {
        const e = c < a ? a : b;
        peak = p.y0 + (p.y1 - p.y0) * (1 - Math.abs(e - c) / half);
      }
      if (feet < peak && top > p.y0) return true;
    }
  }
  return false;
}

/** Caja envolvente de un perfil: {x0,x1,h}. */
export function profileBounds(prims) {
  let x0 = Infinity, x1 = -Infinity, h = 0;
  for (const p of prims) {
    if (p.t === 'circ') {
      x0 = Math.min(x0, p.cx - p.r); x1 = Math.max(x1, p.cx + p.r); h = Math.max(h, p.cy + p.r);
    } else {
      x0 = Math.min(x0, p.x0); x1 = Math.max(x1, p.x1); h = Math.max(h, p.y1);
    }
  }
  return { x0, x1, h };
}
export function reachOf(prims) {
  const b = profileBounds(prims);
  return Math.max(-b.x0, b.x1) + PHYS.PLAYER_HALF_W + 0.02;
}

/**
 * ¿La trayectoria esquiva todos los obstáculos del grupo?
 * obs = [{dt, prims, reach}]: dt = llegada relativa al ancla (t = 0).
 */
export function trajClears(segs, obs, v, step, margin = 0) {
  for (let k = 0; k < obs.length; k++) {
    const o = obs[k];
    const a = o.dt - o.reach / v - step, b = o.dt + o.reach / v + step;
    for (let t = a; t <= b; t += step) {
      if (hitTest(v * (t - o.dt), heightAt(segs, t) - margin, o.prims)) return false;
    }
  }
  return true;
}

/**
 * Planificador de saltos para un GRUPO de obstáculos (1, 2 o 3 seguidos).
 * Prueba todos los despegues posibles y, si hace falta, todos los momentos
 * de doble salto. Devuelve la ventana continua más larga de despegues que
 * funcionan y el mejor plan {t0, t1|null}. Tiempos relativos al ancla.
 */
export function planCluster(obs, v) {
  obs = obs.map((o) => Object.assign({ reach: reachOf(o.prims) }, o));
  const first = Math.min(...obs.map((o) => o.dt - o.reach / v));
  const t0From = first - PHYS.AIR_TIME - 0.15, t0To = first + 0.05;
  const coarse = 1 / 160;
  const results = [];
  for (let t0 = t0From; t0 <= t0To; t0 += 0.01) {
    let plan = null;
    if (trajClears(makeTraj(t0, null), obs, v, coarse)) plan = { t0, t1: null, djWin: 0 };
    else {
      // buscar el rango de doble salto que funciona
      const land = t0 + PHYS.AIR_TIME;
      let run = null, best = null;
      for (let t1 = t0 + PHYS.DJ_MIN + 0.02; t1 < land - 0.04; t1 += 0.025) {
        if (trajClears(makeTraj(t0, t1), obs, v, coarse)) { if (!run) run = { a: t1, b: t1 }; else run.b = t1; }
        else if (run) { if (!best || run.b - run.a > best.b - best.a) best = run; run = null; }
      }
      if (run && (!best || run.b - run.a > best.b - best.a)) best = run;
      if (best && best.b - best.a >= 0.1) plan = { t0, t1: (best.a + best.b) / 2, djWin: best.b - best.a };
    }
    results.push(plan);
  }
  // ventana continua más larga
  let bestRun = null, cur = null;
  results.forEach((p, i) => {
    if (p) { if (!cur) cur = { a: i, b: i }; else cur.b = i; }
    else if (cur) { if (!bestRun || cur.b - cur.a > bestRun.b - bestRun.a) bestRun = cur; cur = null; }
  });
  if (cur && (!bestRun || cur.b - cur.a > bestRun.b - bestRun.a)) bestRun = cur;
  if (!bestRun) return { ok: false, window: 0 };
  // El mejor despegue: centro del tramo más largo de UN SOLO TIPO (salto simple
  // o con doble salto) dentro de la ventana, lejos de los bordes; se verifica
  // con el paso fino del juego y 6 cm de margen de seguridad.
  const typed = [];
  let tc = null;
  for (let i = bestRun.a; i <= bestRun.b; i++) {
    const dj = results[i].t1 !== null;
    if (tc && tc.dj === dj) tc.b = i; else { tc = { a: i, b: i, dj }; typed.push(tc); }
  }
  typed.sort((x, y) => (y.b - y.a) - (x.b - x.a));
  const single = typed.find((x) => !x.dj);
  let pick = typed[0];
  if (single && (single.b - single.a) >= 0.6 * (pick.b - pick.a)) pick = single; // preferir salto simple
  const mid = Math.round((pick.a + pick.b) / 2);
  const order = [mid];
  for (let d = 1; d <= pick.b - pick.a; d++) order.push(mid - d, mid + d);
  for (const i of order) {
    if (i < pick.a || i > pick.b) continue;
    const p = results[i];
    const segs = makeTraj(p.t0, p.t1);
    if (trajClears(segs, obs, v, PHYS.STEP / 2, 0.06)) {
      return {
        ok: true,
        window: (bestRun.b - bestRun.a) * 0.01,
        from: results[bestRun.a].t0, to: results[bestRun.b].t0,
        t0: p.t0, t1: p.t1, djWin: p.djWin, land: landTime(segs),
      };
    }
  }
  return { ok: false, window: 0 };
}

// ---------------------------------------------------------------------
//  BARANDAS (grind). Una baranda llega con su frente en t = 0 y su cola
//  pasa por el jugador en tEnd = L / v. Debajo hay pinchos.
//  Perfil en coordenadas del obstáculo (frente en x = 0, cuerpo hacia atrás
//  según el sentido `dir`): poste delantero + pinchos + poste trasero.
// ---------------------------------------------------------------------
export function railPrims(L, dir) {
  const prims = [];
  const hw = PHYS.POST_HW;
  prims.push({ t: 'box', x0: -hw, x1: hw, y0: 0, y1: PHYS.RAIL_H });              // poste delantero
  const sw = 0.55, n = Math.max(1, Math.floor((L - 0.2) / sw));
  for (let k = 0; k < n; k++) {
    const c = -dir * (0.1 + sw / 2 + k * sw);
    prims.push({ t: 'tri', x0: c - sw / 2, x1: c + sw / 2, y0: 0, y1: PHYS.SPIKE_H }); // pinchos
  }
  const e = -dir * L;
  prims.push({ t: 'box', x0: e - hw, x1: e + hw, y0: 0, y1: PHYS.RAIL_H });       // poste trasero
  return prims;
}
/** ¿El jugador (en rel = s_obs - s_jugador) está encima de la baranda? */
export function overRail(rel, L, dir) {
  const a = rel, b = rel - dir * L;
  const lo = Math.min(a, b), hi = Math.max(a, b);
  return 0 >= lo - 0.05 && 0 <= hi + 0.05;
}
export function popAirTime() {
  const v = PHYS.POP_V, h = PHYS.RAIL_H;
  return (v + Math.sqrt(v * v + 2 * PHYS.G * h)) / PHYS.G;
}

/**
 * Plan para subirse a una baranda: despegues t0 (relativos a la llegada del
 * frente) con los que pasas sobre el poste y bajas ENCIMA de la baranda
 * antes de que termine. Luego patinas hasta el final y sale el saltito.
 */
export function planRail(L, v) {
  const tEnd = L / v;
  const postR = PHYS.POST_HW + PHYS.PLAYER_HALF_W + 0.02;
  const prims = railPrims(L, 1);
  const results = [];
  for (let t0 = -PHYS.AIR_TIME - 0.2; t0 <= 0.15; t0 += 0.01) {
    const segs = makeTraj(t0, null);
    let ok = true;
    // 1) pasar por encima del poste delantero (y de los pinchos mientras tanto)
    for (let t = -postR / v - PHYS.STEP; t <= postR / v + PHYS.STEP; t += PHYS.STEP) {
      if (hitTest(v * t, heightAt(segs, t), prims)) { ok = false; break; }
    }
    // 2) bajar sobre la baranda (cruzar RAIL_H descendiendo) antes del final
    let tc = null;
    if (ok) {
      for (let t = postR / v; t < tEnd; t += PHYS.STEP) {
        const h = heightAt(segs, t);
        if (h < PHYS.RAIL_H) { tc = t; break; }
      }
      if (tc === null || tc > tEnd - 0.25) ok = false;
    }
    results.push(ok ? { t0, tc } : null);
  }
  let best = null, cur = null;
  results.forEach((p, i) => {
    if (p) { if (!cur) cur = { a: i, b: i }; else cur.b = i; }
    else if (cur) { if (!best || cur.b - cur.a > best.b - best.a) best = cur; cur = null; }
  });
  if (cur && (!best || cur.b - cur.a > best.b - best.a)) best = cur;
  if (!best) return { ok: false, window: 0 };
  const mid = results[Math.round((best.a + best.b) / 2)];
  return {
    ok: true, rail: true,
    window: (best.b - best.a) * 0.01, from: results[best.a].t0, to: results[best.b].t0,
    t0: mid.t0, t1: null, tLand: mid.tc, tEnd, land: tEnd + popAirTime(),
  };
}
