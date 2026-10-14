// =====================================================================
//  Capa de efectos 2D encima del 3D: placas de nombre, textos de
//  "¡PERFECTO!", nubes de "puf", globos de "¡MIAU!", transición de iris
//  y el look de película vieja (grano, rayas, polvo, parpadeo, marco con
//  perforaciones de rollo de cine).
// =====================================================================
import { PAL } from './cat.js';

const FONT_UI = '"Lilita One", "Arial Rounded MT Bold", "Trebuchet MS", sans-serif';
const FONT_DECO = '"Limelight", "Rye", Georgia, serif';

function roundRect(ctx, x, y, w, h, r, keepPath) {
  if (!keepPath) ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

export class FX {
  constructor(canvas) {
    this.c = canvas; this.ctx = canvas.getContext('2d');
    this.W = 1; this.H = 1; this.dpr = 1;
    this.popups = []; this.poofs = []; this.bubbles = []; this.stars = [];
    this.iris = null;
    this.time = 0;
    this.grain = [];
    for (let k = 0; k < 4; k++) {
      const g = document.createElement('canvas'); g.width = g.height = 192;
      const x = g.getContext('2d'); const img = x.createImageData(192, 192);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.random() < 0.5 ? 0 : 255;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = Math.random() * 60;
      }
      x.putImageData(img, 0, 0); this.grain.push(g);
    }
    this.scratches = [];
    this.lowFx = false;
  }

  resize(W, H, dpr) {
    this.W = W; this.H = H; this.dpr = dpr;
    this.c.width = Math.round(W * dpr); this.c.height = Math.round(H * dpr);
    this.c.style.width = W + 'px'; this.c.style.height = H + 'px';
    // viñeta precalculada
    const v = document.createElement('canvas'); v.width = 256; v.height = 256;
    const vx = v.getContext('2d');
    const gr = vx.createRadialGradient(128, 128, 60, 128, 128, 182);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(10,6,0,0.55)');
    vx.fillStyle = gr; vx.fillRect(0, 0, 256, 256);
    this.vignette = v;
  }

  popup(text, wpos, color, size = 1) { this.popups.push({ text, w: wpos.clone(), color, size, t: 0, life: 0.7 }); }
  poof(wpos, scale = 1) { this.poofs.push({ w: wpos.clone(), t: 0, life: 0.45, scale, seed: Math.random() * 10 }); }
  bubble(id, text) { this.bubbles = this.bubbles.filter((b) => b.id !== id); this.bubbles.push({ id, text, t: 0, life: 1.3 }); }
  flash() { this.flashT = 0.35; }
  /** Globo de slang tipo explosión de cómic ("¡SUPERFLY!") sobre un personaje. */
  slang(id, text) { this.slangs = (this.slangs || []).filter((b) => b.id !== id); this.slangs.push({ id, text, t: 0, life: 1.5, rot: (Math.random() - 0.5) * 0.3, side: Math.random() < 0.5 ? -1 : 1 }); }
  /** Chispa de patinaje en una posición del mundo. */
  spark(wpos, dir) { (this.sparks = this.sparks || []).push({ w: wpos.clone(), t: 0, life: 0.3, vx: -dir * (60 + Math.random() * 120), vy: -(40 + Math.random() * 120), dx: 0, dy: 0 }); }
  koStars(wpos) { for (let i = 0; i < 5; i++) this.stars.push({ w: wpos.clone(), t: 0, life: 1.2, a: (i / 5) * Math.PI * 2 }); }

  /** Transición de iris: dir 'close' (se cierra a negro) o 'open'. */
  startIris(dir, dur, cx, cy, done) { this.iris = { dir, dur, t: 0, cx, cy, done }; }

  // ------------------------------------------------------------------
  draw(dt, project, plates, opts = {}) {
    this.time += dt;
    const ctx = this.ctx, W = this.W, H = this.H;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const base = Math.max(12, Math.min(26, H / 38));

    // ---- placas de nombre
    if (plates && plates.length) this.drawPlates(ctx, plates, base);

    // ---- globos de miau
    this.bubbles.forEach((b) => {
      b.t += dt;
      const pl = plates && plates.find((p) => p.id === b.id);
      if (!pl) return;
      const k = Math.min(1, b.t / 0.12) * (b.t > b.life - 0.2 ? (b.life - b.t) / 0.2 : 1);
      const x = pl.head.x + base * 2.6, y = pl.head.y - base * 0.8;
      ctx.save(); ctx.translate(x, y); ctx.scale(k, k); ctx.rotate(-0.08);
      ctx.font = `${base * 1.15}px ${FONT_DECO}`;
      const tw = ctx.measureText(b.text).width + base * 1.2;
      ctx.fillStyle = PAL.white; ctx.strokeStyle = PAL.black; ctx.lineWidth = 3;
      roundRect(ctx, -tw / 2, -base * 1.0, tw, base * 1.9, base * 0.9); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-tw * 0.3, base * 0.8); ctx.lineTo(-tw * 0.5, base * 1.5); ctx.lineTo(-tw * 0.1, base * 0.85); ctx.fill(); ctx.stroke();
      ctx.fillStyle = PAL.maroon; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(b.text, 0, 0);
      ctx.restore();
    });
    this.bubbles = this.bubbles.filter((b) => b.t < b.life);

    // ---- chispas de patinaje
    (this.sparks || []).forEach((sp) => {
      sp.t += dt; sp.dx += sp.vx * dt; sp.dy += sp.vy * dt; sp.vy += 500 * dt;
      const p = project(sp.w.x, sp.w.y, sp.w.z);
      ctx.strokeStyle = Math.random() < 0.5 ? '#ffe600' : '#ff9f1c'; ctx.lineWidth = 3;
      ctx.globalAlpha = 1 - sp.t / sp.life;
      ctx.beginPath(); ctx.moveTo(p.x + sp.dx, p.y + sp.dy); ctx.lineTo(p.x + sp.dx - sp.vx * 0.04, p.y + sp.dy - sp.vy * 0.04); ctx.stroke();
      ctx.globalAlpha = 1;
    });
    this.sparks = (this.sparks || []).filter((sp) => sp.t < sp.life);

    // ---- globos de slang (explosión de cómic)
    (this.slangs || []).forEach((b) => {
      b.t += dt;
      const pl = plates && plates.find((p) => p.id === b.id);
      if (!pl) return;
      const k = b.t < 0.14 ? (b.t / 0.14) * 1.2 : b.t < 0.24 ? 1.2 - (b.t - 0.14) * 2 : 1;
      const fade = b.t > b.life - 0.25 ? (b.life - b.t) / 0.25 : 1;
      const x = pl.head.x + b.side * base * 3.4, y = pl.head.y - base * 2.2 - b.t * base * 0.6;
      ctx.save(); ctx.globalAlpha = Math.max(0, fade); ctx.translate(x, y); ctx.scale(k, k); ctx.rotate(b.rot);
      ctx.font = `${base * 1.2}px ${FONT_DECO}`;
      const tw = ctx.measureText(b.text).width;
      const rx = tw / 2 + base * 1.1, ry = base * 1.45;
      // explosión con picos
      ctx.beginPath();
      const n = 16;
      for (let i = 0; i <= n * 2; i++) {
        const a = (i / (n * 2)) * Math.PI * 2;
        const rr = i % 2 ? 0.78 : 1.0;
        const px = Math.cos(a) * rx * rr, py = Math.sin(a) * ry * rr;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = PAL.black; ctx.save(); ctx.translate(4, 4); ctx.fill(); ctx.restore();
      ctx.fillStyle = PAL.yellow; ctx.strokeStyle = PAL.black; ctx.lineWidth = 3; ctx.fill(); ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 5; ctx.strokeStyle = PAL.white; ctx.strokeText(b.text, 0, 1);
      ctx.fillStyle = PAL.maroon; ctx.fillText(b.text, 0, 1);
      ctx.restore();
    });
    this.slangs = (this.slangs || []).filter((b) => b.t < b.life);

    // ---- popups de juicio
    this.popups.forEach((p) => {
      p.t += dt;
      const s = project(p.w.x, p.w.y, p.w.z);
      const k = p.t < 0.08 ? p.t / 0.08 * 1.15 : 1.15 - Math.min(0.15, (p.t - 0.08) * 1.5);
      const alpha = p.t > p.life - 0.25 ? (p.life - p.t) / 0.25 : 1;
      ctx.save(); ctx.globalAlpha = Math.max(0, alpha);
      ctx.translate(s.x, s.y - p.t * base * 2.5); ctx.scale(k * p.size, k * p.size); ctx.rotate(-0.06);
      ctx.font = `${base * 1.05}px ${FONT_DECO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 6; ctx.strokeStyle = PAL.black; ctx.lineJoin = 'round';
      ctx.strokeText(p.text, 0, 0); ctx.fillStyle = p.color; ctx.fillText(p.text, 0, 0);
      ctx.restore();
    });
    this.popups = this.popups.filter((p) => p.t < p.life);

    // ---- nubes de puf
    this.poofs.forEach((p) => {
      p.t += dt;
      const s = project(p.w.x, p.w.y, p.w.z);
      const k = p.t / p.life;
      ctx.save(); ctx.globalAlpha = 1 - k; ctx.translate(s.x, s.y);
      ctx.fillStyle = PAL.white; ctx.strokeStyle = PAL.black; ctx.lineWidth = 3;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + p.seed;
        const r = base * (0.6 + k * 2.2) * p.scale;
        ctx.beginPath(); ctx.arc(Math.cos(a) * r, Math.sin(a) * r * 0.7, base * (1.1 - k * 0.6) * p.scale, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    });
    this.poofs = this.poofs.filter((p) => p.t < p.life);

    // ---- estrellitas de K.O.
    this.stars.forEach((st) => {
      st.t += dt;
      const s = project(st.w.x, st.w.y, st.w.z);
      const a = st.a + st.t * 6;
      const x = s.x + Math.cos(a) * base * 2, y = s.y + Math.sin(a) * base * 0.7 - st.t * base * 2;
      ctx.save(); ctx.globalAlpha = 1 - st.t / st.life; ctx.translate(x, y); ctx.rotate(st.t * 5);
      this.star(ctx, base * 0.7);
      ctx.restore();
    });
    this.stars = this.stars.filter((s) => s.t < s.life);

    // ---- película vieja
    if (!this.lowFx) this.drawFilm(ctx, W, H);
    this.drawFrame(ctx, W, H);

    // ---- destello (aceleración)
    if (this.flashT > 0) {
      this.flashT -= dt;
      ctx.fillStyle = `rgba(255,250,230,${Math.max(0, this.flashT / 0.35) * 0.55})`;
      ctx.fillRect(0, 0, W, H);
    }
    // ---- iris
    if (this.iris) {
      const ir = this.iris; ir.t += dt;
      const k = Math.min(1, ir.t / ir.dur);
      const maxR = Math.hypot(W, H);
      const e = k * k * (3 - 2 * k);
      const r = ir.dir === 'close' ? maxR * (1 - e) : maxR * e;
      ctx.save(); ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.arc(ir.cx * W, ir.cy * H, Math.max(0, r), 0, Math.PI * 2, true); ctx.fill('evenodd');
      ctx.restore();
      if (k >= 1) {
        const done = ir.done;
        if (ir.dir === 'open') this.iris = null; else ir.hold = true;
        if (done) { ir.done = null; done(); }
      }
    }
  }

  star(ctx, r) {
    ctx.fillStyle = PAL.yellow; ctx.strokeStyle = PAL.black; ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 - Math.PI / 2; const rr = i % 2 ? r * 0.45 : r; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }

  drawPlates(ctx, plates, base) {
    const fs = Math.round(base * 0.95);
    ctx.font = `${fs}px ${FONT_UI}`;
    const placed = [];
    const items = plates.map((p) => {
      const label = p.name + (p.connected === false ? ' ⚡' : '');
      const w = ctx.measureText(label).width + fs * 1.9;
      const h = fs * 1.6;
      return { p, label, w, h };
    }).sort((a, b) => a.p.head.y - b.p.head.y);
    const overlaps = (r) => placed.some((q) => r.x < q.x + q.w + 4 && r.x + r.w + 4 > q.x && r.y < q.y + q.h + 3 && r.y + r.h + 3 > q.y);
    items.forEach((it) => {
      const hx = it.p.head.x, hy = it.p.head.y - fs * 0.6;
      let rect = null;
      const cands = [[0, 0]];
      for (let k = 1; k < 10; k++) cands.push([0, -k], [k % 2 ? -1 : 1, -Math.ceil(k / 2)], [k % 2 ? 1 : -1, -Math.ceil(k / 2)]);
      for (const [cx, cy] of cands) {
        const r = { x: hx - it.w / 2 + cx * (it.w * 0.6), y: hy - it.h + cy * (it.h + 4), w: it.w, h: it.h };
        if (!overlaps(r)) { rect = r; break; }
      }
      if (!rect) rect = { x: hx - it.w / 2, y: hy - it.h, w: it.w, h: it.h };
      placed.push(rect);
      it.rect = rect;
    });
    items.forEach(({ p, label, rect }) => {
      const dim = p.alive === false;
      ctx.save();
      ctx.globalAlpha = dim ? 0.55 : 1;
      // línea guía
      const bx = rect.x + rect.w / 2, by = rect.y + rect.h;
      if (Math.abs(bx - p.head.x) > 4 || Math.abs(by - (p.head.y - fs * 0.6)) > 4) {
        ctx.strokeStyle = PAL.black; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(p.head.x, p.head.y - 2); ctx.stroke();
      }
      // sombra
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      roundRect(ctx, rect.x + 3, rect.y + 3, rect.w, rect.h, rect.h * 0.3); ctx.fill();
      ctx.fillStyle = p.connected === false ? '#cfc6b4' : PAL.cream;
      ctx.strokeStyle = PAL.black; ctx.lineWidth = 2.5;
      roundRect(ctx, rect.x, rect.y, rect.w, rect.h, rect.h * 0.3); ctx.fill(); ctx.stroke();
      // ficha de color
      ctx.fillStyle = p.color; ctx.beginPath();
      ctx.arc(rect.x + fs * 0.85, rect.y + rect.h / 2, fs * 0.42, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = PAL.black; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(label, rect.x + fs * 1.5, rect.y + rect.h / 2 + 1);
      ctx.restore();
    });
  }

  drawFilm(ctx, W, H) {
    // grano
    const g = this.grain[(Math.random() * 4) | 0];
    ctx.save();
    ctx.globalAlpha = 0.5;
    const pat = ctx.createPattern(g, 'repeat');
    ctx.translate(Math.random() * 192, Math.random() * 192);
    ctx.fillStyle = pat; ctx.fillRect(-192, -192, W + 384, H + 384);
    ctx.restore();
    // viñeta
    ctx.drawImage(this.vignette, 0, 0, W, H);
    // parpadeo del proyector
    ctx.fillStyle = `rgba(30,20,0,${0.02 + Math.random() * 0.035})`; ctx.fillRect(0, 0, W, H);
    // rayones verticales
    if (Math.random() < 0.06) this.scratches.push({ x: Math.random() * W, life: 0.15 + Math.random() * 0.4, t: 0, w: Math.random() < 0.5 ? 1 : 2 });
    this.scratches.forEach((s) => {
      s.t += 1 / 60; s.x += (Math.random() - 0.5) * 3;
      ctx.strokeStyle = Math.random() < 0.5 ? 'rgba(255,255,240,0.35)' : 'rgba(0,0,0,0.3)';
      ctx.lineWidth = s.w; ctx.beginPath(); ctx.moveTo(s.x, 0); ctx.lineTo(s.x + (Math.random() - 0.5) * 8, H); ctx.stroke();
    });
    this.scratches = this.scratches.filter((s) => s.t < s.life);
    // polvo
    const n = (Math.random() * 4) | 0;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = Math.random() < 0.6 ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,240,0.5)';
      ctx.beginPath(); ctx.arc(Math.random() * W, Math.random() * H, 1 + Math.random() * 2.5, 0, Math.PI * 2); ctx.fill();
    }
  }

  drawFrame(ctx, W, H) {
    const side = Math.max(16, Math.min(46, W * 0.028));
    const tb = Math.max(8, H * 0.016);
    const rad = Math.min(W, H) * 0.035;
    ctx.save();
    ctx.fillStyle = '#0b0b0b';
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    roundRect(ctx, side, tb, W - side * 2, H - tb * 2, rad, true);
    ctx.fill('evenodd');
    // perforaciones del rollo
    const hole = side * 0.5, gap = hole * 1.9;
    const off = (this.time * 18) % gap;
    ctx.fillStyle = '#f4f1e6';
    for (let y = -gap + off; y < H + gap; y += gap) {
      roundRect(ctx, side * 0.25, y, hole, hole * 0.85, hole * 0.2); ctx.fill();
      roundRect(ctx, W - side * 0.25 - hole, y, hole, hole * 0.85, hole * 0.2); ctx.fill();
    }
    ctx.restore();
  }
}
