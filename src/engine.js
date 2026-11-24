'use strict';

// 世界は、わたしたちでできている — game engine (pure, no I/O)
//
// 世界   : a large torus-shaped rectangle of cells. A few of them are the players;
//          the rest are the crowd — people who never invent and always flow.
// 法則   : every free cell, on every update,
//            - 気まぐれ (noise)   : with probability `noise`, takes a random color
//            - 同調     (imitate) : otherwise, with probability `imitate`, reconsiders its color
//                                   by looking at its 8 neighbors (see conform())
//          and now and then
//            - ムーブメント (movement) : a disc of free cells turns into a color that is behind
//            - カリスマ     (charisma) : an inventor of a color that is behind becomes, for a few
//                                         updates, enormously persuasive to the people around it
//          Neither starts in the last 15% of a round.
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
  noise: 0.008,
  imitate: 0.85,
  // conformity law
  law: 'saturate', // 'saturate' | 'sample'
  //   saturate: a color pulls a cell by n^p / (n^p + half^p), n = neighbors of that color.
  //             2–3 neighbors are already persuasive; more add little, so a small group of
  //             3–4 can hold its ground and grow. (Optionally the pull can decline beyond
  //             `peak` neighbors down to `floor` × its peak value at 8 — tried, but a real
  //             decline breaks every region into a mosaic, so it is off.)
  half: 2.35,
  power: 3,
  peak: 8,
  floor: 1,
  inertia: 0.4, // extra pull of the cell's own color
  //   sample: look at `sample` random neighbors and take their most common color
  sample: 3,
  // ムーブメント
  movement: 0.05, // probability per update (once ramped up)
  movementRamp: [0.15, 0.4], // none before 15% of the round, full rate from 40%
  quietFrom: 0.85, // no new movements or charismas in the last 15% of a round: the end is decided by what everyone can already see
  movementRadius: [0.1, 0.18], // relative to the shorter side of the board
  movementTarget: 'trailing', // 'trailing': only colors that are behind | 'any'
  // カリスマ
  charisma: 0.22, // probability per update that an inventor of a trailing color gets it
  charismaRadius: 3, // the people within this many cells (a square) are under its spell
  charismaTurns: [4, 6],
  charismaPull: 30, // extra pull toward its color for the people under its spell
  eventsStopAt: Infinity, // (simulation only) no new movements or charismas from this update on
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
    this.pullTable = []; // saturate law: pull of n neighbors, n = 0..8
    const hill = (n) => n ** o.power / (n ** o.power + o.half ** o.power);
    for (let n = 0; n <= 8; n++)
      this.pullTable.push(n <= o.peak ? hill(n) : hill(o.peak) * (1 - ((1 - o.floor) * (n - o.peak)) / (8 - o.peak)));
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
    this.events = []; // movements and charismas that started on the latest update
    this.charismas = []; // { player, cell, color, until }
    this.spell = new Array(this.size).fill(-1); // charisma color over each cell (-1 none)
    this.history = [this.counts()];
  }

  counts(color = this.color) {
    const c = new Array(this.opts.colors).fill(0);
    for (const v of color) c[v]++;
    return c;
  }

  /** plurality color, or -1 on a tie */
  leader(counts = this.counts()) {
    const max = Math.max(...counts);
    return counts.filter((v) => v === max).length > 1 ? -1 : counts.indexOf(max);
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
      const spelled = this.spell[i] >= 0;
      const r = rng();
      if (!spelled && r < o.noise) next[i] = Math.floor(rng() * o.colors);
      else if (spelled || r < o.noise + o.imitate) next[i] = this.conform(i, cur);
    }

    this.events = [];
    const counts = this.counts(cur);
    const quiet = this.tick >= o.eventsStopAt || this.tick >= o.ticks * o.quietFrom;
    if (rng() < o.movement * this.ramp(o.movementRamp) && !quiet) this.paint(cur, next, counts);
    this.charismas = this.charismas.filter((c) => c.until > this.tick + 1);
    if (rng() < o.charisma && !quiet) this.inspire(counts);
    this.castSpells();

    this.color = next;
    this.tick++;
    this.history.push(this.counts());
  }

  /** 0 → 1 over the round */
  ramp([a, b]) {
    const f = this.tick / this.opts.ticks;
    if (f < a) return 0;
    return b > a ? Math.min(1, (f - a) / (b - a)) : 1;
  }

  /** colors that are not in the lead */
  trailing(counts) {
    const max = Math.max(...counts);
    const behind = [...counts.keys()].filter((c) => counts[c] < max);
    return behind.length ? behind : [...counts.keys()];
  }

  /** ムーブメント: a disc of free cells turns into a color that is behind, at once */
  paint(cur, next, counts) {
    const o = this.opts;
    const rng = this.rng;
    const choices = o.movementTarget === 'trailing' ? this.trailing(counts) : [...counts.keys()];
    const color = choices[Math.floor(rng() * choices.length)];
    const short = Math.min(this.cols, this.rows);
    const [ra, rb] = o.movementRadius;
    const radius = Math.max(1, short * (ra + rng() * (rb - ra)));
    const cx = Math.floor(rng() * this.cols);
    const cy = Math.floor(rng() * this.rows);
    for (let i = 0; i < this.size; i++) {
      if (this.fixed[i]) continue;
      let dx = Math.abs((i % this.cols) - cx);
      let dy = Math.abs(((i / this.cols) | 0) - cy);
      dx = Math.min(dx, this.cols - dx);
      dy = Math.min(dy, this.rows - dy);
      if (dx * dx + dy * dy <= radius * radius) next[i] = color;
    }
    this.events.push({ kind: 'movement', x: cx, y: cy, radius, color });
  }

  /** カリスマ: one inventor of a color that is behind becomes persuasive for a while */
  inspire(counts) {
    const o = this.opts;
    const behind = new Set(this.trailing(counts));
    const busy = new Set(this.charismas.map((c) => c.player));
    const eligible = [];
    this.decl.forEach((d, p) => d?.invented && behind.has(d.color) && !busy.has(p) && eligible.push(p));
    if (!eligible.length) return;
    const p = eligible[Math.floor(this.rng() * eligible.length)];
    const [a, b] = o.charismaTurns;
    const turns = a + Math.floor(this.rng() * (b - a + 1));
    const c = { player: p, cell: this.playerCell[p], color: this.decl[p].color, until: this.tick + 1 + turns };
    this.charismas.push(c);
    this.events.push({
      kind: 'charisma',
      x: c.cell % this.cols,
      y: (c.cell / this.cols) | 0,
      radius: o.charismaRadius,
      color: c.color,
      player: p,
    });
  }

  castSpells() {
    this.spell.fill(-1);
    const R = this.opts.charismaRadius;
    for (const c of this.charismas) {
      const x0 = c.cell % this.cols;
      const y0 = (c.cell / this.cols) | 0;
      for (let dy = -R; dy <= R; dy++)
        for (let dx = -R; dx <= R; dx++) {
          const j = ((y0 + dy + this.rows) % this.rows) * this.cols + ((x0 + dx + this.cols) % this.cols);
          this.spell[j] = c.color;
        }
    }
  }

  /** the color a free cell takes when it reconsiders */
  conform(i, cur) {
    const o = this.opts;
    const nb = this.neighbors[i];
    const cnt = this._cnt || (this._cnt = new Array(o.colors));
    if (o.law === 'sample') {
      const pick = this._pick || (this._pick = [0, 1, 2, 3, 4, 5, 6, 7]);
      cnt.fill(0);
      for (let s = 0; s < o.sample; s++) {
        const j = s + Math.floor(this.rng() * (8 - s));
        [pick[s], pick[j]] = [pick[j], pick[s]];
        cnt[cur[nb[pick[s]]]]++;
      }
      if (this.spell[i] >= 0) cnt[this.spell[i]] += o.charismaPull * 2;
      let best = 0;
      let ties = 0;
      let choice = cur[i];
      for (let c = 0; c < cnt.length; c++) {
        if (cnt[c] > best) {
          best = cnt[c];
          choice = c;
          ties = 1;
        } else if (cnt[c] === best && best > 0 && this.rng() < 1 / ++ties) choice = c;
      }
      return choice;
    }
    // saturate
    cnt.fill(0);
    for (let s = 0; s < 8; s++) cnt[cur[nb[s]]]++;
    const w = this._w || (this._w = new Array(o.colors));
    let total = 0;
    for (let c = 0; c < o.colors; c++) {
      w[c] = this.pullTable[cnt[c]] + (c === cur[i] ? o.inertia : 0) + (c === this.spell[i] ? o.charismaPull : 0);
      total += w[c];
    }
    let r = this.rng() * total;
    for (let c = 0; c < o.colors; c++) if ((r -= w[c]) < 0) return c;
    return cur[i];
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
      charismas: this.charismas.map((c) => ({
        player: c.player,
        x: c.cell % this.cols,
        y: (c.cell / this.cols) | 0,
        radius: this.opts.charismaRadius,
        color: c.color,
        left: c.until - this.tick,
      })),
    };
  }
}

module.exports = { World, DEFAULTS, makeRng, boardSize };
