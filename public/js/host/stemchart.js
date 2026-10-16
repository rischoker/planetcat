// =====================================================================
//  Partitura a partir de STEMS (chart.json del cuaderno de Colab).
//
//  Cada sección de la canción trae su MODO del gato:
//   - TAMBOR: la rueda con 4 carriles, uno por STEM (batería, bajo, voz,
//     otros). Cada carril recibe los obstáculos de SU instrumento; a cada
//     jugador le toca un instrumento (rota por sección). Las notas largas
//     de bajo/voz/otros son barandas en su carril.
//   - SERPIENTE: el borde de la cabeza ondula; obstáculos en todo el ancho
//     sobre los golpes de batería y bajo, con preferencia por el pulso
//     (saltar al ritmo, grupos con doble salto).
//   - PISTA: el gato se estira al infinito (pista estilo Rock Band, 4
//     carriles). Notas largas de voz/otros/bajo → barandas en el carril que
//     marca su altura; golpes de batería → obstáculos en 1–2 carriles (siempre
//     queda carril libre); notas cortas de voz → notas ♪ para recoger.
//  Todo grupo se valida con la física real (planCluster / planRail).
//  Solo datos (sin THREE): corre en un Worker.
// =====================================================================
import { PHYS, planCluster, planRail, railPrims } from './physics.js';
import { KIND_LIST, makeObstacleShape } from './catalog.js';
import { mulberry32 } from './chart.js';

export const STEM_LANES = ['drums', 'bass', 'vocals', 'other'];
export const PISTA_LANES = ['L0', 'L1', 'L2', 'L3'];
export const STEM_INFO = {
  drums: { label: 'Batería', icon: '🥁', color: '#e3262f' },
  bass: { label: 'Bajo', icon: '🎸', color: '#ffb000' },
  vocals: { label: 'Voz', icon: '🎤', color: '#2fbf71' },
  other: { label: 'Otros', icon: '🎹', color: '#3e7bff' },
};
export const LANE_COLORS = ['#2fbf71', '#e3262f', '#ffb000', '#3e7bff']; // pista: verde, rojo, ámbar, azul
export const MODE_INFO = {
  tambor: { label: 'Tambor', icon: '🥁', sign: '¡Modo TAMBOR!', sub: 'Cada uno sigue su instrumento' },
  serpiente: { label: 'Serpiente', icon: '🐍', sign: '¡Modo SERPIENTE!', sub: '¡Salta al ritmo!' },
  pista: { label: 'Pista', icon: '🛹', sign: '¡Modo PISTA!', sub: '◀ ▶ cambia de carril · mantén para patinar' },
};
export const TRACK = { SPAWN: 56, LANE_W: 1.7, NEAR: 7 };

const SD = {
  facil:   { travel: 2.5,  pTravel: 2.7, thr: 0.62, pat2: 0.1,  pat3: 0,    minWindow: 0.16, sizeMul: 0.8, rail: 0.55, coin: 0.45, block2: 0.12, gap: 0.55, dens: 1.5 },
  normal:  { travel: 2.25, pTravel: 2.4, thr: 0.5,  pat2: 0.24, pat3: 0.07, minWindow: 0.12, sizeMul: 1.0, rail: 0.75, coin: 0.65, block2: 0.3,  gap: 0.35, dens: 1.15 },
  dificil: { travel: 2.0,  pTravel: 2.1, thr: 0.4,  pat2: 0.34, pat3: 0.16, minWindow: 0.09, sizeMul: 1.0, rail: 0.9,  coin: 0.85, block2: 0.45, gap: 0.2,  dens: 0.9 },
};
const CLEAR = 1.2;     // s sin llegadas antes de un cambio de sección
const MIN_SEP = 0.17;  // separación mínima entre obstáculos de un grupo

/** Velocidad de los obstáculos según el modo. */
export function modeSpeed(mode, travel) { return mode === 'pista' ? TRACK.SPAWN / travel : (PHYS.SPAWN_ARC * PHYS.R) / travel; }

export function generateStemChart(sc, opts = {}) {
  const D = SD[opts.difficulty] || SD.normal;
  const rng = mulberry32(opts.seed >>> 0 || 4321);
  const beats = sc.beats.slice();
  const bd = 60 / sc.bpm;
  const duration = sc.duration;
  const firstT = Math.max(4.0, opts.leadIn || 4.0);
  const lastT = duration - 1.5;
  const dbSet = sc.downbeats || [];
  const downbeatPhase = dbSet.length ? Math.max(0, beats.findIndex((b) => Math.abs(b - dbSet[0]) < 0.02)) % 4 : 0;

  // ---- segmentos: secciones seguidas con el mismo modo se juntan
  const secs = (sc.sections && sc.sections.length ? sc.sections : [{ start: 0, end: duration, mode: 'tambor', energy: 1 }]);
  const segs = [];
  secs.forEach((s) => {
    const mode = s.mode || 'tambor';
    const last = segs[segs.length - 1];
    if (last && last.mode === mode) { last.end = s.end; last.parts.push(s); }
    else segs.push({ start: s.start, end: s.end, mode, parts: [s] });
  });

  const events = [], clusters = [];
  const changes = [];
  const occurrences = {};
  let dir = rng() < 0.5 ? 1 : -1;
  let prevMode = null;

  segs.forEach((seg, si) => {
    const mode = seg.mode;
    const occ = occurrences[mode] = (occurrences[mode] || 0) + 1;
    const speedF = 1 + 0.07 * (occ - 1);
    const base = mode === 'pista' ? D.pTravel : D.travel;
    const travel = Math.max(base * 0.72, base / speedF);
    const v = modeSpeed(mode, travel);
    const wheel = mode !== 'pista';
    let rev = false;
    if (wheel) {
      if (prevMode && prevMode !== 'pista') { dir = -dir; rev = true; }
    }
    const evDir = wheel ? dir : 1;
    const modeChange = !!prevMode && prevMode !== mode;
    const geoChange = modeChange && (mode === 'pista' || prevMode === 'pista');
    const tChange = si === 0 ? -999 : seg.start;
    const winA = Math.max(firstT, (si === 0 ? 0 : seg.start) + travel + 0.35 + (geoChange ? 0.9 : 0));
    const winB = si === segs.length - 1 ? lastT : seg.end - CLEAR;
    const ch = { t: tChange, dir: evDir, travel, v, rev, speed: occ > 1, level: occ - 1, mode, modeChange, seg: si, start: seg.start, end: seg.end };
    // ondas de la serpiente: una ondulación cada 2 beats que viaja con los obstáculos
    if (mode === 'serpiente') ch.waveN = Math.max(6, Math.round((2 * Math.PI * PHYS.R) / (v * bd * 2)));
    changes.push(ch);
    prevMode = mode;
    if (winB - winA < 1) return;

    const ctx = { events, clusters, rng, D, mode, dir: evDir, v, travel, prevLand: {}, lastArr: {}, segIndex: si };
    if (mode === 'tambor') ch.lanesActive = genTambor(ctx, winA, winB);
    else if (mode === 'serpiente') genSerpiente(ctx, winA, winB);
    else genPista(ctx, winA, winB, seg);
  });

  // ---- ordenar por aparición (el juego las crea en orden de tSpawn)
  const cl = clusters.slice().sort((a, b) => a.anchor - b.anchor);
  cl.forEach((c, i) => { c.id = i; c.members.forEach((e) => { e.cluster = i; }); });
  events.sort((a, b) => a.tSpawn - b.tSpawn || a.tArr - b.tArr);
  events.forEach((e, i) => { e.id = i; });

  // fondos: la energía de cada sección elige la paleta
  const sections = secs.map((s) => {
    const e = s.energy === undefined ? 0.6 : s.energy;
    return { t: s.start, level: e < 0.4 ? 0 : e < 0.62 ? 1 : e < 0.86 ? 2 : 3, energy: e, mode: s.mode };
  });

  return {
    stem: true, title: sc.title,
    events, clusters: cl, changes, reversals: changes, sections, segs: segs.map((s) => ({ start: s.start, end: s.end, mode: s.mode })),
    bpm: sc.bpm, beatDur: bd, beats, duration, downbeatPhase, difficulty: opts.difficulty || 'normal',
    lives: 3, energy: sc.energy || null,
  };
}

// ------------------------------------------------------------------ ayudas
function pickKind(ctx) {
  let k; do { k = KIND_LIST[Math.floor(ctx.rng() * KIND_LIST.length)]; } while (k === ctx.prevKind && KIND_LIST.length > 1);
  ctx.prevKind = k; return k;
}

/**
 * Crea un grupo de obstáculos (1–3) validado con la física. `lanes[j]` es el
 * carril de cada miembro; laneSet = carriles de jugador posibles en el modo.
 */
function addCluster(ctx, members, lanes, laneSet, opt = {}) {
  const { D, rng, v, dir } = ctx;
  members = members.slice(); lanes = lanes.slice();
  const sizes = members.map((m) => {
    if (members.length === 1) {
      const big = Math.min(1, (m.s || 0.5) * 0.8 + rng() * 0.4) * D.sizeMul * (opt.sizeMul || 1);
      return { w: Math.min(1, big * (0.5 + rng() * 0.6)), h: Math.min(1, big * (0.5 + rng() * 0.6)) };
    }
    return { w: 0.1 + rng() * 0.35, h: 0.15 + rng() * 0.4 };
  });
  const kinds = members.map(() => pickKind(ctx));
  let ok = false, plans = null, shapes = null, tries = 0;
  while (!ok && members.length && tries++ < 10) {
    shapes = members.map((m, j) => makeObstacleShape(kinds[j], sizes[j].w, sizes[j].h));
    plans = {};
    let fitFail = false, gapFail = false;
    const t0 = members[0].t;
    for (const L of laneSet) {
      const obs = [];
      members.forEach((m, j) => { if (lanes[j] === 'all' || lanes[j] === L) obs.push({ dt: m.t - t0, prims: shapes[j].prims }); });
      if (!obs.length) { plans[L] = null; continue; }
      const pl = planCluster(obs, v);
      if (!pl.ok || pl.window < D.minWindow) { fitFail = true; break; }
      const pland = ctx.prevLand[L] === undefined ? -99 : ctx.prevLand[L];
      if (t0 + pl.from < pland + 0.05 || t0 + pl.t0 < pland + 0.2) { gapFail = true; break; }
      plans[L] = pl;
    }
    if (!fitFail && !gapFail) { ok = true; break; }
    if (gapFail || tries > 3) { members.pop(); lanes.pop(); sizes.pop(); kinds.pop(); }
    else sizes.forEach((s) => { s.w *= 0.75; s.h *= 0.8; });
  }
  if (!ok || !members.length) return null;
  const anchor = members[0].t;
  const c = { id: ctx.clusters.length, anchor, dir, v, travel: ctx.travel, plans, members: [], lastArr: members[members.length - 1].t, accent: members[0].s || 0.5, mode: ctx.mode };
  members.forEach((m, j) => {
    const sh = shapes[j];
    const ev = {
      id: 0, tArr: m.t, tSpawn: m.t - ctx.travel, dir, v, travel: ctx.travel, mode: ctx.mode,
      kind: sh.kind, w: sh.w, h: sh.h, prims: sh.prims, lane: lanes[j],
      cluster: c.id, ci: j, accent: m.s || 0.5, seed: Math.floor(rng() * 1e9),
    };
    ctx.events.push(ev); c.members.push(ev);
  });
  ctx.clusters.push(c);
  for (const L of laneSet) if (plans[L]) ctx.prevLand[L] = anchor + plans[L].land;
  for (const L of laneSet) if (plans[L]) ctx.lastArr[L] = Math.max(ctx.lastArr[L] || -99, c.lastArr);
  return c;
}

/** Baranda (nota larga) en un carril. dur en segundos. */
function addRail(ctx, t, dur, lane, laneSet, accent) {
  const { v, dir } = ctx;
  const L = v * dur;
  const pl = planRail(L, v);
  if (!pl.ok || pl.window < ctx.D.minWindow) return null;
  const lanesHit = lane === 'all' ? laneSet : [lane];
  for (const ln of lanesHit) {
    const pland = ctx.prevLand[ln] === undefined ? -99 : ctx.prevLand[ln];
    if (t + pl.from < pland + 0.05) return null;
    if (t < (ctx.lastArr[ln] === undefined ? -99 : ctx.lastArr[ln]) + 0.3) return null;
  }
  const c = { id: ctx.clusters.length, anchor: t, dir, v, travel: ctx.travel, plans: {}, members: [], lastArr: t + dur, accent, rail: true, mode: ctx.mode };
  for (const ln of laneSet) c.plans[ln] = lanesHit.includes(ln) ? pl : null;
  const ev = { id: 0, tArr: t, tSpawn: t - ctx.travel, dir, v, travel: ctx.travel, mode: ctx.mode, kind: 'rail', w: L, h: PHYS.RAIL_H,
    prims: railPrims(L, dir), lane, railL: L, tEnd: t + dur, cluster: c.id, ci: 0, accent, seed: Math.floor(ctx.rng() * 1e9) };
  c.members.push(ev);
  ctx.events.push(ev); ctx.clusters.push(c);
  for (const ln of lanesHit) { ctx.prevLand[ln] = t + pl.land; ctx.lastArr[ln] = t + dur; }
  return c;
}

/** Notas candidatas de un STEM en una ventana, con su puntaje rítmico. */
function candidates(notes, a, b, filter, bonus) {
  const out = [];
  for (const n of notes) {
    if (n.t < a) continue;
    if (n.t > b) break;
    if (filter && !filter(n)) continue;
    out.push({ t: n.t, s: n.s, d: n.d, l: n.l, p: n.p, k: n.k, score: n.s + bonus(n.t) });
  }
  return out;
}

/** Umbral para que haya ~1 grupo cada `gap` segundos (ni vacío ni saturado). */
function adaptiveThr(cs, a, b, gap, lo, hi) {
  const sorted = cs.map((x) => x.score).sort((x, y) => y - x);
  const target = Math.max(1, Math.round((b - a) / gap));
  const v = sorted.length > target ? sorted[target - 1] : (sorted.length ? sorted[sorted.length - 1] : 0);
  return Math.max(lo, Math.min(hi, v));
}

/** Recorre notas y arma grupos de 1–3 obstáculos en un carril. */
function runLane(ctx, cands, lane, laneSet, thr, opt = {}) {
  const { D, rng } = ctx;
  const after = (t0, a, b, minS) => {
    let best = null;
    for (const x of cands) {
      if (x.t < t0 + a) continue;
      if (x.t > t0 + b) break;
      if (x.score >= minS && (!best || x.score > best.score)) best = x;
    }
    return best;
  };
  let count = 0;
  for (let i = 0; i < cands.length; i++) {
    const n = cands[i];
    if (n.score < thr) continue;
    const la = ctx.lastArr[lane === 'all' ? laneSet[0] : lane];
    if (n.t < (la === undefined ? -99 : la) + (opt.gap || 0.22)) continue;
    const r = rng();
    const want = r < D.pat3 * (opt.patMul || 1) ? 3 : r < (D.pat3 + D.pat2) * (opt.patMul || 1) ? 2 : 1;
    const members = [n];
    while (members.length < want) {
      const c = after(members[members.length - 1].t, MIN_SEP, 0.62, thr * 0.7);
      if (!c || c.t - n.t > 1.3 || c.t > opt.end) break;
      members.push(c);
    }
    const c = addCluster(ctx, members, members.map(() => lane), laneSet, opt);
    if (c) { count++; while (i + 1 < cands.length && cands[i + 1].t <= c.lastArr) i++; }
  }
  return count;
}

// ------------------------------------------------------------------ TAMBOR
function genTambor(ctx, a, b) {
  const counts = {};
  const drumsHit = (n) => n.k !== 'hat' || n.s > 0.5;
  const lanesActive = [];
  STEM_LANES.forEach((L) => {
    const src = SRC[L];
    const cs = candidates(src, a, b, L === 'drums' ? drumsHit : null, (t) => PULSE(t) * 0.8)
      .map((x) => (x.k === 'hat' ? Object.assign(x, { score: x.score * 0.7 }) : x));
    counts[L] = cs.length;
    // barandas en las notas largas (no en batería)
    if (L !== 'drums') {
      for (const n of cs) {
        if (!n.l || n.d < 0.8 || ctx.rng() > ctx.D.rail) continue;
        const dur = Math.min(n.d, 2.2, 9 / ctx.v);
        if (dur < 0.8 || n.t + dur > b) continue;
        addRail(ctx, n.t, dur, L, STEM_LANES, n.s);
      }
    }
    // umbral adaptado a la densidad del instrumento (que ninguno sature)
    const thr = adaptiveThr(cs, a, b, ctx.D.dens, 0.12, ctx.D.thr + 0.15);
    runLane(ctx, cs, L, STEM_LANES, thr, { end: b, gap: ctx.D.gap });
  });
  STEM_LANES.forEach((L) => { if (counts[L] >= 3) lanesActive.push(L); });
  lanesActive.sort((x, y) => counts[y] - counts[x]);
  if (!lanesActive.length) lanesActive.push('drums');
  return lanesActive;
}

// --------------------------------------------------------------- SERPIENTE
function genSerpiente(ctx, a, b) {
  // golpes de batería y bajo (y, si la sección es suave, platillos, voz y otros), fusionados; se premia el pulso
  const W = (arr, w, f) => arr.filter(f || (() => true)).map((n) => ({ t: n.t, s: n.s * w }));
  const all = [].concat(
    W(SRC.drums, 1.0, (n) => n.k !== 'hat'), W(SRC.drums, 0.55, (n) => n.k === 'hat'),
    W(SRC.bass, 0.9), W(SRC.other, 0.6), W(SRC.vocals, 0.5),
  ).sort((x, y) => x.t - y.t);
  const merged = [];
  for (const n of all) {
    const last = merged[merged.length - 1];
    if (last && n.t - last.t < 0.06) { last.s = Math.max(last.s, n.s) + 0.05; continue; }
    merged.push({ t: n.t, s: n.s });
  }
  const cs = candidates(merged, a, b, null, (t) => PULSE(t) * 1.4);
  const thr = adaptiveThr(cs, a, b, ctx.D.dens, 0.15, ctx.D.thr + 0.2);
  runLane(ctx, cs, 'all', ['all'], thr, { end: b, gap: ctx.D.gap + 0.1, patMul: 1.3 });
}

// ------------------------------------------------------------------- PISTA
function genPista(ctx, a, b) {
  const { rng, D } = ctx;
  const occ = PISTA_LANES.map(() => []); // intervalos ocupados por carril
  const busy = (li, t0, t1) => occ[li].some(([x, y]) => x < t1 && y > t0);
  const laneOfP = (p) => Math.max(0, Math.min(3, Math.floor((p === undefined ? 0.5 : p) * 4)));
  // 1) barandas: notas largas de voz, otros y bajo (carril según la altura)
  const longs = [].concat(
    SRC.vocals.filter((n) => n.l), SRC.other.filter((n) => n.l), SRC.bass.filter((n) => n.l && n.d < 4),
  ).filter((n) => n.t >= a && n.t <= b - 0.6).sort((x, y) => y.s - x.s);
  let rails = 0;
  for (const n of longs) {
    const dur = Math.max(0.6, Math.min(n.d, 2.2));
    if (n.t + dur > b) continue;
    let li = laneOfP(n.p);
    if (busy(li, n.t - 0.4, n.t + dur + 0.4)) { const alt = [li - 1, li + 1].find((x) => x >= 0 && x < 4 && !busy(x, n.t - 0.4, n.t + dur + 0.4)); if (alt === undefined) continue; li = alt; }
    if (rng() > D.rail + 0.15) continue;
    if (addRail(ctx, n.t, dur, PISTA_LANES[li], PISTA_LANES, n.s)) { occ[li].push([n.t - 0.3, n.t + dur + 0.3]); rails++; }
  }
  // si la canción casi no tiene notas largas (electrónica), barandas en el pulso cada 2 compases
  const bars = BEATS4(a, b);
  const wantRails = Math.floor(bars.length / 3);
  for (let i = 1; i < bars.length && rails < wantRails; i += 2) {
    const t = bars[i];
    const dur = Math.min(2.0, BD * 4);
    if (t + dur > b) break;
    const order = [0, 1, 2, 3].sort(() => rng() - 0.5);
    for (const li of order) {
      if (busy(li, t - 0.4, t + dur + 0.4)) continue;
      if (addRail(ctx, t, dur, PISTA_LANES[li], PISTA_LANES, 0.7)) { occ[li].push([t - 0.3, t + dur + 0.3]); rails++; }
      break;
    }
  }
  // 2) obstáculos en los golpes de batería: 1 o 2 carriles, siempre quedan ≥ 2 libres
  const cs = candidates(SRC.drums.concat(SRC.bass).sort((x, y) => x.t - y.t), a, b, (n) => n.k !== 'hat', (t) => PULSE(t));
  const thr = adaptiveThr(cs, a, b, D.dens * 0.7, 0.12, D.thr + 0.1);
  let lastT = -99;
  for (const n of cs) {
    if (n.score < thr || n.t - lastT < 0.45) continue;
    const free = [0, 1, 2, 3].filter((li) => !busy(li, n.t - 0.55, n.t + 0.55));
    if (free.length < 3) continue;
    const k = free.length >= 4 && rng() < D.block2 ? 2 : 1;
    const pick = free.sort(() => rng() - 0.5).slice(0, k);
    let any = false;
    for (const li of pick) {
      const c = addCluster(ctx, [n], [PISTA_LANES[li]], PISTA_LANES, { sizeMul: 1.1 });
      if (c) { occ[li].push([n.t - 0.35, n.t + 0.35]); any = true; }
    }
    if (any) lastT = n.t;
  }
  // 3) notas ♪ para recoger (voz y otros, notas cortas)
  const shorts = SRC.vocals.concat(SRC.other).filter((n) => !n.l && n.t >= a && n.t <= b && n.s >= 0.2).sort((x, y) => x.t - y.t);
  let lastC = -99;
  for (const n of shorts) {
    if (n.t - lastC < 0.22 || rng() > D.coin) continue;
    const li = laneOfP(n.p);
    if (busy(li, n.t - 0.3, n.t + 0.3)) continue;
    ctx.events.push({ id: 0, tArr: n.t, tSpawn: n.t - ctx.travel, dir: 1, v: ctx.v, travel: ctx.travel, mode: 'pista', kind: 'coin',
      w: 0.6, h: 0.6, prims: [], lane: PISTA_LANES[li], cluster: -1, ci: 0, accent: n.s, seed: 0, coinColor: LANE_COLORS[li] });
    lastC = n.t;
  }
}

// Fuentes de notas y ayudas de tiempo del chart en proceso (se fijan en generateStemChart)
let SRC = { drums: [], bass: [], vocals: [], other: [] };
let PULSE = () => 0;
let BD = 0.5;
let BEATS4 = () => [];
const _gen = generateStemChart;
/** Envoltura que fija las fuentes globales antes de generar (simple y apto para Worker). */
export function makeStemChart(sc, opts) {
  const stems = sc.stems || {};
  const ns = (k) => ((stems[k] && stems[k].notes) || []).slice().sort((a, b) => a.t - b.t);
  SRC = { drums: ns('drums'), bass: ns('bass'), vocals: ns('vocals'), other: ns('other') };
  BD = 60 / sc.bpm;
  const beats = sc.beats;
  const dbs = sc.downbeats || beats.filter((_, i) => i % 4 === 0);
  const dbset = dbs;
  PULSE = (t) => {
    let lo = 0, hi = beats.length - 1;
    if (t <= beats[0]) return 0;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (beats[m] <= t) lo = m; else hi = m - 1; }
    const nb = beats[lo + 1] || beats[lo] + BD;
    let f = (t - beats[lo]) / (nb - beats[lo]);
    let bt = beats[lo];
    if (f > 0.5) { f -= 1; bt = nb; }
    if (Math.abs(f) < 0.09) return 0.22 + (dbset.some((d) => Math.abs(d - bt) < 0.03) ? 0.16 : 0);
    if (Math.abs(Math.abs(f) - 0.5) < 0.09) return 0.06;
    return 0;
  };
  BEATS4 = (a, b) => dbs.filter((t) => t >= a && t <= b);
  return _gen(sc, opts);
}
