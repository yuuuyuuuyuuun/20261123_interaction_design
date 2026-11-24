'use strict';
// Fits the bots' win-probability model (src/odds-model.json) from simulated rounds.
// Re-run this whenever the laws of the world change.  usage: node sim/fit-odds.js [rounds]
const fs = require('fs');
const path = require('path');
const { World, DEFAULTS, makeRng } = require('../src/engine');
const { observe, localCounts, features, binOf, softmax } = require('../src/odds');

const ROUNDS = Number(process.argv[2] || 3000);
// (simulation only) FIT_OPTS='{"movement":0.1}' fits for other laws, OUT=path writes elsewhere
const OPTS = { ...DEFAULTS, ...JSON.parse(process.env.FIT_OPTS || '{}') };
const EDGES = [0, 3, 6, 10, 15, 20, 25, 30, 40, 50, 1000]; // bins of "updates remaining"

// Inventors are what shapes the world (predictions have no effect on it), so training
// populations vary how many players invent, when, and which color.
function simulate(seed) {
  const rng = makeRng(seed);
  const N = 8 + Math.floor(rng() * 33);
  const w = new World(N, OPTS, seed * 7 + 1);
  const q = rng() * 0.7;
  const plans = Array.from({ length: N }, () => {
    if (rng() >= q) return null;
    const kind = rng();
    const how = kind < 0.4 ? 'leader' : kind < 0.7 ? 'local' : kind < 0.85 ? 'leader' : 'contrarian';
    return { at: kind < 0.4 || kind >= 0.85 ? 1 + Math.floor(rng() * 3) : Math.floor(rng() * 40), how };
  });
  const samples = [];
  while (!w.finished) {
    const view = observe(w);
    samples.push(view);
    plans.forEach((pl, p) => {
      if (!pl || w.tick !== pl.at) return;
      const c = pl.how === 'local' ? localCounts(w, w.playerCell[p]) : view.counts;
      w.invent(p, pl.how === 'contrarian' ? c.indexOf(Math.min(...c)) : c.indexOf(Math.max(...c)));
    });
    w.step();
  }
  const future = w.leader();
  return future < 0 ? [] : samples.map((v) => ({ v, y: future }));
}

const byBin = EDGES.slice(0, -1).map(() => []);
for (let r = 0; r < ROUNDS; r++)
  for (const s of simulate(1000 + r)) {
    const F = [0, 1, 2].map((c) => features(s.v, c));
    byBin[binOf(s.v.remaining, EDGES)].push({ F, y: s.y });
  }

// multinomial logistic regression with weights shared across colors, per bin (Adam)
function fit(data) {
  let w = [5, 5, 5];
  const m = [0, 0, 0];
  const v = [0, 0, 0];
  const lr = 0.5;
  for (let it = 1; it <= 600; it++) {
    const g = [0, 0, 0];
    for (const { F, y } of data) {
      const p = softmax(F.map((f) => f[0] * w[0] + f[1] * w[1] + f[2] * w[2]));
      for (let c = 0; c < 3; c++) {
        const d = p[c] - (c === y ? 1 : 0);
        for (let k = 0; k < 3; k++) g[k] += (d * F[c][k]) / data.length;
      }
    }
    for (let k = 0; k < 3; k++) {
      m[k] = 0.9 * m[k] + 0.1 * g[k];
      v[k] = 0.999 * v[k] + 0.001 * g[k] * g[k];
      const mh = m[k] / (1 - 0.9 ** it);
      const vh = v[k] / (1 - 0.999 ** it);
      w[k] -= (lr * mh) / (Math.sqrt(vh) + 1e-8);
    }
  }
  let ll = 0;
  let acc = 0;
  for (const { F, y } of data) {
    const p = softmax(F.map((f) => f[0] * w[0] + f[1] * w[1] + f[2] * w[2]));
    ll -= Math.log(Math.max(1e-9, p[y]));
    if (p.indexOf(Math.max(...p)) === y) acc++;
  }
  return { w: w.map((x) => Number(x.toFixed(3))), ll: ll / data.length, acc: acc / data.length };
}

const weights = [];
console.log('残りターン   サンプル  重み[割合, 発明者, カリスマ]          正答率  対数損失(ランダムなら1.10)');
byBin.forEach((data, b) => {
  const r = fit(data);
  weights.push(r.w);
  console.log(
    `${String(EDGES[b]).padStart(3)}-${String(EDGES[b + 1] - 1).padEnd(4)} ${String(data.length).padStart(8)}  ${JSON.stringify(r.w).padEnd(30)} ${(100 * r.acc).toFixed(0).padStart(4)}%  ${r.ll.toFixed(3)}`
  );
});

const out = process.env.OUT ? path.resolve(process.env.OUT) : path.join(__dirname, '..', 'src', 'odds-model.json');
fs.writeFileSync(out, JSON.stringify({ edges: EDGES, weights, rounds: ROUNDS }, null, 2) + '\n');
console.log('saved', path.relative(process.cwd(), out));
