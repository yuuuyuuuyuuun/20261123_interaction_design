'use strict';
const assert = require('assert');
const { World } = require('../src/engine');
const { createBot, BOT_TYPES } = require('../src/bots');

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
// 流行は円の中の自由なマスを一色に変える
{
  const w = new World(4, { movement: 1, noise: 0, imitate: 0, movementRadius: [0.4, 0.4] }, 3);
  w.step();
  const ev = w.events[0];
  assert.ok(ev);
  for (let i = 0; i < w.size; i++) {
    let dx = Math.abs((i % w.cols) - ev.x);
    let dy = Math.abs(Math.floor(i / w.cols) - ev.y);
    dx = Math.min(dx, w.cols - dx);
    dy = Math.min(dy, w.rows - dy);
    if (dx * dx + dy * dy <= ev.radius * ev.radius) assert.equal(w.color[i], ev.color);
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
  const types = Object.keys(BOT_TYPES);
  const w = new World(types.length, {}, 6);
  let s = 1;
  const rng = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const bots = types.map((t) => createBot(t, rng, w.opts.ticks));
  while (!w.finished) {
    const view = { tick: w.tick, counts: w.counts() };
    bots.forEach((b, p) => b.act(view, { decl: w.decl[p] }, { predict: (c) => w.predict(p, c), invent: (c) => w.invent(p, c) }));
    w.step();
  }
  assert.ok(w.decl.every(Boolean));
}
console.log('engine tests passed');
