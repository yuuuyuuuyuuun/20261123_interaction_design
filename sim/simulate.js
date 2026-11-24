'use strict';
// 既定のパラメータでのバランス報告。 usage: node sim/simulate.js [rounds]
const { evaluate, playRound } = require('./lib');
const { World, DEFAULTS } = require('../src/engine');
const { BOT_TYPES, HIDDEN_TYPES } = require('../src/bots');
const R = Number(process.argv[2] || 400);
const p = (x) => (100 * x).toFixed(0).padStart(3) + '%';
const f = (x) => x.toFixed(1).padStart(5);
const label = (k) => (BOT_TYPES[k] || HIDDEN_TYPES[k]).label;

console.log('既定値:', JSON.stringify(DEFAULTS), '\n');
console.log('人数  盤面   | 変化 交代 ﾑｰﾌﾞﾒﾝﾄ | 「tターン時点の多数派」が負ける率 t3 t30 t40 t50 t55 | 単独発明 全員一斉発明');
let e30;
for (const N of [5, 10, 20, 30, 40]) {
  const e = evaluate(DEFAULTS, { N, R, seed: 11 });
  if (N === 30) e30 = e;
  const w = new World(N, DEFAULTS, 1);
  console.log(
    String(N).padStart(3), (w.cols + 'x' + w.rows).padStart(7), ' |', p(e.activity), f(e.leaderChanges), f(e.movements), ' |',
    ''.padStart(27), p(1 - e.keep3), p(1 - e.keep30), p(1 - e.keep40), p(1 - e.keep50), p(1 - e.keep55), ' |', p(e.lone).padStart(7), p(e.herd).padStart(10)
  );
}

// reversals caused by movements that start late: replay the same rounds without them
console.log('\n終盤に新しく始まったムーブメントが原因の逆転（人数30）');
const types = Array.from({ length: 30 }, (_, i) => Object.keys(BOT_TYPES)[i % 4]);
for (const cut of [50, 55]) {
  let all = 0;
  let without = 0;
  const RR = R * 2;
  for (let r = 0; r < RR; r++) {
    const a = playRound(types, DEFAULTS, 77 + r);
    const b = playRound(types, { ...DEFAULTS, movementStopAt: cut }, 77 + r);
    if (a.leaders[cut] !== a.res.future) all++;
    if (b.leaders[cut] !== b.res.future) without++;
  }
  console.log(`  ${cut}ターン時点の多数派が負ける率 ${p(all / RR)}  うち${cut}ターン以降のムーブメントが原因 ${p((all - without) / RR)}`);
}

console.log('\n平均得点（満点60） 人数30');
console.log('  発明者が多い集団（早期発明70% / 期待値予言30%）: 発明', f(e30.herdMix.inventEarly), ' 予言', f(e30.herdMix.predict));
console.log('  発明者が少ない集団（早期発明10% / 期待値予言90%）: 発明', f(e30.fewMix.inventEarly), ' 予言', f(e30.fewMix.predict));
console.log('  4種類が均等に混ざった集団:');
for (const [k, v] of Object.entries(e30.mixed)) console.log('   ', label(k).padEnd(8), f(v));
console.log('  予言ボットの比較（同じ世界で対戦）:');
for (const k of ['predict', 'follow']) console.log('   ', label(k).padEnd(8), f(e30.predictors[k]));
