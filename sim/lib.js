'use strict';
const { World, makeRng } = require('../src/engine');
const { createBot } = require('../src/bots');

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
  while (!w.finished) {
    const view = { tick: w.tick, counts: w.counts() };
    bots.forEach((b, p) => {
      if (!b) return;
      b.act(view, { decl: w.decl[p] }, { predict: (c) => w.predict(p, c), invent: (c) => w.invent(p, c) });
    });
    const before = w.color;
    w.step();
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
    margin: (sorted[0] - sorted[1]) / w.size,
  };
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

/** Evaluates a parameter set. Returns plain numbers. */
function evaluate(opts, { N = 30, R = 300, seed = 1 } = {}) {
  const T = opts.ticks || 60;
  const out = {};
  // A. no inventors at all
  {
    const act = [], lc = [], m = [], hit = { 3: 0, 10: 0, 30: 0, 50: 0 }, ties = [];
    for (let r = 0; r < R; r++) {
      const g = playRound(new Array(N).fill('follow'), opts, seed * 1e6 + r);
      act.push(g.activity); lc.push(g.leaderChanges); m.push(g.margin);
      for (const t of [3, 10, 30, 50]) if (g.leaders[t] === g.res.future) hit[t]++;
      ties.push(g.res.future < 0 ? 1 : 0);
    }
    Object.assign(out, {
      activity: mean(act), leaderChanges: mean(lc), margin: mean(m), ties: mean(ties),
      keep3: hit[3] / R, keep10: hit[10] / R, keep30: hit[30] / R, keep50: hit[50] / R,
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
  const ALL = ['follow', 'wait', 'inventEarly', 'inventLate', 'contrarian'];
  mix((rng) => ALL[Math.floor(rng() * ALL.length)], 'mixed');
  mix((rng) => (rng() < 0.7 ? 'inventEarly' : 'follow'), 'herdMix');
  mix((rng) => (rng() < 0.1 ? 'inventEarly' : 'follow'), 'fewMix');
  return out;
}

module.exports = { playRound, evaluate, mean };
