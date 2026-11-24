'use strict';
/* shared by host and player pages */

const COLORS = [
  { name: '赤', hex: '#ff5a5f', glow: 'rgba(255,90,95,.55)' },
  { name: '青', hex: '#4c8dff', glow: 'rgba(76,141,255,.55)' },
  { name: '黄', hex: '#ffc83d', glow: 'rgba(255,200,61,.55)' },
];

const BASE_YEAR = 2030;
const yearOf = (round) => BASE_YEAR + (round - 1) * 10;

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const RGB = COLORS.map((c) => hexToRgb(c.hex));

/**
 * Draws the world on a canvas and animates color changes.
 * opts: { names: bool, highlight: cell index | null }
 */
class WorldView {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.opts = opts;
    this.world = null;
    this.from = null; // rgb per cell at transition start
    this.to = null;
    this.t0 = 0;
    this.dur = 450;
    this.highlight = null;
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
      return [0, 1, 2].map((j) => f[j] + (c[j] - f[j]) * e);
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
  }

  draw() {
    const { ctx, canvas, world } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!world) return;
    const now = performance.now();
    const rgb = this.current(now);
    const { cols, rows } = world;
    const W = canvas.width;
    const H = canvas.height;
    const gap = Math.max(2, Math.min(W, H) * 0.012);
    const size = Math.min((W - gap * (cols + 1)) / cols, (H - gap * (rows + 1)) / rows);
    if (!(size > 1)) return;
    const ox = (W - (size * cols + gap * (cols - 1))) / 2;
    const oy = (H - (size * rows + gap * (rows - 1))) / 2;
    const rad = size * 0.18;
    const pulse = 0.5 + 0.5 * Math.sin(now / 380);

    for (let i = 0; i < world.color.length; i++) {
      const x = ox + (i % cols) * (size + gap);
      const y = oy + Math.floor(i / cols) * (size + gap);
      const [r, g, b] = rgb[i].map(Math.round);
      const fixed = world.fixed[i];

      ctx.save();
      if (fixed) {
        ctx.shadowColor = `rgba(${r},${g},${b},.9)`;
        ctx.shadowBlur = size * (0.35 + 0.15 * pulse);
      }
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      roundRect(ctx, x, y, size, size, rad);
      ctx.fill();
      ctx.restore();

      if (fixed) {
        // 発明者: a steady white core — the cell that no longer flows
        ctx.strokeStyle = 'rgba(255,255,255,.95)';
        ctx.lineWidth = Math.max(2, size * 0.07);
        roundRect(ctx, x + size * 0.12, y + size * 0.12, size * 0.76, size * 0.76, rad * 0.7);
        ctx.stroke();
      }
      if (this.highlight === i) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = Math.max(3, size * 0.09);
        ctx.setLineDash([size * 0.14, size * 0.1]);
        ctx.lineDashOffset = -now / 40;
        roundRect(ctx, x - gap * 0.6, y - gap * 0.6, size + gap * 1.2, size + gap * 1.2, rad * 1.2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (this.opts.names && world.names && size > 36 * this.dpr) {
        const name = world.names[i] || '';
        ctx.fillStyle = 'rgba(10,12,20,.78)';
        ctx.font = `600 ${Math.round(size * 0.16)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(clip(ctx, name, size * 0.9), x + size / 2, y + size / 2);
      }
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
