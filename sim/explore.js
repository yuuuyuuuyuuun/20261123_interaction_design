'use strict';
// パラメータの総当たり探索（既定値の周辺）。 usage: node sim/explore.js [rounds]
const { evaluate } = require('./lib');
const { DEFAULTS } = require('../src/engine');
const R = Number(process.argv[2] || 150);
const f = (x, d = 1) => x.toFixed(d);
const p = (x) => (100 * x).toFixed(0).padStart(3) + '%';
const GRID = {
  sample: [1, 3, 5],
  boardScale: [8, 16],
  noise: [0.02, 0.04, 0.08],
  movement: [0, 0.12, 0.2],
};
console.log('k scale noise move | 活発 逆転 t3 t10 t30 t50 | 単独 全員 | 群れ70%:発/予 少数10%:発/予');
for (const sample of GRID.sample)
  for (const boardScale of GRID.boardScale)
    for (const noise of GRID.noise)
      for (const movement of GRID.movement) {
        const e = evaluate({ ...DEFAULTS, sample, boardScale, noise, movement }, { R });
        console.log(
          `${sample} ${String(boardScale).padStart(2)} ${noise.toFixed(2)} ${movement.toFixed(2)} | ${p(e.activity)} ${f(e.leaderChanges).padStart(4)} ${p(e.keep3)} ${p(e.keep10)} ${p(e.keep30)} ${p(e.keep50)} | ${p(e.lone)} ${p(e.herd)} | ${f(e.herdMix.inventEarly)}/${f(e.herdMix.follow)} ${f(e.fewMix.inventEarly)}/${f(e.fewMix.follow)}`
        );
      }
