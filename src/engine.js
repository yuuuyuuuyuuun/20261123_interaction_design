'use strict';

// 世界は、わたしたちでできている — game engine (pure, no I/O)
//
// 世界   : a large torus-shaped rectangle of cells. A few of them are the players;
//          the rest are the crowd — people who never invent and always flow.
// 法則   : every free cell, on every update,
//            - 気まぐれ  (noise)    : with probability `noise`, takes a random color
//            - 同調      (imitate)  : otherwise, with probability `imitate`, looks at `sample` random
//                                     neighbors and takes their most common color (ties: random)
//          and now and then
//            - ムーブメント (movement) : a color that is behind gets a movement — a wave that grows
//              from one of its supporters. Cells the wave reaches turn to that color and hold it
//              for a few updates (like temporary inventors), then flow again. The further the
//              color is behind, the larger the wave grows (backlash). Waves take time to grow, so
//              one that starts right before the end stays small; none start early in a round.
// 未来   : the plurality color of the whole world when the round ends
// 予言   : a declaration that may be changed at any time; the player's cell keeps flowing
// 発明   : a declaration that can never change; the player's cell is fixed to that color
//          for good and is immune to every law above
// 得点   : updates remaining at the moment of the final declaration, if it was right

// Chosen by simulation (see sim/ and README).
const DEFAULTS = {
  colors: 3,
  ticks: 60, // updates per round
  boardScale: 16, // board cells ≈ players × boardScale
  minCells: 96, // never smaller than this, so a small class still gets a lively world
  aspect: 4 / 3, // cols : rows
  imitate: 0.8,
  sample: 3, // how many neighbors a cell looks at when it conforms (1 = plain imitation)
  noise: 0.04,
  movement: 0.08, // probability per update that a movement starts (once fully ramped up)
  movementRamp: [0.15, 0.5], // no movements before 15% of the round, full rate from 50%
  movementRadius: [0.06, 0.42], // final radius range, relative to the shorter side of the board
  movementBacklash: 0.4, // share gap to the leader at which a wave reaches the top of the range
  movementSpeed: 0.45, // how many cells the wave front advances per update (0 = all at once)
  movementHold: [3, 5], // updates a reached cell holds the color
  movementTarget: 'trailing', // 'trailing': only colors that are not ahead | 'any'
  movementStopAt: Infinity, // (simulation only) no new movements from this update on
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
    this.heldUntil = new Array(this.size).fill(0); // movement: cell is held while tick < heldUntil

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
    this.events = []; // movements that started on the latest update
    this.waves = []; // movements that are still growing
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
      if (this.fixed[i] || this.heldUntil[i] > this.tick) continue;
      const r = rng();
      if (r < o.noise) next[i] = Math.floor(rng() * o.colors);
      else if (r < o.noise + o.imitate) next[i] = this.conform(i, cur);
    }

    this.events = [];
    if (rng() < o.movement * this.movementRamp() && !(this.tick >= o.movementStopAt)) this.startMovement(cur);
    this.growWaves(next);

    this.color = next;
    this.tick++;
    this.history.push(this.counts());
  }

  /** 0 → 1 over the round: movements are a comeback mechanism, not needed at the start */
  movementRamp() {
    const [a, b] = this.opts.movementRamp;
    const f = this.tick / this.opts.ticks;
    if (f < a) return 0;
    return b > a ? Math.min(1, (f - a) / (b - a)) : 1;
  }

  startMovement(cur) {
    const o = this.opts;
    const rng = this.rng;
    // which color: one that is not ahead (or any, for comparison)
    const counts = new Array(o.colors).fill(0);
    for (const v of cur) counts[v]++;
    const max = Math.max(...counts);
    let choices = [...counts.keys()];
    if (o.movementTarget === 'trailing') {
      const behind = choices.filter((c) => counts[c] < max);
      if (behind.length) choices = behind;
    }
    const color = choices[Math.floor(rng() * choices.length)];
    // where: around someone who already holds that color, if there is anyone
    const supporters = [];
    for (let i = 0; i < this.size; i++) if (cur[i] === color) supporters.push(i);
    const center = supporters.length ? supporters[Math.floor(rng() * supporters.length)] : Math.floor(rng() * this.size);
    // how large it will grow
    const short = Math.min(this.cols, this.rows);
    const [ra, rb] = o.movementRadius;
    const k =
      o.movementBacklash > 0
        ? Math.min(1, (max - counts[color]) / this.size / o.movementBacklash) * (0.8 + 0.2 * rng())
        : rng();
    const [ha, hb] = o.movementHold;
    const wave = {
      x: center % this.cols,
      y: (center / this.cols) | 0,
      color,
      radius: -1, // current front
      maxRadius: Math.max(1, short * (ra + k * (rb - ra))),
      hold: ha + Math.floor(rng() * (hb - ha + 1)),
    };
    this.waves.push(wave);
    this.events.push(wave);
  }

  /** advance every wave front and sweep the cells it passes */
  growWaves(next) {
    const o = this.opts;
    for (const w of this.waves) {
      const from = w.radius;
      const to = o.movementSpeed > 0 ? Math.min(w.maxRadius, Math.max(1, from + o.movementSpeed)) : w.maxRadius;
      for (let i = 0; i < this.size; i++) {
        if (this.fixed[i]) continue;
        let dx = Math.abs((i % this.cols) - w.x);
        let dy = Math.abs(((i / this.cols) | 0) - w.y);
        dx = Math.min(dx, this.cols - dx);
        dy = Math.min(dy, this.rows - dy);
        const d2 = dx * dx + dy * dy;
        if (d2 <= to * to && (from < 0 || d2 > from * from)) {
          next[i] = w.color;
          if (w.hold > 0) this.heldUntil[i] = this.tick + 1 + w.hold;
        }
      }
      w.radius = to;
    }
    this.waves = this.waves.filter((w) => w.radius < w.maxRadius);
  }

  /** the most common color among `sample` distinct neighbors (ties broken at random) */
  conform(i, cur) {
    const k = Math.min(8, this.opts.sample);
    const nb = this.neighbors[i];
    if (k <= 1) return cur[nb[Math.floor(this.rng() * 8)]];
    const pick = this._pick || (this._pick = [0, 1, 2, 3, 4, 5, 6, 7]);
    const cnt = this._cnt || (this._cnt = new Array(this.opts.colors));
    cnt.fill(0);
    for (let s = 0; s < k; s++) {
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
      held: this.heldUntil.map((u) => u > this.tick),
      playerCell: this.playerCell,
      tick: this.tick,
      ticks: this.opts.ticks,
      counts: this.counts(),
      events: this.events.map((w) => ({ x: w.x, y: w.y, color: w.color, maxRadius: w.maxRadius })),
      waves: this.waves.map((w) => ({ x: w.x, y: w.y, color: w.color, radius: w.radius, maxRadius: w.maxRadius })),
    };
  }
}

module.exports = { World, DEFAULTS, makeRng, boardSize };
