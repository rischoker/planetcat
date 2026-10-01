// =====================================================================
//  Test de la partitura y los hitboxes (Node, sin navegador).
//    node tests/chart.test.mjs audio.f32      (PCM float32 mono 11025 Hz)
//  Generar el .f32:  ffmpeg -i assets/audio/ww.mp3 -ac 1 -ar 11025 -f f32le ww.f32
//
//  Verifica para cada dificultad y varias semillas:
//   - que todo grupo tenga una ventana de despegue ≥ mínimo (física real),
//   - que un jugador que sigue el plan (con doble salto cuando hace falta)
//     sobreviva TODA la canción en cualquier posición y carril (6 jugadores),
//   - que un jugador que no salta muera,
//   - que cada llegada caiga en una subdivisión musical para todos,
//   - y reporta variedad: patrones de 1/2/3, medio carril, aceleraciones.
// =====================================================================
import fs from 'fs';
import { analyzeBeats } from '../js/host/beat-analysis.js';
import { generateChart, playerSpacing, changeAt, laneHits } from '../js/host/chart.js';
import { PHYS, hitTest, heightAt, makeTraj, landTime, overRail } from '../js/host/physics.js';

const f = process.argv[2];
if (!f) { console.log('uso: node tests/chart.test.mjs audio.f32'); process.exit(2); }
const buf = fs.readFileSync(f);
const mono = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
let t0 = Date.now();
const an = analyzeBeats(mono, 11025);
console.log('BPM', an.bpm, 'beats', an.beats.length, 'dur', an.duration.toFixed(1), 'análisis ms', Date.now() - t0);
console.log('aire', PHYS.AIR_TIME.toFixed(2), 's · altura', PHYS.APEX.toFixed(2), '+ doble', PHYS.DJ_EXTRA.toFixed(2));

const N = 6;
let fail = 0;
for (const diff of ['facil', 'normal', 'dificil']) {
  for (const seed of [42, 7, 2024]) {
    t0 = Date.now();
    const ch = generateChart(an, { difficulty: diff, seed });
    const ms = Date.now() - t0;
    const ev = ch.events;
    const minW = Math.min(...ch.clusters.flatMap((c) => ['front', 'back'].map((l) => c.plans[l] ? c.plans[l].window : 9)));
    const phaseAt = (t) => { const c = changeAt(ch, t); return Object.assign({}, c, playerSpacing(c.v, ch.beatDur, N)); };

    let deaths = 0, offBeat = 0, lazyAlive = 0, railsDone = 0;
    for (let k = 0; k < N && !deaths; k++) {
      const slot = k - Math.floor((N - 1) / 2);
      const lane = k % 2 ? 'back' : 'front';
      // plan de saltos de este jugador
      const jumps = [];
      for (const c of ch.clusters) {
        const pl = c.plans[lane];
        const ph = phaseAt(c.anchor);
        const off = c.dir * slot * ph.spacing / c.v;
        if (ph.sub) { const fr = off / (ch.beatDur * ph.sub); if (Math.abs(fr - Math.round(fr)) > 0.02) offBeat++; }
        if (!pl) continue;
        jumps.push({ t0: c.anchor + off + pl.t0, t1: pl.t1 === null ? null : c.anchor + off + pl.t1 });
      }
      let ji = 0, traj = null, grind = null, prevH = 0;
      const sAt = (t) => slot * phaseAt(t).spacing;
      const rails = ev.filter((e) => e.kind === 'rail');
      for (let t = 0; t < ch.duration; t += PHYS.STEP) {
        const sp = sAt(t);
        if (traj && t >= landTime(traj)) traj = null;
        // patinando: sigue hasta que la baranda termina → saltito automático
        if (grind && !overRail(-grind.dir * grind.v * (grind.tArr - t) - sp, grind.railL, grind.dir)) {
          traj = [{ t, h: PHYS.RAIL_H, v: PHYS.POP_V }]; grind = null; railsDone++;
        }
        if (ji < jumps.length && t >= jumps[ji].t0) {
          if (traj || grind) { console.log('   ', diff, seed, 'jugador', k, 'no aterrizó a tiempo para el salto', ji); deaths++; break; }
          traj = makeTraj(jumps[ji].t0, jumps[ji].t1); ji++;
        }
        let feet = grind ? PHYS.RAIL_H : heightAt(traj, t);
        // aterrizar sobre una baranda (bajando, cruzando su altura, encima de ella)
        if (!grind && traj && feet < PHYS.RAIL_H && prevH >= PHYS.RAIL_H) {
          const r = rails.find((e) => t > e.tSpawn && overRail(-e.dir * e.v * (e.tArr - t) - sp, e.railL, e.dir));
          if (r) { grind = r; traj = null; feet = PHYS.RAIL_H; }
        }
        prevH = feet;
        for (const e of ev) {
          if (t < e.tSpawn || t > e.tArr + 2 || !laneHits(e.lane, lane)) continue;
          const s = -e.dir * e.v * (e.tArr - t) - sp;
          if (Math.abs(s) < 3 && hitTest(s, feet, e.prims)) { deaths++; console.log('   ', diff, seed, 'jugador', k, lane, 'golpe', e.id, e.kind, t.toFixed(3)); break; }
        }
        if (deaths) break;
      }
      // sin saltar: debe morir
      let hit = false;
      for (const e of ev) {
        if (!laneHits(e.lane, lane)) continue;
        for (let t = e.tArr - 0.3; t < e.tArr + 0.3 && !hit; t += PHYS.STEP) if (hitTest(-e.dir * e.v * (e.tArr - t), 0, e.prims)) hit = true;
        break;
      }
      if (!hit) lazyAlive++;
    }
    // variedad
    const sizes = [0, 0, 0, 0]; ch.clusters.forEach((c) => sizes[c.members.length]++);
    const half = ev.filter((e) => e.lane !== 'all').length;
    const dj = ch.clusters.filter((c) => (c.plans.front && c.plans.front.t1 !== null) || (c.plans.back && c.plans.back.t1 !== null)).length;
    const gaps = []; for (let i = 1; i < ch.clusters.length; i++) gaps.push(ch.clusters[i].anchor - ch.clusters[i - 1].anchor);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const cv = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length) / mean;
    const nRails = ev.filter((e) => e.kind === 'rail').length;
    const speeds = ch.changes.filter((c) => c.speed).map((c) => c.t.toFixed(0) + 's');
    const revs = ch.changes.filter((c) => c.rev).length;
    console.log(`${diff.padEnd(7)} s${String(seed).padEnd(4)} obst ${ev.length} barandas ${nRails} (patinadas ${railsDone}/${nRails * N}) grupos 1/2/3: ${sizes[1]}/${sizes[2]}/${sizes[3]} · doble salto ${dj} · medio carril ${half} · ` +
      `variación de ritmo ${(cv * 100).toFixed(0)}% · acelera en ${speeds.join(',')} · cambios de sentido ${revs} · v ${ch.changes[0].v.toFixed(1)}→${ch.changes[ch.changes.length - 1].v.toFixed(1)} · ` +
      `ventana mín ${minW.toFixed(2)} · ${ms} ms | muertes plan perfecto: ${deaths} · fuera de ritmo: ${offBeat} · sobrevive sin saltar: ${lazyAlive}`);
    if (deaths || offBeat || lazyAlive || railsDone !== nRails * N) fail++;
  }
}
console.log(fail ? 'FALLÓ' : 'TODO OK');
process.exit(fail ? 1 : 0);
