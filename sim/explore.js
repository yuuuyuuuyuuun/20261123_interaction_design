'use strict';
// ムーブメントの探索（既定値の周辺）。 usage: node sim/explore.js [rounds]
const { evaluate } = require('./lib');
const { DEFAULTS } = require('../src/engine');
const R = Number(process.argv[2] || 200);
const f = (x, d = 1) => x.toFixed(d);
const p = (x) => (100 * x).toFixed(0).padStart(3) + '%';
// 「tターン時点の多数派が負ける率」= 逆転率
const row = (label, o) => {
  const e = evaluate({ ...DEFAULTS, ...o }, { R });
  console.log(
    `${label.padEnd(26)}| ${f(e.movements)} ${p(e.activity)} ${f(e.leaderChanges)} | ${p(1 - e.keep3)} ${p(1 - e.keep30)} ${p(1 - e.keep40)} ${p(1 - e.keep50)} ${p(1 - e.keep55)} | ${p(e.lone)} ${p(e.herd)} | ${f(e.herdMix.inventEarly)}/${f(e.herdMix.predict)} ${f(e.fewMix.inventEarly)}/${f(e.fewMix.predict)}`
  );
};
console.log('設定                      | 回数 活発 交代 | 逆転率 t3 t30 t40 t50 t55 | 単独 全員 | 群れ70%:発/予 少数10%:発/予');
row('既定値', {});
row('旧: 一色に塗る', { movement: 0.12, movementRamp: [0, 0], movementRadius: [0.22, 0.45], movementBacklash: 0, movementSpeed: 0, movementHold: [0, 0], movementTarget: 'any' });
for (const movement of [0.06, 0.1])
  for (const top of [0.38, 0.46])
    for (const movementSpeed of [0.3, 0.6])
      row(`p${movement} r${top} v${movementSpeed}`, { movement, movementRadius: [0.06, top], movementSpeed });
