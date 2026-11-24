'use strict';
/* shared by host and player pages */

const COLORS = [
  { name: '赤', hex: '#ff5a5f' },
  { name: '青', hex: '#4c8dff' },
  { name: '黄', hex: '#ffc83d' },
];

const BASE_YEAR = 2030;
const yearOf = (round) => BASE_YEAR + (round - 1) * 10;

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const RGB = COLORS.map((c) => hexToRgb(c.hex));

/**
 * Draws the world and animates it.
 * opts: { names: bool } — write player names on their cells when there is room
 */
class WorldView {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.opts = opts;
    this.world = null;
    this.from = null;
    this.to = null;
    this.t0 = 0;
    this.dur = 350;
    this.highlight = null; // cell index
    const loop = () => {
      this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.dpr = dpr;
  }

  current(now) {
    if (!this.to) return null;
    const k = Math.min(1, (now - this.t0) / this.dur);
    const e = k * k * (3 - 2 * k);
    return this.to.map((c, i) => {
      const f = this.from?.[i] || c;
      return [f[0] + (c[0] - f[0]) * e, f[1] + (c[1] - f[1]) * e, f[2] + (c[2] - f[2]) * e];
    });
  }

  set(world) {
    if (!world) {
      this.world = null;
      this.to = null;
      return;
    }
    const now = performance.now();
    const target = world.color.map((c) => RGB[c]);
    const sameShape = this.world && this.world.color.length === world.color.length;
    this.from = sameShape ? this.current(now) : target;
    this.to = target;
    this.t0 = now;
    this.world = world;
    this.fixedSet = new Set(world.fixedCells);
    this.heldSet = new Set(world.heldCells || []);
    this.nameAt = new Map();
    (world.playerCell || []).forEach((cell, i) => this.nameAt.set(cell, world.names?.[i] ?? ''));
  }

  layout() {
    const { cols, rows } = this.world;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const g = 0.12; // gap relative to a cell
    const unit = Math.min(W / (cols + (cols - 1) * g), H / (rows + (rows - 1) * g));
    const size = unit;
    const gap = unit * g;
    const ox = (W - (cols * size + (cols - 1) * gap)) / 2;
    const oy = (H - (rows * size + (rows - 1) * gap)) / 2;
    return { size, gap, ox, oy, step: size + gap };
  }

  draw() {
    const { ctx, canvas, world } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!world) return;
    const now = performance.now();
    const rgb = this.current(now);
    const { cols } = world;
    const L = this.layout();
    if (!(L.size > 1)) return;
    const { size, ox, oy, step } = L;
    const rad = size * 0.22;
    const pulse = 0.5 + 0.5 * Math.sin(now / 380);

    // cells
    for (let i = 0; i < world.color.length; i++) {
      const x = ox + (i % cols) * step;
      const y = oy + Math.floor(i / cols) * step;
      const [r, g, b] = rgb[i];
      ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      roundRect(ctx, x, y, size, size, rad);
      ctx.fill();
    }

    // cells swept up by a movement: a thin frame while they hold the color
    if (this.heldSet.size) {
      ctx.strokeStyle = 'rgba(255,255,255,.45)';
      ctx.lineWidth = Math.max(1, size * 0.07);
      for (const i of this.heldSet) {
        if (this.fixedSet.has(i)) continue;
        const x = ox + (i % cols) * step;
        const y = oy + Math.floor(i / cols) * step;
        roundRect(ctx, x + size * 0.18, y + size * 0.18, size * 0.64, size * 0.64, rad * 0.6);
        ctx.stroke();
      }
    }

    // players: a dark dot (or their name); inventors: a glowing white frame
    const fontPx = size * 0.3;
    const showNames = this.opts.names && fontPx >= 10 * this.dpr;
    for (const [cell, name] of this.nameAt) {
      const x = ox + (cell % cols) * step;
      const y = oy + Math.floor(cell / cols) * step;
      if (this.fixedSet.has(cell)) {
        const [r, g, b] = rgb[cell];
        ctx.save();
        ctx.shadowColor = `rgba(${r | 0},${g | 0},${b | 0},1)`;
        ctx.shadowBlur = size * (0.6 + 0.4 * pulse);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = Math.max(1.5, size * 0.14);
        roundRect(ctx, x + size * 0.1, y + size * 0.1, size * 0.8, size * 0.8, rad * 0.7);
        ctx.stroke();
        ctx.restore();
      }
      if (showNames) {
        ctx.fillStyle = 'rgba(10,12,20,.85)';
        ctx.font = `700 ${Math.round(fontPx)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(clip(ctx, name, size * 0.92), x + size / 2, y + size / 2);
      } else {
        ctx.fillStyle = 'rgba(10,12,20,.7)';
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, Math.max(1.5, size * 0.14), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // movements: the growing front, and a faint circle showing how far it will grow
    for (const wv of world.waves || []) {
      const cx = ox + wv.x * step + size / 2;
      const cy = oy + wv.y * step + size / 2;
      const hex = COLORS[wv.color].hex;
      ctx.save();
      ctx.strokeStyle = hex;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = Math.max(1.5, size * 0.08);
      ctx.setLineDash([size * 0.3, size * 0.25]);
      ctx.lineDashOffset = -now / 60;
      ctx.beginPath();
      ctx.arc(cx, cy, wv.maxRadius * step, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.95;
      ctx.lineWidth = Math.max(3, size * 0.28);
      ctx.shadowColor = hex;
      ctx.shadowBlur = size * 0.8;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(0.5, wv.radius) * step + size * 0.1 * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // me: a big moving ring that is easy to find on a crowded board
    if (this.highlight !== null && this.highlight !== undefined) {
      const i = this.highlight;
      const cx = ox + (i % cols) * step + size / 2;
      const cy = oy + Math.floor(i / cols) * step + size / 2;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = Math.max(2.5, size * 0.16);
      ctx.beginPath();
      ctx.arc(cx, cy, size * (0.95 + 0.25 * pulse), 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,.6)';
      ctx.lineWidth = Math.max(1, size * 0.06);
      ctx.beginPath();
      ctx.arc(cx, cy, size * (0.95 + 0.25 * pulse) + Math.max(2.5, size * 0.16) / 2 + 1, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

function clip(ctx, s, w) {
  if (ctx.measureText(s).width <= w) return s;
  while (s.length > 1 && ctx.measureText(s + '…').width > w) s = s.slice(0, -1);
  return s + '…';
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** small line chart: share of each color over the round */
function drawHistory(canvas, history) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (!history || history.length < 2) return;
  const n = history[0].reduce((a, b) => a + b, 0) || 1;
  const pad = 4 * dpr;
  ctx.lineWidth = 2.5 * dpr;
  ctx.lineJoin = 'round';
  for (let c = 0; c < COLORS.length; c++) {
    ctx.strokeStyle = COLORS[c].hex;
    ctx.beginPath();
    history.forEach((counts, t) => {
      const x = pad + (t / (history.length - 1)) * (W - 2 * pad);
      const y = H - pad - (counts[c] / n) * (H - 2 * pad);
      t ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
