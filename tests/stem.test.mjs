// Prueba de la partitura con STEMS: node tests/stem.test.mjs public/songs/w-w/chart.json
import fs from 'fs';
import { makeStemChart, STEM_LANES, PISTA_LANES } from '../public/js/host/stemchart.js';
import { PHYS, hitTest, heightAt, makeTraj, landTime, overRail } from '../public/js/host/physics.js';
const sc = JSON.parse(fs.readFileSync(process.argv[2] || 'public/songs/w-w/chart.json', 'utf8'));
let fail = 0;
for (const diff of ['facil', 'normal', 'dificil']) for (const seed of [1, 99]) {
  const t0 = Date.now();
  const ch = makeStemChart(sc, { difficulty: diff, seed });
  const ms = Date.now() - t0;
  const byMode = {}; const kinds = {};
  ch.events.forEach((e) => { byMode[e.mode] = (byMode[e.mode] || 0) + 1; kinds[e.kind === 'rail' ? 'rail' : e.kind === 'coin' ? 'coin' : 'obs'] = (kinds[e.kind === 'rail' ? 'rail' : e.kind === 'coin' ? 'coin' : 'obs'] || 0) + 1; });
  // orden de aparición
  for (let i = 1; i < ch.events.length; i++) if (ch.events[i].tSpawn < ch.events[i - 1].tSpawn) { fail++; console.log('desorden', i); break; }
  // cada carril: un jugador que sigue el plan sobrevive (sin cambiar de carril)
  const lanesFor = { tambor: STEM_LANES, serpiente: ['all'], pista: PISTA_LANES };
  let deaths = 0, checked = 0;
  for (const mode of ['tambor', 'serpiente', 'pista']) for (const lane of lanesFor[mode]) {
    const cls = ch.clusters.filter((c) => c.mode === mode && c.plans[lane]);
    const evs = ch.events.filter((e) => e.mode === mode && e.kind !== 'coin' && (e.lane === 'all' || e.lane === lane));
    if (!cls.length) continue;
    checked++;
    let ci = 0, traj = null, grind = null, prevH = 0;
    const tStart = cls[0].anchor - 2, tEnd = cls[cls.length - 1].lastArr + 2;
    for (let t = tStart; t < tEnd; t += PHYS.STEP) {
      if (grind && !overRail(-grind.dir * grind.v * (grind.tArr - t), grind.railL, grind.dir)) { traj = [{ t, h: PHYS.RAIL_H, v: PHYS.POP_V }]; grind = null; }
      if (traj && !grind && t >= landTime(traj)) traj = null;
      if (!traj && !grind && ci < cls.length) {
        const pl = cls[ci].plans[lane];
        if (t >= cls[ci].anchor + pl.t0 - 1e-9) { traj = makeTraj(cls[ci].anchor + pl.t0, pl.t1 === null ? null : cls[ci].anchor + pl.t1); ci++; }
      }
      let h = grind ? PHYS.RAIL_H : (traj ? heightAt(traj, t) : 0);
      if (!grind && traj && h < PHYS.RAIL_H && prevH >= PHYS.RAIL_H) {
        for (const e of evs) if (e.kind === 'rail' && overRail(-e.dir * e.v * (e.tArr - t), e.railL, e.dir)) { grind = e; traj = null; h = PHYS.RAIL_H; break; }
      }
      prevH = h;
      for (const e of evs) {
        const rel = -e.dir * e.v * (e.tArr - t);
        if (Math.abs(rel) > (e.kind === 'rail' ? e.railL + 1 : 3.2)) continue;
        if (hitTest(rel, h, e.prims)) { deaths++; console.log('  choque', diff, seed, mode, lane, e.kind, 'en', t.toFixed(2)); t = tEnd; break; }
      }
    }
  }
  const segs = ch.changes.map((c) => `${c.mode}${c.rev ? '↺' : ''}${c.speed ? '⚡' : ''}`).join(' → ');
  console.log(`${diff}/${seed}: ${ch.events.length} eventos (${JSON.stringify(kinds)}) por modo ${JSON.stringify(byMode)} · ${ms} ms · carriles ok ${checked - deaths}/${checked}`);
  if (seed === 1 && diff === 'normal') console.log('   ', segs, '| tambor activos:', ch.changes.filter((c) => c.mode === 'tambor').map((c) => c.lanesActive && c.lanesActive.join(',')));
  fail += deaths;
}
console.log(fail ? `FALLÓ (${fail})` : 'TODO OK');
process.exit(fail ? 1 : 0);
