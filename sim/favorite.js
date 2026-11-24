'use strict';
// 8種類のボットが均等にいるラウンドで、開始4ターン時点の多数派が最終的に勝つ率
const { tournament } = require("./tournament");
const { World, DEFAULTS, makeRng } = require('../src/engine');
const { BOT_TYPES, createBot } = require('../src/bots');
const { observe, localCounts, winProbs } = require('../src/odds');
const names = Object.keys(BOT_TYPES);
// P(the model's favorite at t=3 wins) in equal-composition rounds
function favoriteHolds(opts, R = 150) {
  let hold = 0;
  for (let r = 0; r < R; r++) {
    const types = Array.from({ length: 30 }, (_, i) => names[i % names.length]);
    const rng = makeRng(r + 5);
    const w = new World(30, opts, 400 + r);
    const bots = types.map((t) => createBot(t, rng, w.opts.ticks));
    let fav = -1;
    while (!w.finished) {
      const view = observe(w);
      if (w.tick === 4) { const c = w.counts(); fav = c.indexOf(Math.max(...c)); }
      bots.forEach((b, p) => { const cell = w.playerCell[p]; b.act(view, { decl: w.decl[p], local: localCounts(w, cell), color: w.color[cell] }, { predict: (c) => w.predict(p, c), invent: (c) => w.invent(p, c) }); });
      w.step();
    }
    if (w.leader() === fav) hold++;
  }
  return hold / R;
}
function row(label, o) {
  const opts = { ...DEFAULTS, ...o };
  const eq = tournament(opts, { games: 120, mode: 'equal' });
  const rd = tournament(opts, { games: 120, mode: 'random', seed: 2 });
  const get = (rows, k, f) => rows.find((r) => r.type === k)[f];
  const fmt = (a) => a.map((x) => x.toFixed(1).padStart(4)).join(' ');
  console.log(`${label.padEnd(34)}| ${(100 * favoriteHolds(opts)).toFixed(0).padStart(3)}% | ${fmt(names.map((k) => get(eq, k, 'winIndex')))} | ${fmt(names.map((k) => get(rd, k, 'winIndex')))} | ${fmt(names.map((k) => get(eq, k, 'perRound') / 10))}`);
}
module.exports = { row, favoriteHolds };
