'use strict';
// 既定のパラメータでのバランス報告。 usage: node sim/simulate.js [rounds]
const { evaluate } = require('./lib');
const { World, DEFAULTS } = require('../src/engine');
const { BOT_TYPES } = require('../src/bots');
const R = Number(process.argv[2] || 400);
const p = (x) => (100 * x).toFixed(0).padStart(3) + '%';
const f = (x) => x.toFixed(1).padStart(5);

console.log('既定値:', JSON.stringify(DEFAULTS), '\n');
console.log('人数  盤面   | 1ターンに変化 多数派交代 | 発明なしで「t秒時点の多数派」が勝つ率 t3 t10 t30 t50 | 単独発明 全員一斉発明');
const rows = [];
for (const N of [5, 10, 20, 30, 40]) {
  const e = evaluate(DEFAULTS, { N, R, seed: 11 });
  const w = new World(N, DEFAULTS, 1);
  rows.push([N, e]);
  console.log(
    String(N).padStart(3), (w.cols + 'x' + w.rows).padStart(7), ' |', p(e.activity).padStart(12), f(e.leaderChanges).padStart(9), ' |',
    ''.padStart(30), p(e.keep3), p(e.keep10), p(e.keep30), p(e.keep50), ' |', p(e.lone).padStart(7), p(e.herd).padStart(10)
  );
}
console.log('\n平均得点（満点60） 人数30');
const e = rows.find(([N]) => N === 30)[1];
console.log('  発明者が多い集団（早期発明70% / 追従予言30%）: 発明', f(e.herdMix.inventEarly), ' 予言', f(e.herdMix.follow));
console.log('  発明者が少ない集団（早期発明10% / 追従予言90%）: 発明', f(e.fewMix.inventEarly), ' 予言', f(e.fewMix.follow));
console.log('  5種類が均等に混ざった集団:');
for (const [k, v] of Object.entries(e.mixed)) console.log('   ', BOT_TYPES[k].label.padEnd(8), f(v));
