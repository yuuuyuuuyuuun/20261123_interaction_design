'use strict';
// 既定のパラメータでのバランス報告。 usage: node sim/simulate.js [rounds]
const { evaluate, playRound } = require('./lib');
const { nucleation, fmt } = require('./nucleation');
const { texture } = require('./texture');
const { favoriteHolds } = require('./favorite');
const { tournament, report } = require('./tournament');
const { World, DEFAULTS } = require('../src/engine');
const { BOT_TYPES } = require('../src/bots');
const R = Number(process.argv[2] || 300);
const p = (x) => (100 * x).toFixed(0).padStart(3) + '%';
const f = (x) => x.toFixed(1).padStart(5);

console.log('既定値:', JSON.stringify(DEFAULTS), '\n');

console.log('■ 塊の行方（敵の色一色の中に赤の塊を置いて20ターン後）');
const n = nucleation(DEFAULTS, R);
console.log('                     残る率（その大きさ以上を保つ）  | 領域になる率（9x9中20マス以上）');
console.log('  塊の大きさ           1    2    3    4    5    6 |    1    2    3    4    5    6');
console.log('  流されるマスだけ ', fmt(n.kept.free), '|', fmt(n.free));
console.log('  中心1つが発明者  ', fmt(n.kept.one), '|', fmt(n.one));
console.log('  全員が発明者     ', fmt(n.kept.all), '|', fmt(n.all));

const t = texture(DEFAULTS, 60);
console.log(`\n■ 盤面（誰も発明しない世界、30人）: 1ターンに変化 ${p(t.activity)} / 周り8マスが同じ色のマス ${p(t.interior)} / 一色の世界が60ターンで侵食される割合 ${p(t.invaded)}`);

console.log('\n■ 人数ごと（誰も発明しない世界での逆転率。ムーブメント・カリスマあり）');
console.log('人数  盤面   | 交代 | 「tターン時点の多数派」が負ける率 t3 t30 t50 t55 | 全員一斉発明の成功率');
for (const N of [10, 20, 30, 40]) {
  const e = evaluate(DEFAULTS, { N, R, seed: 11 });
  const w = new World(N, DEFAULTS, 1);
  console.log(String(N).padStart(3), (w.cols + 'x' + w.rows).padStart(7), ' |', f(e.leaderChanges), '|', ''.padStart(27), p(1 - e.keep3), p(1 - e.keep30), p(1 - e.keep50), p(1 - e.keep55), ' |', p(e.herd).padStart(10));
}

console.log(`\n■ 8種類のボットが均等にいるラウンドで、開始4ターン時点の多数派が勝つ率: ${p(favoriteHolds(DEFAULTS, R))}`);

console.log('\n■ 終盤に新しく始まったムーブメント・カリスマが原因の逆転（30人、8種類のボット）');
const types = Array.from({ length: 30 }, (_, i) => Object.keys(BOT_TYPES)[i % 8]);
for (const cut of [50, 55]) {
  let all = 0;
  let without = 0;
  for (let r = 0; r < R; r++) {
    const a = playRound(types, DEFAULTS, 77 + r);
    const b = playRound(types, { ...DEFAULTS, eventsStopAt: cut }, 77 + r);
    if (a.leaders[cut] !== a.res.future) all++;
    if (b.leaders[cut] !== b.res.future) without++;
  }
  console.log(`  ${cut}ターン時点の多数派が負ける率 ${p(all / R)}  うち${cut}ターン以降に始まった出来事が原因 ${p((all - without) / R)}`);
}

for (const mode of ['equal', 'random']) {
  console.log(`\n■ トーナメント（30人・5ラウンド・${R}ゲーム、構成: ${mode === 'equal' ? '8種類を均等に' : 'ゲームごとにランダム'}）`);
  report(tournament(DEFAULTS, { games: R, mode }));
}
