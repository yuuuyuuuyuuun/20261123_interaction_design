'use strict';
// 理屈のある戦略どうしの駆け引き。
//   発明: 何ターン待つか / 予言: どれだけ慎重に乗り換えるか /
//   混成: 予言で始め、乗り換えるときは発明する（はっきりしていれば最初から発明する）
// 構成を変えた集団で、それぞれの平均順位を測る。 usage: OPTS='{...}' node sim/meta.js [games]
const { rankBy } = require('./tournament');
const { DEFAULTS } = require('../src/engine');
const GAMES = Number(process.argv[2] || 200);
const OPTS = { ...DEFAULTS, ...JSON.parse(process.env.OPTS || '{}') };

const KINDS = {
  inv: [0, 2, 4, 6].map((w) => ({ key: `発明 ${w}ターン待つ`, type: 'inventAt', opts: { wait: w } })),
  pred: [1.0, 1.2, 1.5].map((m) => ({ key: `予言 乗り換え基準×${m.toFixed(1)}`, type: 'predict', opts: { margin: m } })),
  mix: [
    { key: '混成 予言→発明で乗り換え×1.0', type: 'mixed', opts: { margin: 1.0 } },
    { key: '混成 予言→発明で乗り換え×1.2', type: 'mixed', opts: { margin: 1.2 } },
    { key: '混成 勝率45%以上なら即発明', type: 'mixed', opts: { margin: 1.0, clear: 0.45 } },
    { key: '混成 勝率55%以上なら即発明', type: 'mixed', opts: { margin: 1.0, clear: 0.55 } },
  ],
};

function roster([nInv, nPred, nMix]) {
  const out = [];
  const take = (list, n) => { for (let i = 0; i < n; i++) out.push(list[i % list.length]); };
  take(KINDS.inv, nInv);
  take(KINDS.pred, nPred);
  take(KINDS.mix, nMix);
  return out;
}

const COMPS = [[10, 10, 10], [4, 6, 20], [16, 6, 8], [6, 16, 8]];
const results = COMPS.map((c) => rankBy(roster(c), OPTS, { games: GAMES }));
const keys = [...KINDS.inv, ...KINDS.pred, ...KINDS.mix].map((k) => k.key);
console.log('平均順位（30人中、小さいほど強い）。列は 発明/予言/混成 の人数');
console.log(''.padEnd(26), COMPS.map((c) => c.join('/').padStart(9)).join(''));
for (const k of keys) console.log(k.padEnd(26), results.map((r) => (r[k] ? r[k].avgRank.toFixed(1) : '-').padStart(9)).join(''));
