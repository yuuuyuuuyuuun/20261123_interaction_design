'use strict';
// 発明は得か？ 同じ盤面から「発明する世界」と「予言する世界」を同じ乱数で分岐させ、
// 最後まで進めてその人の得点差を測る。
// 判断の場面: (a) 最初の宣言  (b) 期待値予言が乗り換えを決めたとき
// usage: node sim/invent-value.js [rounds]
const { World, DEFAULTS, makeRng } = require('../src/engine');
const { BOT_TYPES, createBot } = require('../src/bots');
const { observe, localCounts, winProbs } = require('../src/odds');

const R = Number(process.argv[2] || 600);
const OPTS = { ...DEFAULTS, ...JSON.parse(process.env.OPTS || '{}') };
const NAMES = Object.keys(BOT_TYPES);
const N = 30;
const FOCAL = 0; // the player whose choice we test (an 期待値予言 bot)
// UNDERDOG=1: at the first declaration, compare "invent the most promising trailing color"
// with "predict the best color" (what 期待値予言 does)
const UNDERDOG = Boolean(process.env.UNDERDOG);

function bots(types, seed, ticks) {
  const rng = makeRng(seed);
  return types.map((t) => createBot(t, rng, ticks));
}

function stepAll(w, brains, skip) {
  const view = observe(w);
  brains.forEach((b, p) => {
    if (p === skip) return;
    const cell = w.playerCell[p];
    b.act(view, { decl: w.decl[p], local: localCounts(w, cell), color: w.color[cell] }, {
      predict: (c) => w.predict(p, c),
      invent: (c) => w.invent(p, c),
    });
  });
  w.step();
}

/** plays a branch to the end; the focal player either invented (does nothing more) or keeps predicting by value */
function finish(w, types, seed, focalPredicts) {
  const brains = bots(types, seed, w.opts.ticks);
  const focal = createBot('predict', makeRng(seed + 1), w.opts.ticks);
  while (!w.finished) {
    if (focalPredicts) {
      const cell = w.playerCell[FOCAL];
      focal.act(observe(w), { decl: w.decl[FOCAL], local: localCounts(w, cell), color: w.color[cell] }, {
        predict: (c) => w.predict(FOCAL, c),
        invent: () => {},
      });
    }
    stepAll(w, brains, FOCAL);
  }
  const scores = w.result().scores;
  // rank of the focal player among everyone in this round (1 = best, ties share)
  const better = scores.filter((x) => x > scores[FOCAL]).length;
  const equal = scores.filter((x) => x === scores[FOCAL]).length;
  return { score: scores[FOCAL], rank: better + (equal + 1) / 2 };
}

const rows = [];
for (let r = 0; r < R; r++) {
  for (const want of UNDERDOG ? ['first'] : ['first', 'switch']) {
    const types = Array.from({ length: N }, (_, i) => (i === FOCAL ? 'predict' : NAMES[(i + r) % NAMES.length]));
    const w = new World(N, OPTS, 1000 + r);
    const brains = bots(types, 2000 + r, w.opts.ticks);
    // the focal player is driven by an 期待値予言 brain; we intercept the declaration we test
    let decision = null;
    const focal = createBot('predict', makeRng(3000 + r), w.opts.ticks);
    while (!w.finished && !decision) {
      const view = observe(w);
      const cell = w.playerCell[FOCAL];
      const before = w.decl[FOCAL];
      focal.act(view, { decl: before, local: localCounts(w, cell), color: w.color[cell] }, {
        predict: (c) => {
          const kind = before ? 'switch' : 'first';
          if (kind === want) decision = { kind, color: c };
          else w.predict(FOCAL, c);
        },
        invent: () => {},
      });
      if (decision) {
        const p = winProbs(view);
        const local = localCounts(w, cell);
        local[w.color[cell]]--;
        const max = Math.max(...view.counts);
        if (UNDERDOG) {
          const behind = [...p.keys()].filter((c) => view.counts[c] < max);
          decision.inventColor = behind.length ? behind.reduce((b, c) => (p[c] > p[b] ? c : b), behind[0]) : decision.color;
        }
        decision.features = {
          tick: w.tick,
          totalInventors: view.fixed.reduce((a, b) => a + b, 0),
          pInvent: p[decision.inventColor ?? decision.color],
          p: p[decision.color],
          allies: local[decision.color],
          trailing: view.counts[decision.color] < max,
          inventors: view.fixed[decision.color],
        };
        break;
      }
      stepAll(w, brains, FOCAL);
    }
    if (!decision) continue;
    const seed = 5000 + r * 2 + (want === 'switch' ? 1 : 0);
    const a = w.clone(seed);
    a.invent(FOCAL, decision.inventColor ?? decision.color);
    const b = w.clone(seed);
    b.predict(FOCAL, decision.color);
    const inv = finish(a, types, seed, false);
    const pred = finish(b, types, seed, true);
    rows.push({ ...decision.features, kind: decision.kind, delta: inv.score - pred.score, drank: pred.rank - inv.rank });
  }
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const show = (label, sel) => {
  const sel2 = rows.filter(sel);
  const d = sel2.map((x) => x.delta);
  const dr = sel2.map((x) => x.drank);
  console.log(`${label.padEnd(30)} n=${String(d.length).padStart(4)}  得点: 発明−予言 ${mean(d).toFixed(2).padStart(6)}点   順位: 発明で ${mean(dr).toFixed(2).padStart(6)} 位上がる`);
};
console.log(`1ラウンド ${OPTS.ticks} ターン、${rows.length} 回の分岐${UNDERDOG ? '（発明する側は2番手の色、予言する側は最有力の色）' : ''}`);
if (UNDERDOG) {
  show('すべて', () => true);
  show('その時点の発明者 0人', (x) => x.totalInventors === 0);
  show('その時点の発明者 1〜2人', (x) => x.totalInventors >= 1 && x.totalInventors <= 2);
  show('その時点の発明者 3〜5人', (x) => x.totalInventors >= 3 && x.totalInventors <= 5);
  show('その時点の発明者 6人以上', (x) => x.totalInventors >= 6);
  show('2番手の勝率 0.3未満', (x) => x.pInvent < 0.3);
  show('2番手の勝率 0.3〜0.4', (x) => x.pInvent >= 0.3 && x.pInvent < 0.4);
  show('2番手の勝率 0.4以上', (x) => x.pInvent >= 0.4);
  process.exit(0);
}
show('すべて', () => true);
show('(a) 最初の宣言', (x) => x.kind === 'first');
show('(b) 乗り換え', (x) => x.kind === 'switch');
for (const kind of ['first', 'switch']) {
  const K = kind === 'first' ? '(a)' : '(b)';
  show(`${K} 負けている色`, (x) => x.kind === kind && x.trailing);
  show(`${K} 勝っている色`, (x) => x.kind === kind && !x.trailing);
  show(`${K} 周りに仲間 0〜1人`, (x) => x.kind === kind && x.allies <= 1);
  show(`${K} 周りに仲間 2〜3人`, (x) => x.kind === kind && x.allies >= 2 && x.allies <= 3);
  show(`${K} 周りに仲間 4人以上`, (x) => x.kind === kind && x.allies >= 4);
  show(`${K} 勝率 0.4未満`, (x) => x.kind === kind && x.p < 0.4);
  show(`${K} 勝率 0.4〜0.6`, (x) => x.kind === kind && x.p >= 0.4 && x.p < 0.6);
  show(`${K} 勝率 0.6以上`, (x) => x.kind === kind && x.p >= 0.6);
  if (kind === 'switch') {
    show(`${K} 序盤 (〜1/3)`, (x) => x.kind === kind && x.tick < OPTS.ticks / 3);
    show(`${K} 中盤 (1/3〜2/3)`, (x) => x.kind === kind && x.tick >= OPTS.ticks / 3 && x.tick < (2 * OPTS.ticks) / 3);
    show(`${K} 終盤 (2/3〜)`, (x) => x.kind === kind && x.tick >= (2 * OPTS.ticks) / 3);
  }
}
if (process.env.DUMP) require('fs').writeFileSync(process.env.DUMP, JSON.stringify(rows));
module.exports = {};
