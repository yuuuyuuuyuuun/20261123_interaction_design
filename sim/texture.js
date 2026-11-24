'use strict';
// 盤面の質感: 誰も発明しない世界で、どれだけ動き、どれだけまとまった領域ができるか
const { World, DEFAULTS } = require('../src/engine');
const { marks } = require('./lib');
function texture(opts, R = 60, N = 30) {
  let act = 0, interior = 0, lc = 0, k3 = 0, k30 = 0, k50 = 0, uni = 0;
  for (let r = 0; r < R; r++) {
    const w = new World(N, { ...opts, movement: 0, charisma: 0 }, 50 + r);
    const leaders = [w.leader()];
    let prev = w.leader();
    for (let t = 0; t < w.opts.ticks; t++) {
      const before = w.color.slice();
      w.step();
      for (let i = 0; i < w.size; i++) if (before[i] !== w.color[i]) act++;
      const l = w.leader();
      leaders.push(l);
      if (l >= 0 && prev >= 0 && l !== prev) lc++;
      if (l >= 0) prev = l;
    }
    for (let i = 0; i < w.size; i++) if (w.neighbors[i].every((j) => w.color[j] === w.color[i])) interior++;
    const f = w.leader();
    const M = marks(w.opts.ticks);
    if (leaders[M.early] === f) k3++;
    if (leaders[M.half] === f) k30++;
    if (leaders[M.q83] === f) k50++;
    interior /= 1;
    // spontaneous nucleation: start from a one-color world
    const u = new World(N, { ...opts, movement: 0, charisma: 0 }, 900 + r);
    u.color.fill(1);
    for (let t = 0; t < 60; t++) u.step(); // always 60 updates: how robust a region is per update
    uni += 1 - u.counts()[1] / u.size;
    act /= 1;
  }
  const w0 = new World(N, opts, 1);
  return {
    activity: act / (R * w0.size * w0.opts.ticks),
    interior: interior / (R * w0.size),
    leaderChanges: lc / R,
    lose3: 1 - k3 / R, lose30: 1 - k30 / R, lose50: 1 - k50 / R,
    invaded: uni / R,
  };
}
module.exports = { texture };
