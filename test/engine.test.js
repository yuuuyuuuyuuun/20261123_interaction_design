'use strict';
const assert = require('assert');
const { World } = require('../src/engine');

// 発明したマスは二度と変わらず、宣言も変えられない
{
  const w = new World(25, { ticks: 30 }, 1);
  assert.ok(w.invent(0, 2));
  assert.equal(w.predict(0, 1), false);
  assert.equal(w.invent(0, 1), false);
  while (!w.finished) { w.step(); assert.equal(w.color[0], 2); }
}
// 予言は何度でも変えられ、得点は最後の宣言時点の残り時間
{
  const w = new World(16, { ticks: 20 }, 2);
  w.predict(3, 0);
  for (let t = 0; t < 5; t++) w.step();
  const r0 = w.leader();
  // 全員を同じ色で発明させて未来を確定させる
  for (let i = 0; i < 16; i++) if (i !== 3) w.invent(i, 1);
  w.predict(3, 1);
  while (!w.finished) w.step();
  const r = w.result();
  assert.equal(r.future, 1);
  assert.equal(r.scores[3], 20 - 5);
  assert.equal(r.scores[0], 20 - 5);
}
// 引き分けなら全員0点
{
  const w = new World(2, { ticks: 3 }, 3);
  w.invent(0, 0); w.invent(1, 1);
  while (!w.finished) w.step();
  const r = w.result();
  assert.equal(r.future, -1);
  assert.deepEqual(r.scores, [0, 0]);
}
// 終了後は宣言できない
{
  const w = new World(4, { ticks: 1 }, 4);
  w.step();
  assert.equal(w.predict(0, 0), false);
}
console.log('engine tests passed');
