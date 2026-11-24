'use strict';
// 目標をまとめた評価関数でのランダム探索。 usage: node sim/search.js [trials] [seed]
const { tournament } = require('./tournament');
const { texture } = require('./texture');
const { nucleation } = require('./nucleation');
const { favoriteHolds } = require('./favorite');
const { DEFAULTS, makeRng } = require('../src/engine');
const { BOT_TYPES } = require('../src/bots');
const names = Object.keys(BOT_TYPES);

function measure(o, games = 80) {
  const opts = { ...DEFAULTS, ...o };
  const eq = tournament(opts, { games, mode: 'equal' });
  const rd = tournament(opts, { games, mode: 'random', seed: 3 });
  const win = names.map((k) => (eq.find((r) => r.type === k).winIndex + rd.find((r) => r.type === k).winIndex) / 2);
  const t = texture(opts, 20);
  const n = nucleation(opts, 80);
  const fav = favoriteHolds(opts, 80);
  return { win, fav, t, n };
}

function penalty(m) {
  const serious = names.map((k, i) => (k === 'whim' ? null : m.win[i])).filter((x) => x !== null);
  let p = Math.abs(m.fav - 0.52) * 4;
  p += Math.max(0, Math.max(...serious) - 1.8);
  p += serious.filter((x) => x < 0.3).length * 0.12;
  p += Math.max(0, 0.12 - m.t.interior) * 5 + Math.max(0, m.t.invaded - 0.15) * 3 + Math.max(0, 0.22 - m.t.activity) * 3;
  p += Math.max(0, 0.5 - (m.n.all[3] + m.n.all[4]) / 2) * 2 + Math.max(0, m.n.free[4] - 0.08) * 3;
  return p;
}

function sample(rng) {
  const pick = (a) => a[Math.floor(rng() * a.length)];
  const between = (a, b, d = 2) => Number((a + rng() * (b - a)).toFixed(d));
  return {
    half: between(2.3, 2.9),
    peak: pick([4, 5, 8]),
    floor: between(0.75, 1),
    inertia: between(0.2, 0.6),
    noise: between(0.005, 0.02, 3),
    imitate: between(0.6, 0.95),
    charisma: between(0.1, 0.35),
    charismaPull: Math.round(between(6, 20)),
    charismaRadius: pick([2, 3]),
    charismaTurns: pick([[4, 6], [5, 8]]),
    movement: between(0.02, 0.08, 3),
    movementRadius: [0.1, between(0.15, 0.25)],
  };
}

const short = (m) =>
  `有力色${(100 * m.fav).toFixed(0)}% 優勝[${m.win.map((x) => x.toFixed(1)).join(' ')}] 変化${(100 * m.t.activity).toFixed(0)}% まとまり${(100 * m.t.interior).toFixed(0)}% 侵食${(100 * m.t.invaded).toFixed(0)}% 塊3,4=${(100 * m.n.all[3]).toFixed(0)},${(100 * m.n.all[4]).toFixed(0)}% 流4=${(100 * m.n.free[4]).toFixed(0)}%`;

if (require.main === module) {
  const trials = Number(process.argv[2] || 30);
  const rng = makeRng(Number(process.argv[3] || 1));
  const results = [];
  console.log('優勝指数の並び:', names.map((k) => BOT_TYPES[k].short).join(' '));
  for (let i = 0; i < trials; i++) {
    const o = sample(rng);
    const m = measure(o);
    const p = penalty(m);
    results.push({ o, m, p });
    console.log(`#${i} 罰点${p.toFixed(2)} ${short(m)}`);
  }
  results.sort((a, b) => a.p - b.p);
  console.log('\n上位:');
  for (const r of results.slice(0, 5)) console.log(r.p.toFixed(2), JSON.stringify(r.o), '\n   ', short(r.m));
}
module.exports = { measure, penalty, short };
