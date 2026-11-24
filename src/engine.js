'use strict';

// 世界は、わたしたちでできている — game engine (pure, no I/O)
//
// 世界   : participants, one cell each, laid out on a grid
// 法則   : imitation — now and then, every free cell copies one of its neighbors (voter model)
// 未来   : the plurality color of the whole world when the round ends
// 予言   : a declaration that may be changed at any time; the cell keeps flowing with the law
// 発明   : a declaration that can never change; the cell is fixed to the declared color
// 得点   : time remaining at the moment of the final declaration, if it was right

const DEFAULTS = {
  colors: 3,
  neighborhood: 'moore', // 'moore' (8) | 'vn' (4)
  torus: true,
  law: 'voter', // 'voter' (imitation) | 'majority' (deterministic) | 'soft'
  softBeta: 2, // for law 'soft': P(color) ∝ count^beta
  ticks: 60, // world updates per round
  // probability that a free cell looks at its neighbors on each update.
  // 'auto' = N/100: keeps how much one person can move the world roughly constant
  // regardless of class size (see sim/ — a lone inventor succeeds ~60-67% for N = 8..60)
  rate: 'auto',
};

function makeRng(seed) {
  // mulberry32
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function autoRate(n) {
  return Math.min(1, Math.max(0.05, n / 100));
}

function gridSize(n) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  const rows = Math.max(1, Math.ceil(n / cols));
  return { cols, rows };
}

function buildNeighbors(n, cols, rows, neighborhood, torus) {
  const offsets =
    neighborhood === 'vn'
      ? [[0, -1], [-1, 0], [1, 0], [0, 1]]
      : [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
  const nb = [];
  for (let i = 0; i < n; i++) {
    const x = i % cols;
    const y = Math.floor(i / cols);
    const set = new Set();
    for (const [dx, dy] of offsets) {
      let nx = x + dx;
      let ny = y + dy;
      if (torus) {
        nx = (nx + cols) % cols;
        ny = (ny + rows) % rows;
      } else if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const j = ny * cols + nx;
      if (j !== i && j < n) set.add(j);
    }
    nb.push([...set]);
  }
  return nb;
}

class World {
  constructor(n, opts = {}, seed = Date.now()) {
    this.opts = { ...DEFAULTS, ...opts };
    if (this.opts.rate === 'auto') this.opts.rate = autoRate(n);
    this.n = n;
    this.rng = makeRng(seed);
    const { cols, rows } = gridSize(n);
    this.cols = cols;
    this.rows = rows;
    this.neighbors = buildNeighbors(n, cols, rows, this.opts.neighborhood, this.opts.torus);
    this.color = new Array(n);
    for (let i = 0; i < n; i++) this.color[i] = Math.floor(this.rng() * this.opts.colors);
    this.fixed = new Array(n).fill(false);
    // declaration per cell: { color, tick, invented } | null
    this.decl = new Array(n).fill(null);
    this.tick = 0;
    this.history = [this.counts()];
  }

  counts() {
    const c = new Array(this.opts.colors).fill(0);
    for (const v of this.color) c[v]++;
    return c;
  }

  // plurality color of the world, or -1 on a tie
  leader(counts = this.counts()) {
    let best = -1;
    let bestN = -1;
    let tie = false;
    counts.forEach((v, k) => {
      if (v > bestN) {
        best = k;
        bestN = v;
        tie = false;
      } else if (v === bestN) tie = true;
    });
    return tie ? -1 : best;
  }

  get finished() {
    return this.tick >= this.opts.ticks;
  }

  get remaining() {
    return this.opts.ticks - this.tick;
  }

  // 予言: may be changed any time unless already invented
  predict(i, color) {
    if (this.finished || this.fixed[i]) return false;
    this.decl[i] = { color, tick: this.tick, invented: false };
    return true;
  }

  // 発明: irreversible. The cell is fixed to the declared color.
  invent(i, color) {
    if (this.finished || this.fixed[i]) return false;
    this.decl[i] = { color, tick: this.tick, invented: true };
    this.fixed[i] = true;
    this.color[i] = color;
    return true;
  }

  step() {
    if (this.finished) return;
    const { colors, law, softBeta } = this.opts;
    const next = this.color.slice();
    const cnt = new Array(colors);
    for (let i = 0; i < this.n; i++) {
      if (this.fixed[i]) continue;
      if (this.opts.rate < 1 && this.rng() >= this.opts.rate) continue;
      const nb = this.neighbors[i];
      if (law === 'voter') {
        if (nb.length) next[i] = this.color[nb[Math.floor(this.rng() * nb.length)]];
        continue;
      }
      cnt.fill(0);
      cnt[this.color[i]]++;
      for (const j of nb) cnt[this.color[j]]++;
      if (law === 'soft') {
        let total = 0;
        const w = cnt.map((v) => Math.pow(v, softBeta));
        for (const v of w) total += v;
        let r = this.rng() * total;
        for (let k = 0; k < colors; k++) {
          r -= w[k];
          if (r < 0) {
            next[i] = k;
            break;
          }
        }
        continue;
      }
      // deterministic majority: unique plurality wins, otherwise keep current color
      let best = this.color[i];
      let bestN = cnt[best];
      let unique = true;
      for (let k = 0; k < colors; k++) {
        if (k === best) continue;
        if (cnt[k] > bestN) {
          best = k;
          bestN = cnt[k];
          unique = true;
        } else if (cnt[k] === bestN) unique = false;
      }
      if (unique) next[i] = best;
    }
    this.color = next;
    this.tick++;
    this.history.push(this.counts());
  }

  // Final result. score = ticks remaining at the final declaration, if correct.
  result() {
    const future = this.leader();
    const scores = this.decl.map((d) =>
      d && future >= 0 && d.color === future ? this.opts.ticks - d.tick : 0
    );
    return { future, counts: this.counts(), scores };
  }

  snapshot() {
    return {
      cols: this.cols,
      rows: this.rows,
      colors: this.opts.colors,
      color: this.color,
      fixed: this.fixed,
      tick: this.tick,
      ticks: this.opts.ticks,
      counts: this.counts(),
    };
  }
}

module.exports = { World, DEFAULTS, makeRng, gridSize, autoRate };
