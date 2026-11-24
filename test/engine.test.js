'use strict';
const assert = require('assert');
const { World } = require('../src/engine');
const { createBot, BOT_TYPES, HIDDEN_TYPES } = require('../src/bots');
const { observe, winProbs } = require('../src/odds');

// 盤面は人数の数倍の完全な長方形で、プレイヤーは別々のマスにいる
{
  const w = new World(30, {}, 1);
  assert.equal(w.size, w.cols * w.rows);
  assert.ok(w.size >= 30 * 10);
  assert.equal(new Set(w.playerCell).size, 30);
  assert.ok(w.neighbors.every((nb) => nb.length === 8)); // torus: everyone has 8 neighbors
}
// 発明したマスは、同調・気まぐれ・流行のどれでも変わらない
{
  const w = new World(10, { ticks: 40, noise: 0.5, movement: 1 }, 2);
  assert.ok(w.invent(0, 2));
  assert.equal(w.predict(0, 1), false);
  assert.equal(w.invent(0, 1), false);
  const cell = w.playerCell[0];
  while (!w.finished) {
    w.step();
    assert.equal(w.color[cell], 2);
  }
}
// ムーブメント: 劣勢の色だけが選ばれ、円の中の自由なマスはその色で一定ターン立ち止まる
{
  let checked = 0;
  for (let seed = 1; seed < 200 && checked < 20; seed++) {
    const w = new World(4, { movement: 1, movementRamp: [0, 0], noise: 0.3, movementRadius: [0.3, 0.3], movementHold: [4, 4] }, seed);
    const before = w.counts();
    w.step();
    const ev = w.events[0];
    assert.ok(ev);
    const max = Math.max(...before);
    if (before.filter((v) => v === max).length === 1) assert.ok(before[ev.color] < max, 'leader never gets a movement');
    const inside = [];
    for (let i = 0; i < w.size; i++) {
      let dx = Math.abs((i % w.cols) - ev.x);
      let dy = Math.abs(Math.floor(i / w.cols) - ev.y);
      dx = Math.min(dx, w.cols - dx);
      dy = Math.min(dy, w.rows - dy);
      if (dx * dx + dy * dy <= ev.radius * ev.radius) inside.push(i);
    }
    w.opts.movement = 0;
    for (let t = 0; t < 4; t++) {
      for (const i of inside) assert.equal(w.color[i], ev.color);
      w.step();
    }
    checked++;
  }
  // no movement in the first 15% of a round
  const w = new World(4, { movement: 1, ticks: 60 }, 9);
  for (let t = 0; t < 9; t++) {
    w.step();
    assert.equal(w.events.length, 0);
  }
}
// 予言は何度でも変えられ、得点は最後の宣言時点の残りターン
{
  const w = new World(3, { ticks: 20, noise: 0, imitate: 0, movement: 0 }, 4);
  w.color.fill(1);
  w.predict(0, 0);
  for (let t = 0; t < 5; t++) w.step();
  w.predict(0, 1);
  w.invent(1, 1);
  while (!w.finished) w.step();
  const r = w.result();
  assert.equal(r.future, 1);
  assert.deepEqual(r.scores, [15, 15, 0]);
}
// 引き分けなら全員0点、終了後は宣言できない
{
  const w = new World(2, { ticks: 1, noise: 0, imitate: 0, movement: 0, minCells: 9 }, 5);
  w.color = [0, 0, 0, 1, 1, 1, 2, 2, 2];
  w.predict(0, 0);
  w.step();
  assert.equal(w.result().future, -1);
  assert.deepEqual(w.result().scores, [0, 0]);
  assert.equal(w.predict(1, 0), false);
}
// どの種類のボットも最後まで遊べる
{
  const types = [...Object.keys(BOT_TYPES), ...Object.keys(HIDDEN_TYPES)];
  const w = new World(types.length, {}, 6);
  let s = 1;
  const rng = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const bots = types.map((t) => createBot(t, rng, w.opts.ticks));
  while (!w.finished) {
    const view = observe(w);
    bots.forEach((b, p) => b.act(view, { decl: w.decl[p] }, { predict: (c) => w.predict(p, c), invent: (c) => w.invent(p, c) }));
    w.step();
  }
  assert.ok(w.decl.every(Boolean));
}
// 勝率モデル: 確率の合計は1、終盤は大差の多数派がほぼ勝つ
{
  const view = { tick: 58, ticks: 60, remaining: 2, size: 100, counts: [60, 25, 15], fixed: [0, 0, 0], wave: [0, 0, 0] };
  const p = winProbs(view);
  assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.ok(p[0] > 0.9);
}
// 期待値予言: 乗り換えると得点がリセットされるので、わずかな不利では乗り換えない
{
  const bot = createBot('predict', () => 0.99, 60); // reaction 3, patience 2
  const calls = [];
  const api = { predict: (c) => calls.push(c), invent: () => calls.push('inv') };
  const view = (tick, counts) => ({ tick, ticks: 60, remaining: 60 - tick, size: 100, counts, fixed: [0, 0, 0], wave: [0, 0, 0] });
  bot.act(view(3, [40, 35, 25]), { decl: null }, api);
  assert.deepEqual(calls, [0]);
  for (let t = 20; t < 25; t++) bot.act(view(t, [36, 38, 26]), { decl: { color: 0, tick: 3 } }, api);
  assert.deepEqual(calls, [0], 'a slightly better color is not worth restarting the points');
  for (let t = 40; t < 45; t++) bot.act(view(t, [20, 60, 20]), { decl: { color: 0, tick: 3 } }, api);
  assert.equal(calls[calls.length - 1], 1, 'a hopeless prediction is abandoned');
}
console.log('engine tests passed');
