'use strict';
// 塊の定着率: 敵の色(青)一色の盤面の中央に赤の塊を置き、20ターン後に赤の領域が残り育つか。
// usage: node sim/nucleation.js  (既定値)  /  require('./nucleation').nucleation(opts)
const { World, DEFAULTS } = require('../src/engine');

const SHAPES = {
  1: [[0, 0]],
  2: [[0, 0], [1, 0]],
  3: [[0, 0], [1, 0], [0, 1]],
  4: [[0, 0], [1, 0], [0, 1], [1, 1]],
  5: [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0]],
  6: [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [-1, 1]],
};

/** returns P(region of >= 20 red cells in the 9x9 window after `T` updates) */
function trial(opts, s, mode, seed, T = 20) {
  const w = new World(1, { ...opts, movement: 0, charisma: 0 }, seed);
  w.color.fill(1);
  const cx = Math.floor(w.cols / 2);
  const cy = Math.floor(w.rows / 2);
  const cells = SHAPES[s].map(([dx, dy]) => (cy + dy) * w.cols + cx + dx);
  cells.forEach((i, k) => {
    w.color[i] = 0;
    if (mode === 'all' || (mode === 'one' && k === 0)) w.fixed[i] = true;
  });
  for (let t = 0; t < T; t++) w.step();
  let red = 0;
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if (w.color[(cy + dy) * w.cols + cx + dx] === 0) red++;
  return red >= 20;
}

function nucleation(opts, R = 300) {
  const out = {};
  for (const mode of ['free', 'one', 'all']) {
    out[mode] = {};
    for (const s of [1, 2, 3, 4, 5, 6]) {
      let ok = 0;
      for (let r = 0; r < R; r++) if (trial(opts, s, mode, 1 + r)) ok++;
      out[mode][s] = ok / R;
    }
  }
  return out;
}

const fmt = (o) => [1, 2, 3, 4, 5, 6].map((s) => ((100 * o[s]).toFixed(0) + '%').padStart(5)).join('');

if (require.main === module) {
  const n = nucleation(DEFAULTS);
  console.log('塊の大きさ           1    2    3    4    5    6');
  console.log('流されるマスだけ ', fmt(n.free));
  console.log('中心1つが発明者  ', fmt(n.one));
  console.log('全員が発明者     ', fmt(n.all));
}
module.exports = { nucleation, fmt };
