'use strict';
const { World, makeRng } = require('../src/engine');
const { createBot, BOT_TYPES } = require('../src/bots');
const { observe, localCounts } = require('../src/odds');

/**
 * Plays one round with bots.
 * @param {string[]} types bot type per player (null = does nothing)
 * @param {object} opts engine options
 * @param {object} [hooks] { before(world) } called before the first update
 */
function playRound(types, opts, seed, hooks = {}) {
  const w = new World(types.length, opts, seed);
  const rng = makeRng(seed ^ 0x9e3779b9);
  const bots = types.map((t) => (t ? createBot(t, rng, w.opts.ticks) : null));
  hooks.before?.(w);
  const leaders = [w.leader()];
  let changed = 0;
  let leaderChanges = 0;
  let prevLeader = w.leader();
  let movements = 0;
  while (!w.finished) {
    const view = observe(w);
    bots.forEach((b, p) => {
      if (!b) return;
      const cell = w.playerCell[p];
      b.act(view, { decl: w.decl[p], local: localCounts(w, cell), color: w.color[cell] }, { predict: (c) => w.predict(p, c), invent: (c) => w.invent(p, c) });
    });
    const before = w.color;
    w.step();
    movements += w.events.length;
    for (let i = 0; i < w.size; i++) if (before[i] !== w.color[i]) changed++;
    const l = w.leader();
    leaders.push(l);
    if (l >= 0 && l !== prevLeader && prevLeader >= 0) leaderChanges++;
    if (l >= 0) prevLeader = l;
  }
  const res = w.result();
  const sorted = [...res.counts].sort((a, b) => b - a);
  return {
    w,
    res,
    leaders,
    activity: changed / (w.size * w.opts.ticks),
    leaderChanges,
    movements,
    margin: (sorted[0] - sorted[1]) / w.size,
  };
}

/** points of a round as shares of its length: 5%, 50%, 75%, 83% (= 50 of 60), 92% (= 55 of 60) */
function marks(T) {
  return { early: Math.max(1, Math.round(T * 0.05)), half: Math.round(T / 2), q75: Math.round(T * 0.75), q83: Math.round((T * 5) / 6), q92: Math.round((T * 11) / 12) };
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

/** Evaluates a parameter set. Returns plain numbers. */
function evaluate(opts, { N = 30, R = 300, seed = 1 } = {}) {
  const T = opts.ticks || 60;
  const out = {};
  // A. no inventors at all
  {
    const act = [], lc = [], m = [], hit = { early: 0, half: 0, q75: 0, q83: 0, q92: 0 }, ties = [], mv = [];
    for (let r = 0; r < R; r++) {
      const g = playRound(new Array(N).fill('follow'), opts, seed * 1e6 + r);
      act.push(g.activity); lc.push(g.leaderChanges); m.push(g.margin);
      mv.push(g.movements);
      for (const [k, t] of Object.entries(marks(g.w.opts.ticks))) if (g.leaders[t] === g.res.future) hit[k]++;
      ties.push(g.res.future < 0 ? 1 : 0);
    }
    Object.assign(out, {
      activity: mean(act), leaderChanges: mean(lc), margin: mean(m), ties: mean(ties),
      keepEarly: hit.early / R, keepHalf: hit.half / R, keep75: hit.q75 / R, keep83: hit.q83 / R, keep92: hit.q92 / R, movements: mean(mv),
    });
  }
  // B. a lone inventor of a random color at t=0, everyone else follows
  {
    let ok = 0;
    for (let r = 0; r < R; r++) {
      const types = new Array(N).fill('follow'); types[0] = null;
      const g = playRound(types, opts, seed * 2e6 + r, { before: (w) => w.invent(0, Math.floor(w.rng() * 3)) });
      if (g.res.future === g.w.decl[0].color) ok++;
    }
    out.lone = ok / R;
  }
  // C. herd: everyone invents the current leader right after the start
  {
    let ok = 0;
    for (let r = 0; r < R; r++) {
      const g = playRound(new Array(N).fill('inventEarly'), opts, seed * 3e6 + r);
      const d = g.w.decl.filter(Boolean);
      ok += mean(d.map((x) => (x.color === g.res.future ? 1 : 0)));
    }
    out.herd = ok / R;
  }
  // D. strategy mixes
  const mix = (pick, tag) => {
    const score = {};
    for (let r = 0; r < R; r++) {
      const rng = makeRng(seed * 4e6 + r);
      const types = Array.from({ length: N }, () => pick(rng));
      const g = playRound(types, opts, seed * 5e6 + r);
      types.forEach((t, p) => (score[t] ||= []).push(g.res.scores[p]));
    }
    out[tag] = Object.fromEntries(Object.entries(score).map(([k, v]) => [k, mean(v)]));
  };
  const ALL = Object.keys(BOT_TYPES);
  mix((rng) => ALL[Math.floor(rng() * ALL.length)], 'mixed');
  mix((rng) => (rng() < 0.7 ? 'inventEarly' : 'predict'), 'herdMix');
  mix((rng) => (rng() < 0.1 ? 'inventEarly' : 'predict'), 'fewMix');
  // the value-based predictor against the naive one, in the same worlds
  mix((rng) => { const r = rng(); return r < 0.25 ? 'predict' : r < 0.5 ? 'follow' : ALL[Math.floor(rng() * ALL.length)]; }, 'predictors');
  return out;
}

module.exports = { playRound, evaluate, mean, marks };
