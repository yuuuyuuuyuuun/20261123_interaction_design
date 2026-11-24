'use strict';
// Balance simulation for 世界は、わたしたちでできている
// usage: node sim/simulate.js [rounds]

const { World } = require('../src/engine');

const ROUNDS = Number(process.argv[2] || 2000);

// ---------- bot strategies ----------
// each strategy: { name, act(world, i, ctx) } called once per tick before the world updates
function leaderOrNull(w) {
  const l = w.leader();
  return l < 0 ? null : l;
}
function localPlurality(w, i) {
  const c = new Array(w.opts.colors).fill(0);
  c[w.color[i]]++;
  for (const j of w.neighbors[i]) c[w.color[j]]++;
  return c.indexOf(Math.max(...c));
}

const STRATEGIES = {
  // 予言: 最初の多数派に賭けて変えない
  'predict:hold': (w, i, s) => {
    if (w.tick === 0) {
      const l = leaderOrNull(w);
      if (l !== null) w.predict(i, l);
    }
  },
  // 予言: 多数派が入れ替わるたびに乗り換える
  'predict:follow': (w, i) => {
    const l = leaderOrNull(w);
    if (l !== null && (!w.decl[i] || w.decl[i].color !== l)) w.predict(i, l);
  },
  // 予言: 様子を見て、各自のタイミング(序盤〜中盤)で多数派に賭け、以後は乗り換え
  'predict:wait': (w, i, s) => {
    if (w.tick < s.wait) return;
    const l = leaderOrNull(w);
    if (l !== null && (!w.decl[i] || w.decl[i].color !== l)) w.predict(i, l);
  },
  // 発明: 開始直後、今の多数派を発明
  'invent:leader': (w, i) => {
    if (w.tick === 0) {
      const l = leaderOrNull(w);
      w.invent(i, l === null ? w.color[i] : l);
    }
  },
  // 発明: 開始直後、自分の周囲で多い色を発明
  'invent:local': (w, i) => {
    if (w.tick === 0) w.invent(i, localPlurality(w, i));
  },
  // 発明: 開始直後、劣勢の色(現時点で最少)を発明して未来をひっくり返そうとする
  'invent:underdog': (w, i) => {
    if (w.tick === 0) {
      const c = w.counts();
      w.invent(i, c.indexOf(Math.min(...c)));
    }
  },
  // 予言で様子を見てから、各自のタイミングで多数派を発明
  'invent:late': (w, i, s) => {
    if (w.tick === s.wait) {
      const l = leaderOrNull(w);
      w.invent(i, l === null ? w.color[i] : l);
    } else if (w.tick < s.wait) {
      const l = leaderOrNull(w);
      if (l !== null && (!w.decl[i] || w.decl[i].color !== l)) w.predict(i, l);
    }
  },
};

function runRound(n, opts, strategyOf, seed) {
  const w = new World(n, opts, seed);
  const state = Array.from({ length: n }, () => ({
    wait: 3 + Math.floor(w.rng() * (opts.ticks / 3)),
  }));
  const leader0 = w.leader();
  let lastChange = 0;
  while (!w.finished) {
    for (let i = 0; i < n; i++) STRATEGIES[strategyOf[i]](w, i, state[i]);
    const before = w.color.join();
    w.step();
    if (w.color.join() !== before) lastChange = w.tick;
  }
  const r = w.result();
  return { w, r, leader0, lastChange };
}

function mean(a) {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
}
const pct = (x) => (isNaN(x) ? '  -  ' : (100 * x).toFixed(0).padStart(3) + '%');
const num = (x) => (isNaN(x) ? '  - ' : x.toFixed(1).padStart(5));

const LAWS = [
  { label: '決定的多数決 / 8近傍', law: 'majority', neighborhood: 'moore', rate: 1 },
  { label: '決定的多数決 / 4近傍', law: 'majority', neighborhood: 'vn', rate: 1 },
  { label: '確率的同調 β=3 / 8近傍', law: 'soft', softBeta: 3, neighborhood: 'moore', rate: 1 },
  { label: '模倣 rate=1 / 8近傍', law: 'voter', neighborhood: 'moore', rate: 1 },
  { label: '模倣 rate=auto(採用)', law: 'voter', neighborhood: 'moore', rate: 'auto' },
];

const N = Number(process.env.N || 30);
const BASE = { colors: 3, ticks: 60, torus: true };

console.log(`参加者 ${N} 人 / ${BASE.colors} 色 / 1ラウンド ${BASE.ticks} 更新 / 各条件 ${ROUNDS} ラウンド\n`);

// ---------- 1. 発明者がいない世界の性質 ----------
console.log('■ 1. 誰も発明しない世界（全員が予言者）');
console.log('法則'.padEnd(24), '最初の多数派=未来', '最後に世界が動いた時刻', '引き分け');
for (const L of LAWS) {
  const opts = { ...BASE, ...L };
  let same = 0;
  let ties = 0;
  const changes = [];
  for (let k = 0; k < ROUNDS; k++) {
    const { r, leader0, lastChange } = runRound(N, opts, new Array(N).fill('predict:follow'), k + 1);
    if (r.future < 0) ties++;
    else if (r.future === leader0) same++;
    changes.push(lastChange);
  }
  console.log(L.label.padEnd(24), pct(same / ROUNDS).padStart(14), num(mean(changes)).padStart(18), pct(ties / ROUNDS).padStart(8));
}

// ---------- 2. 発明の力: 劣勢の色を k 人が同時に発明したら未来は変わるか ----------
console.log('\n■ 2. 開始時に最も少ない色を k 人が発明したとき、その色が未来になる確率');
const KS = [0, 1, 2, 3, 4, 6, 8];
console.log('法則'.padEnd(24), KS.map((k) => `k=${k}`.padStart(5)).join(' '));
for (const L of LAWS) {
  const opts = { ...BASE, ...L };
  const row = [];
  for (const k of KS) {
    let win = 0;
    for (let s = 0; s < ROUNDS; s++) {
      const w = new World(N, opts, 100000 + s);
      const c = w.counts();
      const target = c.indexOf(Math.min(...c));
      // pick k random cells
      const idx = [...Array(N).keys()];
      for (let a = N - 1; a > 0; a--) {
        const b = Math.floor(w.rng() * (a + 1));
        [idx[a], idx[b]] = [idx[b], idx[a]];
      }
      for (let m = 0; m < k; m++) w.invent(idx[m], target);
      while (!w.finished) w.step();
      if (w.result().future === target) win++;
    }
    row.push(pct(win / ROUNDS).padStart(5));
  }
  console.log(L.label.padEnd(24), row.join(' '));
}

// ---------- 3. 混成集団での戦略ごとの平均得点 ----------
console.log('\n■ 3. 戦略がランダムに混ざった集団での平均得点（満点 = 60）と発明成功率');
const names = Object.keys(STRATEGIES);
for (const L of LAWS) {
  const opts = { ...BASE, ...L };
  const score = Object.fromEntries(names.map((s) => [s, []]));
  const invOk = [];
  for (let k = 0; k < ROUNDS; k++) {
    const seedRng = require('../src/engine').makeRng(500000 + k);
    const strat = Array.from({ length: N }, () => names[Math.floor(seedRng() * names.length)]);
    const { w, r } = runRound(N, opts, strat, 900000 + k);
    strat.forEach((s, i) => {
      score[s].push(r.scores[i]);
      if (w.decl[i] && w.decl[i].invented) invOk.push(r.future === w.decl[i].color ? 1 : 0);
    });
  }
  console.log(`\n  [${L.label}]  発明成功率 ${pct(mean(invOk))}`);
  names
    .map((s) => [s, mean(score[s])])
    .sort((a, b) => b[1] - a[1])
    .forEach(([s, v]) => console.log('   ', s.padEnd(18), num(v)));
}
