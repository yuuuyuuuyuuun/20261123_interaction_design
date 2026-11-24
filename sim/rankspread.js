'use strict';
// 平均順位のばらつきを指標にした比較
const { tournament } = require('./tournament');
const { favoriteHolds } = require('./favorite');
const { nucleation } = require('./nucleation');
const { DEFAULTS } = require('../src/engine');
const { BOT_TYPES } = require('../src/bots');
const names = Object.keys(BOT_TYPES);
const head = names.map((k) => BOT_TYPES[k].short.padStart(5)).join('');
function row(label, o, games = 150) {
  const opts = { ...DEFAULTS, ...o };
  const eq = tournament(opts, { games, mode: 'equal' });
  const r = names.map((k) => eq.find((x) => x.type === k).avgRank);
  const serious = names.map((k, i) => (k === 'whim' ? null : r[i])).filter((x) => x !== null);
  const n = nucleation(opts, 80);
  console.log(
    `${label.padEnd(36)}|${r.map((x) => x.toFixed(1).padStart(5)).join('')} | 幅 ${(Math.max(...serious) - Math.min(...serious)).toFixed(1).padStart(4)} | 有力色 ${(100 * favoriteHolds(opts, 100)).toFixed(0)}% | 発明塊3,4 ${(100 * n.all[3]).toFixed(0)},${(100 * n.all[4]).toFixed(0)}%`
  );
}
module.exports = { row, head };
