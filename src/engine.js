'use strict';

// 世界は、わたしたちでできている — game engine (pure, no I/O)
//
// 世界   : a large torus-shaped rectangle of cells. A few of them are the players;
//          the rest are the crowd — people who never invent and always flow.
// 法則   : every free cell, on every update,
//            - 気まぐれ  (noise)    : with probability `noise`, takes a random color
//            - 同調      (imitate)  : otherwise, with probability `imitate`, looks at `sample` random
//                                     neighbors and takes their most common color (ties: random)
//          and now and then the whole world is shaken by
//            - 流行・災害 (movement) : a disc of free cells turns into one color at once
// 未来   : the plurality color of the whole world when the round ends
// 予言   : a declaration that may be changed at any time; the player's cell keeps flowing
// 発明   : a declaration that can never change; the player's cell is fixed to that color
//          and is immune to every law above
// 得点   : updates remaining at the moment of the final declaration, if it was right

// Chosen by simulation (see sim/ and README): lively for the whole round, the early
// leader wins only ~40%, one inventor alone barely moves the world, a whole class
// inventing the same color together usually — but not always — gets its way.
const DEFAULTS = {
  colors: 3,
  ticks: 60, // updates per round
  boardScale: 16, // board cells ≈ players × boardScale
  minCells: 96, // never smaller than this, so a small class still gets a lively world
  aspect: 4 / 3, // cols : rows
  imitate: 0.8,
  sample: 3, // how many neighbors a cell looks at when it conforms (1 = plain imitation)
  noise: 0.04,
  movement: 0.12, // probability per update that a movement happens
  movementRadius: [0.22, 0.45], // radius range, relative to the shorter side of the board
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

function boardSize(players, o) {
  const target = Math.max(o.minCells, players * o.boardScale, players);
  let cols = Math.max(3, Math.round(Math.sqrt(target * o.aspect)));
  let rows = Math.max(3, Math.round(target / cols));
  while (cols * rows < players) rows++;
  return { cols, rows };
}

class World {
  /**
   * @param {number} players number of player cells
   * @param {object} opts see DEFAULTS
   * @param {number} seed
   */
  constructor(players, opts = {}, seed = Date.now()) {
    this.opts = { ...DEFAULTS, ...opts };
    const o = this.opts;
    this.rng = makeRng(seed);
    const { cols, rows } = boardSize(players, o);
    this.cols = cols;
    this.rows = rows;
    this.size = cols * rows;
    this.neighbors = [];
    for (let i = 0; i < this.size; i++) {
      const x = i % cols;
      const y = (i / cols) | 0;
      const nb = [];
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (dx || dy) nb.push(((y + dy + rows) % rows) * cols + ((x + dx + cols) % cols));
      this.neighbors.push(nb);
    }
    this.color = Array.from({ length: this.size }, () => Math.floor(this.rng() * o.colors));
    this.fixed = new Array(this.size).fill(false);

    // players are scattered over the board
    const cells = [...Array(this.size).keys()];
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    this.players = players;
    this.playerCell = cells.slice(0, players);
    this.decl = new Array(players).fill(null); // { color, tick, invented }
    this.tick = 0;
    this.events = []; // movements of the latest update
    this.history = [this.counts()];
  }

  counts() {
    const c = new Array(this.opts.colors).fill(0);
    for (const v of this.color) c[v]++;
    return c;
  }

  /** plurality color, or -1 on a tie */
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

  /** 予言 by player p: may be changed any time unless already invented */
  predict(p, color) {
    if (this.finished || !this.validColor(color) || this.decl[p]?.invented) return false;
    this.decl[p] = { color, tick: this.tick, invented: false };
    return true;
  }

  /** 発明 by player p: irreversible, the cell is fixed to the color */
  invent(p, color) {
    if (this.finished || !this.validColor(color) || this.decl[p]?.invented) return false;
    this.decl[p] = { color, tick: this.tick, invented: true };
    const cell = this.playerCell[p];
    this.fixed[cell] = true;
    this.color[cell] = color;
    return true;
  }

  validColor(c) {
    return Number.isInteger(c) && c >= 0 && c < this.opts.colors;
  }

  step() {
    if (this.finished) return;
    const o = this.opts;
    const rng = this.rng;
    const cur = this.color;
    const next = cur.slice();
    for (let i = 0; i < this.size; i++) {
      if (this.fixed[i]) continue;
      const r = rng();
      if (r < o.noise) next[i] = Math.floor(rng() * o.colors);
      else if (r < o.noise + o.imitate) next[i] = this.conform(i, cur);
    }

    this.events = [];
    if (rng() < o.movement) {
      const short = Math.min(this.cols, this.rows);
      const [a, b] = o.movementRadius;
      const radius = short * (a + rng() * (b - a));
      const cx = Math.floor(rng() * this.cols);
      const cy = Math.floor(rng() * this.rows);
      const color = Math.floor(rng() * o.colors);
      for (let i = 0; i < this.size; i++) {
        if (this.fixed[i]) continue;
        let dx = Math.abs((i % this.cols) - cx);
        let dy = Math.abs(((i / this.cols) | 0) - cy);
        dx = Math.min(dx, this.cols - dx);
        dy = Math.min(dy, this.rows - dy);
        if (dx * dx + dy * dy <= radius * radius) next[i] = color;
      }
      this.events.push({ x: cx, y: cy, radius, color });
    }

    this.color = next;
    this.tick++;
    this.history.push(this.counts());
  }

  /** the most common color among `sample` distinct random neighbors (ties broken at random) */
  conform(i, cur) {
    const k = this.opts.sample;
    const nb = this.neighbors[i];
    if (k <= 1) return cur[nb[Math.floor(this.rng() * 8)]];
    const pick = this._pick || (this._pick = [0, 1, 2, 3, 4, 5, 6, 7]);
    const cnt = this._cnt || (this._cnt = new Array(this.opts.colors));
    cnt.fill(0);
    for (let s = 0; s < k && s < 8; s++) {
      const j = s + Math.floor(this.rng() * (8 - s));
      [pick[s], pick[j]] = [pick[j], pick[s]];
      cnt[cur[nb[pick[s]]]]++;
    }
    let best = 0;
    let ties = 0;
    let choice = 0;
    for (let c = 0; c < cnt.length; c++) {
      if (cnt[c] > best) {
        best = cnt[c];
        choice = c;
        ties = 1;
      } else if (cnt[c] === best && best > 0 && this.rng() < 1 / ++ties) choice = c;
    }
    return choice;
  }

  /** score per player = updates remaining at the final declaration, if it was right */
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
      playerCell: this.playerCell,
      tick: this.tick,
      ticks: this.opts.ticks,
      counts: this.counts(),
      events: this.events,
    };
  }
}

module.exports = { World, DEFAULTS, makeRng, boardSize };
