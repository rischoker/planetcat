// =====================================================================
//  Generador de la "partitura" de obstáculos (estilo Guitar Hero).
//
//  Lee las NOTAS de la canción (onsets en semicorcheas), no solo el pulso:
//   - Acentos fuertes → obstáculo suelto (más grande).
//   - Ráfagas de notas → grupos de 2–3 obstáculos seguidos que se pasan
//     con un salto largo o con DOBLE SALTO, cada uno en su nota.
//   - Secciones de "medio carril": obstáculos solo adelante o solo atrás.
//   - Cada ~25–38 s (al azar, en inicio de frase) la rueda ACELERA.
//   - En inicios de frase la rueda puede cambiar de sentido.
//  Todo grupo se valida con la física real (planCluster): siempre existe
//  una ventana de despegue jugable; si no, se encoge o se simplifica.
// =====================================================================
import { PHYS, planCluster, planRail, railPrims } from './physics.js';
import { KIND_LIST, makeObstacleShape } from './catalog.js';

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DIFFICULTY = {
  facil:   { label: 'Fácil',   rail: 0.3,  minWindow: 0.16, thr: 0.1,   pat2: 0.6, pat3: 0.0, half: 0.6, travel0: 2.45, speedUp: [1.07, 1.11], minTravel: 1.55, revProb: 0.25, skip: 0.45, sizeMul: 0.8 },
  normal:  { label: 'Normal',  rail: 0.45, minWindow: 0.12, thr: 0,     pat2: 1.0, pat3: 1.0, half: 1.0, travel0: 2.2,  speedUp: [1.09, 1.15], minTravel: 1.25, revProb: 0.35, skip: 0.28, sizeMul: 1.0 },
  dificil: { label: 'Difícil', rail: 0.55, minWindow: 0.09, thr: -0.08, pat2: 1.3, pat3: 1.6, half: 1.3, travel0: 2.0,  speedUp: [1.12, 1.18], minTravel: 1.0,  revProb: 0.45, skip: 0.15, sizeMul: 1.0 },
};

export const LANES = ['front', 'back'];
const PHRASE = 16;
const CLEAR = 1.3;          // s sin llegadas antes de un cambio (velocidad/sentido)
const MIN_SEP = 0.17;       // separación mínima entre obstáculos seguidos (s)

/** ¿El obstáculo de carril `lane` afecta al carril de jugador `pl`? */
export function laneHits(lane, pl) { return lane === 'all' || lane === pl; }

/**
 * Separación entre jugadores sobre la cabeza: una fracción musical de beat
 * (1, 1/2 o 1/4) recorrida por los obstáculos, para que a CADA jugador le
 * llegue su obstáculo justo en un tiempo o subdivisión de la música.
 */
export function playerSpacing(v, beatDur, n) {
  const maxSpan = 7.0;
  for (const m of [1, 0.5, 0.25]) {
    const sp = v * beatDur * m;
    if (sp >= 0.8 && sp <= 2.2 && sp * Math.max(0, n - 1) <= maxSpan) return { spacing: sp, sub: m };
  }
  for (const m of [0.5, 0.25, 0.125]) { const sp = v * beatDur * m; if (sp >= 0.75) return { spacing: sp, sub: m }; }
  return { spacing: 0.75, sub: 0 };
}

export function generateChart(an, opts = {}) {
  const D = DIFFICULTY[opts.difficulty] || DIFFICULTY.normal;
  const rng = mulberry32(opts.seed >>> 0 || 1234);
  const { beats, strength, energy, duration } = an;
  const bd = an.beatDur;
  const phase0 = an.downbeatPhase || 0;
  const firstT = Math.max(4.5, opts.leadIn || 4.5);
  const lastT = duration - 1.5;
  const snap = (x) => Math.max(2 * bd, Math.round(x / (bd / 2)) * (bd / 2)); // viaje en medios beats

  // ---- notas candidatas (semicorcheas)
  const sub = an.sub || beats.map((_, i) => [strength[i], 0, 0, 0]);
  const notes = [];
  for (let i = 0; i < beats.length; i++) {
    const nb = beats[i + 1] || beats[i] + bd;
    for (let k = 0; k < 4; k++) {
      const s = (sub[i] && sub[i][k]) || 0;
      if (s <= 0.05) continue;
      const pos = ((i - phase0) % 4 + 4) % 4;
      const acc = (k === 0 ? 0.22 : k === 2 ? 0.08 : 0) + (k === 0 && pos === 0 ? 0.18 : 0) + (k === 0 && pos === 2 ? 0.06 : 0);
      notes.push({ t: beats[i] + (k * (nb - beats[i])) / 4, s, score: s + acc, i, k });
    }
  }

  // ---- "notas largas": tramos de 3–6 beats con sonido sostenido y pocos ataques
  //      nuevos (energía alta, onsets bajos) → candidatos a baranda para patinar.
  const sustain = beats.map((_, i) => {
    const K = 4;
    if (i + K >= beats.length) return -9;
    let e = 0, o = 0;
    for (let j = i; j < i + K; j++) { e += energy[j]; if (j > i) o += (sub[j] ? (sub[j][0] * 0.5 + sub[j][1] + sub[j][2] + sub[j][3]) / 3.5 : 0); }
    return e / K - 0.9 * o / (K - 1);
  });
  const sortedSus = sustain.filter((x) => x > -9).sort((a, b) => a - b);
  const susHi = sortedSus[Math.floor(sortedSus.length * 0.7)] || 0, susMid = sortedSus[Math.floor(sortedSus.length * 0.5)] || 0;
  let phrasesSinceRail = 0;

  const events = [], clusters = [], sections = [];
  let dir = rng() < 0.5 ? 1 : -1;
  let travel = snap(D.travel0);
  let speedLevel = 0;
  const changes = [{ t: -999, dir, travel, v: (PHYS.SPAWN_ARC * PHYS.R) / travel, rev: false, speed: false, level: 0 }];
  let nextSpeedUp = firstT + 22 + rng() * 14;
  let prevLand = { front: -99, back: -99 };
  let lastArr = -99, blockUntil = 0, phrasesSinceRev = 0, prevKind = '';

  const recomputeTail = () => {
    prevLand = { front: -99, back: -99 }; lastArr = -99;
    for (const c of clusters) {
      lastArr = Math.max(lastArr, c.lastArr);
      for (const l of LANES) if (c.plans[l]) prevLand[l] = Math.max(prevLand[l], c.anchor + c.plans[l].land);
    }
  };

  for (let pi = phase0; pi < beats.length; pi += PHRASE) {
    const tp = beats[pi];
    if (tp > lastT) break;
    const tEnd = beats[Math.min(beats.length - 1, pi + PHRASE)] || duration;
    let meanE = 0, n = 0;
    for (let i = pi; i < Math.min(beats.length, pi + PHRASE); i++) { meanE += energy[i]; n++; }
    meanE /= Math.max(1, n);
    const progress = tp / duration;
    const intensity = Math.max(0, Math.min(1, 0.65 * meanE + 0.35 * progress));
    const level = intensity < 0.28 ? 0 : intensity < 0.52 ? 1 : intensity < 0.76 ? 2 : 3;
    sections.push({ t: tp, level, energy: meanE });
    if (tEnd < firstT) continue;

    // ---- cambios de velocidad / sentido (en inicio de frase)
    if (tp >= firstT) {
      const doSpeed = tp >= nextSpeedUp && travel > D.minTravel + 0.01;
      const doRev = clusters.length > 0 && phrasesSinceRev >= 1 && (rng() < D.revProb + 0.05 * level || phrasesSinceRev >= 5);
      if (doSpeed || doRev) {
        if (doRev) dir = -dir;
        if (doSpeed) {
          const f = D.speedUp[0] + rng() * (D.speedUp[1] - D.speedUp[0]);
          let nt = snap(Math.max(D.minTravel, travel / f));
          if (nt >= travel) nt = Math.max(D.minTravel, travel - bd / 2);
          travel = nt; speedLevel++;
          nextSpeedUp = tp + 24 + rng() * 14;
        }
        // las llegadas viejas deben acabar antes del cambio
        while (clusters.length && clusters[clusters.length - 1].lastArr > tp - CLEAR) {
          const c = clusters.pop();
          events.splice(events.length - c.members.length, c.members.length);
        }
        recomputeTail();
        blockUntil = tp + travel + 0.35;
        changes.push({ t: tp, dir, travel, v: (PHYS.SPAWN_ARC * PHYS.R) / travel, rev: doRev, speed: doSpeed, level: speedLevel });
        phrasesSinceRev = doRev ? 0 : phrasesSinceRev + 1;
      } else phrasesSinceRev++;
    }

    const v = (PHYS.SPAWN_ARC * PHYS.R) / travel;
    // ¿baranda en esta frase? (en un tiempo fuerte con nota sostenida)
    let railBeat = -1;
    phrasesSinceRail++;
    if (level >= 1 && tp > 15) {
      let bestI = -1, bestS = -9;
      for (let i = pi; i < Math.min(beats.length - 6, pi + PHRASE - 2); i += 2) {
        if (beats[i] < Math.max(firstT, blockUntil) || beats[i] > lastT - 3) continue;
        if (sustain[i] > bestS) { bestS = sustain[i]; bestI = i; }
      }
      const okScore = bestS >= susHi || (phrasesSinceRail >= 3 && bestS >= susMid);
      if (bestI >= 0 && okScore && rng() < D.rail + (phrasesSinceRail >= 3 ? 0.3 : 0)) railBeat = bestI;
    }
    const halfMode = tp > 20 && rng() < D.half * (0.14 + 0.1 * level);
    const thr = [0.62, 0.5, 0.41, 0.33][level] + D.thr;
    const pN = notes.filter((x) => x.t >= Math.max(firstT, blockUntil, tp) && x.t < tEnd && x.t <= lastT);
    const after = (t0, a, b, minS) => {
      let best = null;
      for (const x of notes) {
        if (x.t < t0 + a) continue;
        if (x.t > t0 + b) break;
        if (x.s >= minS && (!best || x.score > best.score)) best = x;
      }
      return best;
    };

    for (let ni = 0; ni < pN.length; ni++) {
      const note = pN[ni];
      // ---- baranda: ocupa la nota larga completa
      if (railBeat >= 0 && note.i === railBeat && note.k === 0) {
        let K = 6;
        const subOff = (j) => (sub[j] ? (sub[j][1] + sub[j][2] + sub[j][3]) / 3 : 0);
        while (K > 3 && subOff(railBeat + K - 1) > 0.5) K--;
        let dur = Math.min(K * bd, 2.4, 9 / v);
        if (dur >= 1.25 && note.t + dur < lastT) {
          const L = v * dur;
          const pl = planRail(L, v);
          if (pl.ok && pl.window >= D.minWindow && note.t + pl.from >= Math.max(prevLand.front, prevLand.back) + 0.05 && note.t >= lastArr + 0.3) {
            const cid = clusters.length;
            const prims = railPrims(L, dir);
            const ev = { id: 0, tArr: note.t, tSpawn: note.t - travel, dir, v, travel, kind: 'rail', w: L, h: PHYS.RAIL_H, prims, lane: 'all',
              railL: L, tEnd: note.t + dur, cluster: cid, ci: 0, accent: note.s, seed: Math.floor(rng() * 1e9) };
            const cl = { id: cid, anchor: note.t, dir, v, travel, plans: { front: pl, back: pl }, members: [ev], lastArr: note.t + dur, accent: note.s, rail: true };
            events.push(ev); clusters.push(cl);
            prevLand = { front: note.t + pl.land, back: note.t + pl.land };
            lastArr = note.t + dur;
            phrasesSinceRail = 0;
            while (ni + 1 < pN.length && pN[ni + 1].t <= lastArr + 0.3) ni++;
            continue;
          }
        }
      }
      if (note.score < thr) continue;
      if (note.t < lastArr + 0.22) continue;
      if (rng() < D.skip * (1 - Math.min(1, note.s))) continue;
      // ---- patrón: 1, 2 o 3 obstáculos siguiendo las notas
      const r = rng();
      const p3 = D.pat3 * [0, 0.06, 0.13, 0.22][level];
      const p2 = D.pat2 * [0.12, 0.26, 0.34, 0.4][level];
      const want = r < p3 ? 3 : r < p3 + p2 ? 2 : 1;
      let members = [note];
      while (members.length < want) {
        const lst = members[members.length - 1];
        const c = after(lst.t, MIN_SEP, 0.62, thr * 0.7);
        if (!c || c.t - note.t > 1.3 || c.t > lastT) break;
        members.push(c);
      }
      // carriles
      let lanes;
      if (halfMode) {
        const L = rng() < 0.5 ? 'front' : 'back', O = L === 'front' ? 'back' : 'front';
        const style = members.length === 1 ? (rng() < 0.75 ? 'same' : 'all') : ['same', 'alt', 'mixed'][Math.floor(rng() * 3)];
        lanes = members.map((_, j) => style === 'all' ? 'all' : style === 'same' ? L : style === 'alt' ? (j % 2 ? O : L) : (j === 0 ? 'all' : L));
      } else lanes = members.map(() => 'all');

      // formas
      const sizes = members.map((m) => {
        if (members.length === 1) {
          const big = Math.min(1, m.s * 0.8 + rng() * 0.4) * D.sizeMul;
          return { w: Math.min(1, big * (0.5 + rng() * 0.6)), h: Math.min(1, big * (0.5 + rng() * 0.6)) };
        }
        return { w: 0.1 + rng() * 0.35, h: 0.15 + rng() * 0.4 };
      });
      const kinds = members.map(() => {
        let k; do { k = KIND_LIST[Math.floor(rng() * KIND_LIST.length)]; } while (k === prevKind && KIND_LIST.length > 1);
        prevKind = k; return k;
      });

      let ok = false, plans = null, shapes = null, tries = 0;
      while (!ok && members.length && tries++ < 10) {
        shapes = members.map((m, j) => makeObstacleShape(kinds[j], sizes[j].w, sizes[j].h));
        plans = {};
        let fitFail = false, gapFail = false;
        for (const L of LANES) {
          const obs = [];
          members.forEach((m, j) => { if (laneHits(lanes[j], L)) obs.push({ dt: m.t - note.t, prims: shapes[j].prims }); });
          if (!obs.length) { plans[L] = null; continue; }
          const pl = planCluster(obs, v);
          if (!pl.ok || pl.window < D.minWindow) { fitFail = true; break; }
          if (note.t + pl.from < prevLand[L] + 0.05 || note.t + pl.t0 < prevLand[L] + 0.2) { gapFail = true; break; }
          plans[L] = pl;
        }
        if (!fitFail && !gapFail) { ok = true; break; }
        if (gapFail || tries > 3) {
          // simplifica: quita la última nota del grupo
          members = members.slice(0, -1); lanes = lanes.slice(0, -1); sizes.pop(); kinds.pop();
        } else sizes.forEach((s) => { s.w *= 0.75; s.h *= 0.8; });
      }
      if (!ok || !members.length) continue;

      const cid = clusters.length;
      const cl = { id: cid, anchor: note.t, dir, v, travel, plans, members: [], lastArr: members[members.length - 1].t, accent: note.s };
      members.forEach((m, j) => {
        const sh = shapes[j];
        const ev = {
          id: 0, tArr: m.t, tSpawn: m.t - travel, dir, v, travel,
          kind: sh.kind, w: sh.w, h: sh.h, prims: sh.prims, lane: lanes[j],
          cluster: cid, ci: j, accent: m.s, seed: Math.floor(rng() * 1e9),
        };
        events.push(ev); cl.members.push(ev);
      });
      clusters.push(cl);
      for (const L of LANES) if (plans[L]) prevLand[L] = note.t + plans[L].land;
      lastArr = cl.lastArr;
      while (ni + 1 < pN.length && pN[ni + 1].t <= cl.lastArr) ni++;
    }
  }
  events.forEach((e, i) => { e.id = i; });
  clusters.forEach((c, i) => { c.id = i; c.members.forEach((e) => { e.cluster = i; }); });
  return {
    events, clusters, changes, reversals: changes, sections,
    bpm: an.bpm, beatDur: bd, beats, duration, downbeatPhase: phase0, difficulty: opts.difficulty || 'normal',
  };
}

/** Sentido de la rueda en el tiempo t. */
export function dirAt(chart, t) {
  let d = chart.changes[0].dir;
  for (const r of chart.changes) { if (r.t <= t) d = r.dir; else break; }
  return d;
}
/** Tramo de velocidad vigente en t. */
export function changeAt(chart, t) {
  let c = chart.changes[0];
  for (const r of chart.changes) { if (r.t <= t) c = r; else break; }
  return c;
}
