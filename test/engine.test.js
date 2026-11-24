'use strict';
const assert = require('assert');
const { World } = require('../src/engine');
const { createBot, BOT_TYPES } = require('../src/bots');
const { observe, localCounts, winProbs } = require('../src/odds');

const disc = (w, ev) => {
  const inside = [];
  for (let i = 0; i < w.size; i++) {
    let dx = Math.abs((i % w.cols) - ev.x);
    let dy = Math.abs(Math.floor(i / w.cols) - ev.y);
    dx = Math.min(dx, w.cols - dx);
    dy = Math.min(dy, w.rows - dy);
    if (dx * dx + dy * dy <= ev.radius * ev.radius) inside.push(i);
  }
  return inside;
};

// 盤面は人数の数倍の完全な長方形で、プレイヤーは別々のマスにいる
{
  const w = new World(30, {}, 1);
  assert.equal(w.size, w.cols * w.rows);
  assert.ok(w.size >= 30 * 10);
  assert.equal(new Set(w.playerCell).size, 30);
  assert.ok(w.neighbors.every((nb) => nb.length === 8)); // torus: everyone has 8 neighbors
}
// 発明したマスは、同調・気まぐれ・ムーブメント・カリスマのどれでも変わらない
{
  const w = new World(10, { ticks: 40, noise: 0.5, movement: 1, movementRamp: [0, 0], charisma: 1, quietFrom: 1 }, 2);
  assert.ok(w.invent(0, 2));
  w.invent(1, 0);
  assert.equal(w.predict(0, 1), false);
  assert.equal(w.invent(0, 1), false);
  const cell = w.playerCell[0];
  while (!w.finished) {
    w.step();
    assert.equal(w.color[cell], 2);
  }
}
// ムーブメント: 負けている色だけが選ばれ、円の中の自由なマスが一度に塗られる
{
  for (let seed = 1; seed <= 30; seed++) {
    const w = new World(4, { movement: 1, movementRamp: [0, 0], charisma: 0, noise: 0, imitate: 0 }, seed);
    const before = w.counts();
    w.step();
    const ev = w.events.find((e) => e.kind === 'movement');
    assert.ok(ev);
    const max = Math.max(...before);
    if (before.filter((v) => v === max).length === 1) assert.ok(before[ev.color] < max, 'the leader never gets a movement');
    for (const i of disc(w, ev)) if (!w.fixed[i]) assert.equal(w.color[i], ev.color);
  }
}
// カリスマ: 負けている色の発明者だけに宿り、周りを強く染める
{
  const w = new World(2, { charisma: 1, charismaTurns: [5, 5], movement: 0, noise: 0, quietFrom: 1 }, 3);
  w.color.fill(1); // everyone is blue
  w.invent(0, 0); // a red inventor: red is behind
  w.invent(1, 1); // a blue inventor: blue leads, never gets it
  w.step();
  assert.equal(w.charismas.length, 1);
  assert.equal(w.charismas[0].player, 0);
  for (let t = 0; t < 4; t++) w.step();
  const around = localCounts(w, w.playerCell[0]);
  assert.ok(around[0] >= 6, `the people around a charisma turn its color (${around})`);
}
// 終盤（最後の15%）は、ムーブメントもカリスマも新しく始まらない
{
  const w = new World(4, { ticks: 60, movement: 1, movementRamp: [0, 0], charisma: 1 }, 9);
  w.invent(0, 0);
  for (let t = 0; t < 60; t++) {
    w.step();
    if (w.tick > 51) assert.equal(w.events.length, 0);
  }
}
// 予言は何度でも変えられ、得点は最後の宣言時点の残りターン
{
  const w = new World(3, { ticks: 20, noise: 0, imitate: 0, movement: 0, charisma: 0 }, 4);
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
  const w = new World(2, { ticks: 1, noise: 0, imitate: 0, movement: 0, charisma: 0, minCells: 9 }, 5);
  w.color = [0, 0, 0, 1, 1, 1, 2, 2, 2];
  w.predict(0, 0);
  w.step();
  assert.equal(w.result().future, -1);
  assert.deepEqual(w.result().scores, [0, 0]);
  assert.equal(w.predict(1, 0), false);
}
// どの種類のボットも最後まで遊べる
{
  const types = Object.keys(BOT_TYPES);
  const w = new World(types.length, {}, 6);
  let s = 1;
  const rng = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const bots = types.map((t) => createBot(t, rng, w.opts.ticks));
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
  assert.ok(w.decl.filter(Boolean).length >= types.length - 1);
}
// 勝率モデル: 確率の合計は1、終盤は大差の多数派がほぼ勝つ
{
  const view = { tick: 58, ticks: 60, remaining: 2, size: 100, counts: [60, 25, 15], fixed: [0, 0, 0], spell: [0, 0, 0] };
  const p = winProbs(view);
  assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.ok(p[0] > 0.9);
}
// 期待値予言: 乗り換えると得点がリセットされるので、わずかな不利では乗り換えない
{
  const bot = createBot('predict', () => 0.99, 60); // reaction 3, patience 2
  const calls = [];
  const api = { predict: (c) => calls.push(c), invent: () => calls.push('inv') };
  const view = (tick, counts) => ({ tick, ticks: 60, remaining: 60 - tick, size: 100, counts, fixed: [0, 0, 0], spell: [0, 0, 0] });
  bot.act(view(3, [40, 35, 25]), { decl: null }, api);
  assert.deepEqual(calls, [0]);
  for (let t = 20; t < 25; t++) bot.act(view(t, [36, 38, 26]), { decl: { color: 0, tick: 3 } }, api);
  assert.deepEqual(calls, [0], 'a slightly better color is not worth restarting the points');
  for (let t = 40; t < 45; t++) bot.act(view(t, [10, 80, 10]), { decl: { color: 0, tick: 3 } }, api);
  assert.equal(calls[calls.length - 1], 1, 'a hopeless prediction is abandoned');
}
console.log('engine tests passed');
