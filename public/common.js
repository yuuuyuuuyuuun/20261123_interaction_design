'use strict';
/* shared by host and player pages */

// The three kinds of land. Each has a fill color and a simple glyph drawn in a darker ink,
// so they can be told apart on a small screen and without relying on color alone.
const COLORS = [
  { key: 'city', name: '都市', hex: '#c3cedd', ink: '#6b7b93' }, // bluish light gray, windows
  { key: 'nature', name: '自然', hex: '#5bb26f', ink: '#246236' }, // green, a tree
  { key: 'wild', name: '荒野', hex: '#ef9146', ink: '#9c4a12' }, // orange, diagonal stripes
];

/** draws the glyph of land `k` inside the square (x, y, s); the caller has filled the base */
function drawGlyph(ctx, k, x, y, s) {
  ctx.fillStyle = COLORS[k].ink;
  ctx.strokeStyle = COLORS[k].ink;
  if (k === 0) {
    // 都市: four windows
    const w = s * 0.17;
    const g = s * 0.1;
    const o = (s - 2 * w - g) / 2;
    for (const dx of [0, w + g]) for (const dy of [0, w + g]) ctx.fillRect(x + o + dx, y + o + dy, w, w);
  } else if (k === 1) {
    // 自然: a tree
    ctx.beginPath();
    ctx.moveTo(x + s * 0.5, y + s * 0.18);
    ctx.lineTo(x + s * 0.76, y + s * 0.66);
    ctx.lineTo(x + s * 0.24, y + s * 0.66);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(x + s * 0.44, y + s * 0.64, s * 0.12, s * 0.16);
  } else {
    // 荒野: diagonal stripes that repeat from land to land
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, s, s);
    ctx.clip();
    ctx.lineWidth = s * 0.12;
    ctx.lineCap = 'butt';
    for (const k2 of [-0.5, 0, 0.5]) {
      ctx.beginPath();
      ctx.moveTo(x + s * k2, y + s);
      ctx.lineTo(x + s * (k2 + 1), y);
      ctx.stroke();
    }
    ctx.restore();
  }
}

let iconSeq = 0;
/** the same land as a small inline SVG, for buttons and labels */
function landIcon(k, px = 20) {
  const c = COLORS[k];
  const id = `li${++iconSeq}`;
  let g;
  if (k === 0) g = [[7, 7], [13, 7], [7, 13], [13, 13]].map(([x, y]) => `<rect x="${x - 0.1}" y="${y - 0.1}" width="4.2" height="4.2" fill="${c.ink}"/>`).join('');
  else if (k === 1) g = `<path d="M12 4.3 L18.2 15.8 H5.8 Z" fill="${c.ink}"/><rect x="10.6" y="15.4" width="2.8" height="3.8" fill="${c.ink}"/>`;
  else
    g = `<clipPath id="${id}"><rect width="24" height="24" rx="5"/></clipPath><g clip-path="url(#${id})" stroke="${c.ink}" stroke-width="2.9">` +
      [-12, 0, 12].map((o) => `<line x1="${o}" y1="24" x2="${o + 24}" y2="0"/>`).join('') + '</g>';
  return `<svg class="land-icon" width="${px}" height="${px}" viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="5" fill="${c.hex}"/>${g}</svg>`;
}

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
    this.dur = 0; // colors switch at once (a hue fade between colors is hard on the eyes)
    this.highlight = null; // cell index
    this.ripples = [];
    this.lastTick = -1;
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
    if (!(this.dur > 0)) return this.to;
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
      this.lastTick = -1;
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
    if (world.tick !== this.lastTick) {
      for (const ev of world.events || []) {
        if (ev.kind === 'movement') this.ripples.push({ ...ev, t0: now });
      }
      this.lastTick = world.tick;
    }
    this.nameAt = new Map();
    (world.playerCell || []).forEach((cell, i) => this.nameAt.set(cell, world.names?.[i] ?? ''));
  }

  /** one tile per kind of land at the current size (rebuilt only when the size changes) */
  tiles(size, rad) {
    const px = Math.max(2, Math.ceil(size));
    if (this._tiles?.px === px) return this._tiles.list;
    const list = COLORS.map((c, k) => {
      const t = document.createElement('canvas');
      t.width = t.height = px;
      const g = t.getContext('2d');
      g.fillStyle = c.hex;
      roundRect(g, 0, 0, px, px, (rad * px) / size);
      g.fill();
      g.save();
      roundRect(g, 0, 0, px, px, (rad * px) / size);
      g.clip();
      drawGlyph(g, k, 0, 0, px);
      g.restore();
      return t;
    });
    this._tiles = { px, list };
    return list;
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
    const { cols } = world;
    const L = this.layout();
    if (!(L.size > 1)) return;
    const { size, ox, oy, step } = L;
    const rad = size * 0.22;
    const pulse = 0.5 + 0.5 * Math.sin(now / 380);

    // lands: a pre-drawn tile per kind
    const tiles = this.tiles(size, rad);
    for (let i = 0; i < world.color.length; i++) {
      const x = ox + (i % cols) * step;
      const y = oy + Math.floor(i / cols) * step;
      ctx.drawImage(tiles[world.color[i]], x, y, size, size);
    }

    // charisma: a white dashed ring around the people under its spell (wrapping around the edges)
    if ((world.charismas || []).length) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(ox, oy, cols * step - L.gap, world.rows * step - L.gap); // exactly the board
      ctx.clip();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = Math.max(2, size * 0.14);
      ctx.setLineDash([size * 0.5, size * 0.3]);
      ctx.lineDashOffset = -now / 30;
      for (const c of world.charismas) {
        const r = (c.radius + 0.5) * step;
        for (const wx of [-cols, 0, cols])
          for (const wy of [-world.rows, 0, world.rows]) {
            const cx = ox + (c.x + wx) * step + size / 2;
            const cy = oy + (c.y + wy) * step + size / 2;
            if (cx - r > canvas.width || cy - r > canvas.height || cx + r < 0 || cy + r < 0) continue;
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.stroke();
          }
      }
      ctx.restore();
    }

    // citizens: a small dot in the corner (or their name); inventors: a glowing white frame
    const fontPx = size * 0.26;
    const showNames = this.opts.names && fontPx >= 9 * this.dpr;
    for (const [cell, name] of this.nameAt) {
      const x = ox + (cell % cols) * step;
      const y = oy + Math.floor(cell / cols) * step;
      if (this.fixedSet.has(cell)) {
        ctx.save();
        ctx.shadowColor = COLORS[world.color[cell]].hex;
        ctx.shadowBlur = size * (0.6 + 0.4 * pulse);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = Math.max(1.5, size * 0.14);
        roundRect(ctx, x + size * 0.1, y + size * 0.1, size * 0.8, size * 0.8, rad * 0.7);
        ctx.stroke();
        ctx.restore();
      }
      if (showNames) {
        ctx.fillStyle = 'rgba(10,12,20,.72)';
        roundRect(ctx, x + size * 0.03, y + size * 0.6, size * 0.94, size * 0.36, size * 0.1);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = `700 ${Math.round(fontPx)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(clip(ctx, name, size * 0.9), x + size / 2, y + size * 0.785);
      } else {
        const r = Math.max(1.8, size * 0.12);
        ctx.beginPath();
        ctx.arc(x + size * 0.8, y + size * 0.2, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(10,12,20,.85)';
        ctx.fill();
        ctx.lineWidth = Math.max(1, size * 0.05);
        ctx.strokeStyle = '#fff';
        ctx.stroke();
      }
    }

    // movements: an expanding ring, kept inside the board
    this.ripples = this.ripples.filter((rp) => now - rp.t0 < 1200);
    if (this.ripples.length) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(ox, oy, cols * step - L.gap, world.rows * step - L.gap); // exactly the board
      ctx.clip();
      for (const rp of this.ripples) {
        const k = (now - rp.t0) / 1200;
        ctx.strokeStyle = COLORS[rp.color].hex;
        ctx.globalAlpha = 1 - k;
        ctx.lineWidth = Math.max(3, size * 0.3) * (1 - k * 0.6);
        ctx.beginPath();
        ctx.arc(ox + rp.x * step + size / 2, oy + rp.y * step + size / 2, rp.radius * step * (0.5 + k * 0.8), 0, Math.PI * 2);
        ctx.stroke();
      }
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

/** the notice for a movement or a charisma (shared by the big screen and the phones) */
function eventText(ev, names) {
  const c = COLORS[ev.color];
  return ev.kind === 'charisma' ? `${c.name}のカリスマ、${names[ev.player]}` : `${c.name}のムーブメント！`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
