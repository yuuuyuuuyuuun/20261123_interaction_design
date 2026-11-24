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
  ticks: 40, // updates per round
  boardScale: 16, // board cells ≈ players × boardScale
  minCells: 96, // never smaller than this, so a small class still gets a lively world
  aspect: 4 / 3, // cols : rows
  balancedStart: true, // start every round with the three colors in exactly equal numbers (the future is blank)
  noise: 0.006,
  imitate: 0.81,
  // conformity law
  law: 'voices', // 'voices' | 'ally' | 'saturate' | 'sample'
  //   voices: each neighbor speaks up with probability `hear`. A color becomes a candidate
  //           only when at least `need` people voice it; the cell takes the most voiced
  //           candidate (`choose`: 'most' | 'share' = in proportion to the voices |
  //           'even' = any candidate equally, however many voices it got). With
  //           `selfVoice` the cell's own color always counts one voice. If nothing is
  //           voiced often enough, the cell keeps its color.
  hear: 0.77,
  inventorVoice: 0, // an inventor's voice is always heard and counts this many votes (0 = like anyone else)
  need: 2,
  choose: 'even',
  selfVoice: true,
  //   ally: look at `sample` random neighbors. If even one of them shares your color, keep it
  //         (one ally is enough to resist the pressure — Asch). Otherwise take the most
  //         common color among them. Lone cells and pairs are swallowed; a group of 3–4
  //         already gives most of its members an ally.
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
  movement: 0.03, // probability per update (once ramped up): rare, so that the board is mostly moved by people
  movementRamp: [0.15, 0.4], // none before 15% of the round, full rate from 40%
  quietFrom: 0.85, // no new movements or charismas in the last 15% of a round: the end is decided by what everyone can already see
  movementArea: [0.25, 0.5], // share of the board one movement paints (a disc), whatever the board size
  movementTarget: 'trailing', // 'trailing': only colors that are behind | 'any'
  // カリスマ
  charisma: 0.2, // probability per update that an inventor of a trailing color gets it
  charismaArea: 0.16, // share of the board under its spell (a disc around the inventor)
  charismaTurns: [5, 8],
  charismaPull: 30, // extra pull toward its color for the people under its spell (saturate/sample laws)
  charismaReach: 0.5, // voices/ally laws: chance per update that a person under the spell takes its color
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
    if (o.balancedStart) {
      this.color = Array.from({ length: this.size }, (_, i) => i % o.colors);
      for (let i = this.size - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        [this.color[i], this.color[j]] = [this.color[j], this.color[i]];
      }
    } else this.color = Array.from({ length: this.size }, () => Math.floor(this.rng() * o.colors));
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
    const [a, b] = o.movementArea;
    const radius = this.radiusFor(a + rng() * (b - a));
    const cx = Math.floor(rng() * this.cols);
    const cy = Math.floor(rng() * this.rows);
    for (const i of this.disc(cx, cy, radius)) if (!this.fixed[i]) next[i] = color;
    this.events.push({ kind: 'movement', x: cx, y: cy, radius, color });
  }

  /** radius of a disc that covers `share` of the board */
  radiusFor(share) {
    return Math.max(1, Math.sqrt((share * this.size) / Math.PI));
  }

  /** cells within `r` of (cx, cy) on the torus */
  disc(cx, cy, r) {
    const out = [];
    const R = Math.ceil(r);
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        if (2 * Math.abs(dx) >= this.cols || 2 * Math.abs(dy) >= this.rows) continue;
        out.push(((cy + dy + this.rows) % this.rows) * this.cols + ((cx + dx + this.cols) % this.cols));
      }
    return [...new Set(out)];
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
      radius: this.radiusFor(o.charismaArea),
      color: c.color,
      player: p,
    });
  }

  castSpells() {
    this.spell.fill(-1);
    const r = this.radiusFor(this.opts.charismaArea);
    for (const c of this.charismas)
      for (const j of this.disc(c.cell % this.cols, (c.cell / this.cols) | 0, r)) this.spell[j] = c.color;
  }

  /** the color a free cell takes when it reconsiders */
  conform(i, cur) {
    const o = this.opts;
    const nb = this.neighbors[i];
    const cnt = this._cnt || (this._cnt = new Array(o.colors));
    if (o.law === 'voices') {
      if (this.spell[i] >= 0 && this.rng() < o.charismaReach) return this.spell[i];
      const own = cur[i];
      cnt.fill(0);
      if (o.selfVoice) cnt[own]++;
      for (let s = 0; s < 8; s++) {
        const j = nb[s];
        if (o.inventorVoice > 0 && this.fixed[j]) cnt[cur[j]] += o.inventorVoice;
        else if (this.rng() < o.hear) cnt[cur[j]]++;
      }
      let best = own;
      let bestN = o.selfVoice ? Math.max(o.need, cnt[own]) : cnt[own] >= o.need ? cnt[own] : o.need - 1;
      if (o.choose === 'even') {
        let n = 0;
        let pick = own;
        for (let c = 0; c < cnt.length; c++) if (cnt[c] >= o.need && this.rng() < 1 / ++n) pick = c;
        return pick;
      }
      if (o.choose === 'share') {
        let total = 0;
        for (let c = 0; c < cnt.length; c++) if (cnt[c] >= o.need) total += cnt[c];
        if (total === 0) return own;
        let r = this.rng() * total;
        for (let c = 0; c < cnt.length; c++) if (cnt[c] >= o.need && (r -= cnt[c]) < 0) return c;
        return own;
      }
      let ties = 1;
      for (let c = 0; c < cnt.length; c++) {
        if (c === own || cnt[c] < o.need) continue;
        if (cnt[c] > bestN) {
          best = c;
          bestN = cnt[c];
          ties = 1;
        } else if (cnt[c] === bestN && best !== own && this.rng() < 1 / ++ties) best = c;
      }
      return best;
    }
    if (o.law === 'ally') {
      if (this.spell[i] >= 0 && this.rng() < o.charismaReach) return this.spell[i];
      const pick = this._pick || (this._pick = [0, 1, 2, 3, 4, 5, 6, 7]);
      const own = cur[i];
      cnt.fill(0);
      for (let s = 0; s < o.sample; s++) {
        const j = s + Math.floor(this.rng() * (8 - s));
        [pick[s], pick[j]] = [pick[j], pick[s]];
        const c = cur[nb[pick[s]]];
        if (c === own) return own; // an ally
        cnt[c]++;
      }
      let best = 0;
      let ties = 0;
      let choice = own;
      for (let c = 0; c < cnt.length; c++) {
        if (cnt[c] > best) {
          best = cnt[c];
          choice = c;
          ties = 1;
        } else if (cnt[c] === best && best > 0 && this.rng() < 1 / ++ties) choice = c;
      }
      return choice;
    }
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
        radius: this.radiusFor(this.opts.charismaArea),
        color: c.color,
        left: c.until - this.tick,
      })),
    };
  }
}

module.exports = { World, DEFAULTS, makeRng, boardSize };
