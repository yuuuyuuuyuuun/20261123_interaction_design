'use strict';
// 発明者の割合を変えたとき、予言と発明のどちらが得か
const { World, makeRng } = require('../src/engine');
const ROUNDS = Number(process.argv[2] || 1000);
const N = Number(process.env.N || 30);

function localPlurality(w, i) {
  const c = new Array(w.opts.colors).fill(0);
  c[w.color[i]]++;
  for (const j of w.neighbors[i]) c[w.color[j]]++;
  return c.indexOf(Math.max(...c));
}
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const f = (x) => (isNaN(x) ? '   - ' : x.toFixed(1).padStart(5));

const LAWS = [
  ['模倣 rate=1.0', { law: 'voter', rate: 1 }],
  ['模倣 rate=0.5', { law: 'voter', rate: 0.5 }],
  ['模倣 rate=0.3', { law: 'voter', rate: 0.3 }],
  ['多数決 8近傍', { law: 'majority' }],
];
// inventors: at their own moment in [0, ticks/3), invent the color they think best
//   'leader' = current world plurality, 'local' = own neighborhood plurality
// predictors: from their own moment, follow the current leader (switching when it changes)
const QS = [0, 0.1, 0.2, 0.3, 0.5, 0.8];

for (const [label, L] of LAWS) {
  const opts = { colors: 3, ticks: 60, torus: true, neighborhood: 'moore', ...L };
  console.log(`\n[${label}]  人数${N}  発明者の割合ごとの平均得点（満点60）`);
  console.log('発明者割合  予言者  発明者  発明成功率  単独発明の成功率(他に発明者0)');
  for (const q of QS) {
    const P = [], I = [], ok = [];
    for (let r = 0; r < ROUNDS; r++) {
      const w = new World(N, opts, 7000 + r * 13 + Math.round(q * 1000));
      const rng = makeRng(31337 + r);
      const role = Array.from({ length: N }, () => (rng() < q ? 'I' : 'P'));
      const when = Array.from({ length: N }, () => Math.floor(rng() * (opts.ticks / 3)));
      const how = Array.from({ length: N }, () => (rng() < 0.5 ? 'leader' : 'local'));
      while (!w.finished) {
        const l = w.leader();
        for (let i = 0; i < N; i++) {
          if (w.tick < when[i]) continue;
          if (role[i] === 'I') {
            if (!w.fixed[i]) w.invent(i, how[i] === 'leader' && l >= 0 ? l : localPlurality(w, i));
          } else if (l >= 0 && (!w.decl[i] || w.decl[i].color !== l)) w.predict(i, l);
        }
        w.step();
      }
      const res = w.result();
      for (let i = 0; i < N; i++) {
        (role[i] === 'I' ? I : P).push(res.scores[i]);
        if (role[i] === 'I') ok.push(res.future === w.decl[i].color ? 1 : 0);
      }
    }
    console.log(`${(q * 100).toFixed(0).padStart(6)}%    ${f(mean(P))}   ${f(mean(I))}   ${isNaN(mean(ok)) ? '  -' : (mean(ok) * 100).toFixed(0).padStart(4) + '%'}`);
  }
  // lone inventor of a random color at t=0, everyone else predicts
  let lone = 0;
  for (let r = 0; r < ROUNDS; r++) {
    const w = new World(N, opts, 99000 + r);
    w.invent(0, Math.floor(w.rng() * 3));
    while (!w.finished) w.step();
    if (w.result().future === w.decl[0].color) lone++;
  }
  console.log(`  一人だけがランダムな色を開始時に発明 → 成功率 ${(100 * lone / ROUNDS).toFixed(0)}%（ランダムな予言なら33%）`);
}
