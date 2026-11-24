'use strict';
// 結託: k人が決めたターンに2番手の色を一斉に発明したら、平均順位で上位を独占できるか。
// 残りの席は10種類のボットを均等に。 usage: node sim/cartel.js [games]
const { rankBy } = require('./tournament');
const { DEFAULTS } = require('../src/engine');
const { BOT_TYPES } = require('../src/bots');
const GAMES = Number(process.argv[2] || 200);
const OPTS = { ...DEFAULTS, ...JSON.parse(process.env.OPTS || '{}') };
const names = Object.keys(BOT_TYPES);

console.log('結託メンバーの平均順位（30人中）／ 同じ集団での期待値予言・予言/発明・穴狙い発明の平均順位');
for (const at of [3, 6, 10])
  for (const k of [1, 3, 5, 8, 12]) {
    const roster = [];
    for (let i = 0; i < k; i++) roster.push({ key: 'cartel', type: 'cartel', opts: { at } });
    for (let i = 0; i < 30 - k; i++) roster.push({ key: names[i % names.length], type: names[i % names.length] });
    const r = rankBy(roster, OPTS, { games: GAMES, seed: 3 });
    console.log(
      `${String(at).padStart(2)}ターン目に${String(k).padStart(2)}人で結託: ${r.cartel.avgRank.toFixed(1).padStart(5)}位 (${r.cartel.perRound.toFixed(1)}点)` +
        `   期待値予言 ${r.predict.avgRank.toFixed(1)}  予言/発明 ${r.mixed.avgRank.toFixed(1)}  穴狙い ${r.underdog.avgRank.toFixed(1)}`
    );
  }
