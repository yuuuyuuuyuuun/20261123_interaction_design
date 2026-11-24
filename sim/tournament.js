'use strict';
// 5ラウンド制のゲームを何度も行い、どの戦略が最終的に優勝するかを測る。
// usage: node sim/tournament.js [games] [mode=equal|random]
const { World, DEFAULTS, makeRng } = require('../src/engine');
const { BOT_TYPES, createBot } = require('../src/bots');
const { observe, localCounts } = require('../src/odds');

function playGame(types, opts, seed, rounds = 5) {
  const rng = makeRng(seed);
  const totals = new Array(types.length).fill(0);
  for (let r = 0; r < rounds; r++) {
    // seats are reshuffled every round, as on the server
    const order = [...types.keys()];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const w = new World(types.length, opts, (seed * 31 + r * 7919) >>> 0);
    const bots = order.map((k) =>
      typeof types[k] === 'string' ? createBot(types[k], rng, w.opts.ticks) : createBot(types[k].type, rng, w.opts.ticks, types[k].opts)
    );
    while (!w.finished) {
      const view = observe(w);
      bots.forEach((b, p) => {
        const cell = w.playerCell[p];
        b.act(view, { decl: w.decl[p], local: localCounts(w, cell), color: w.color[cell] }, {
          predict: (c) => w.predict(p, c),
          invent: (c) => w.invent(p, c),
        });
      });
      w.step();
    }
    w.result().scores.forEach((s, p) => (totals[order[p]] += s));
  }
  return totals;
}

function tournament(opts, { games = 200, N = 30, mode = 'equal', seed = 1 } = {}) {
  const names = Object.keys(BOT_TYPES);
  const stat = Object.fromEntries(names.map((k) => [k, { seats: 0, wins: 0, points: 0, top3: 0, rank: 0 }]));
  for (let g = 0; g < games; g++) {
    const rng = makeRng(seed * 1e5 + g);
    let types;
    if (mode === 'equal') types = Array.from({ length: N }, (_, i) => names[i % names.length]);
    else {
      // random composition: a few strategies are popular in each class
      const weight = names.map(() => rng() ** 2);
      const sum = weight.reduce((a, b) => a + b, 0);
      types = Array.from({ length: N }, () => {
        let r = rng() * sum;
        for (let k = 0; k < names.length; k++) if ((r -= weight[k]) < 0) return names[k];
        return names[names.length - 1];
      });
    }
    const totals = playGame(types, opts, seed * 7 + g);
    const max = Math.max(...totals);
    const winners = totals.map((t, i) => (t === max ? i : -1)).filter((i) => i >= 0);
    const ranked = [...totals.keys()].sort((a, b) => totals[b] - totals[a]);
    // rank 1..N, ties share the average of their places
    const rankOf = new Array(N);
    for (let a = 0; a < N; ) {
      let b = a;
      while (b + 1 < N && totals[ranked[b + 1]] === totals[ranked[a]]) b++;
      for (let k = a; k <= b; k++) rankOf[ranked[k]] = (a + b) / 2 + 1;
      a = b + 1;
    }
    types.forEach((t, i) => {
      stat[t].seats++;
      stat[t].points += totals[i];
      stat[t].rank += rankOf[i];
    });
    winners.forEach((i) => (stat[types[i]].wins += 1 / winners.length));
    ranked.slice(0, 3).forEach((i) => stat[types[i]].top3++);
  }
  const seats = names.reduce((a, k) => a + stat[k].seats, 0);
  return names.map((k) => {
    const s = stat[k];
    return {
      type: k,
      label: BOT_TYPES[k].label,
      share: s.seats / seats,
      winIndex: s.seats ? s.wins / games / (s.seats / seats) : NaN, // 1 = wins as often as its share of seats
      top3Index: s.seats ? s.top3 / (3 * games) / (s.seats / seats) : NaN,
      perRound: s.seats ? s.points / s.seats / 5 : NaN,
      avgRank: s.seats ? s.rank / s.seats : NaN, // 1 = always first, N = always last
    };
  });
}

function report(rows) {
  const f = (x) => (isNaN(x) ? '   - ' : x.toFixed(2).padStart(5));
  console.log('戦略'.padEnd(10), '平均順位(30人中)  1ラウンド平均点  優勝指数   (優勝指数1.00 = 人数の割合どおりに優勝)');
  for (const r of [...rows].sort((a, b) => a.avgRank - b.avgRank))
    console.log(r.label.padEnd(10), r.avgRank.toFixed(1).padStart(8), '        ', r.perRound.toFixed(1).padStart(8), '      ', f(r.winIndex));
}

if (require.main === module) {
  const games = Number(process.argv[2] || 200);
  const mode = process.argv[3] || 'equal';
  console.log(`${games}ゲーム（30人・5ラウンド）、構成: ${mode === 'equal' ? '8種類を均等に' : 'ゲームごとにランダム'}`);
  report(tournament(DEFAULTS, { games, mode }));
}
/**
 * Average rank of each kind of player in a fixed population.
 * @param {Array<{key:string,type:string,opts?:object}>} roster one entry per player
 */
function rankBy(roster, opts, { games = 200, seed = 1 } = {}) {
  const N = roster.length;
  const stat = {};
  for (let g = 0; g < games; g++) {
    const totals = playGame(roster, opts, seed * 7919 + g);
    const ranked = [...totals.keys()].sort((a, b) => totals[b] - totals[a]);
    const rankOf = new Array(N);
    for (let a = 0; a < N; ) {
      let b = a;
      while (b + 1 < N && totals[ranked[b + 1]] === totals[ranked[a]]) b++;
      for (let k = a; k <= b; k++) rankOf[ranked[k]] = (a + b) / 2 + 1;
      a = b + 1;
    }
    roster.forEach((r, i) => {
      const s = (stat[r.key] ||= { n: 0, rank: 0, points: 0 });
      s.n++;
      s.rank += rankOf[i];
      s.points += totals[i];
    });
  }
  return Object.fromEntries(Object.entries(stat).map(([k, s]) => [k, { avgRank: s.rank / s.n, perRound: s.points / s.n / 5 }]));
}

module.exports = { tournament, report, playGame, rankBy };
