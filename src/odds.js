'use strict';

// Win-probability model used by the bots: "if the round ended from here, how likely is each
// color to become the future?" It looks only at what every player can see on the board:
//   share    — the color's share of the world
//   fixed    — the share of inventors fixed to that color
//   spell    — how much of the world is under the spell of that color's charismas
// The weights per "updates remaining" bin are fitted from simulations (sim/fit-odds.js).

let MODEL = null;
try {
  MODEL = require('./odds-model.json');
} catch {
  MODEL = null; // not fitted yet: fall back to "the leader wins"
}

/** what a player sees, from a World instance or a snapshot sent to the browser */
function observe(src) {
  const color = src.color;
  const size = color.length;
  const colors = src.opts?.colors || src.colors || 3;
  const counts = new Array(colors).fill(0);
  const fixed = new Array(colors).fill(0);
  const spell = new Array(colors).fill(0);
  for (const v of color) counts[v]++;
  if (Array.isArray(src.fixedCells)) for (const i of src.fixedCells) fixed[color[i]]++;
  else if (src.fixed) src.fixed.forEach((f, i) => f && fixed[color[i]]++);
  const R = src.opts?.charismaRadius;
  for (const c of src.charismas || []) {
    const r = c.radius ?? R;
    spell[c.color] += (2 * r + 1) ** 2 / size;
  }
  const ticks = src.opts?.ticks ?? src.ticks;
  return { tick: src.tick, ticks, remaining: ticks - src.tick, size, counts, fixed, spell };
}

/** colors among a cell and its 8 neighbors */
function localCounts(src, cell) {
  const cols = src.cols;
  const rows = src.rows;
  const colors = src.opts?.colors || src.colors || 3;
  const c = new Array(colors).fill(0);
  const x0 = cell % cols;
  const y0 = (cell / cols) | 0;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) c[src.color[((y0 + dy + rows) % rows) * cols + ((x0 + dx + cols) % cols)]]++;
  return c;
}

function features(view, c) {
  return [view.counts[c] / view.size, view.fixed[c] / view.size, Math.min(1, view.spell[c])];
}

function binOf(remaining, edges) {
  let b = 0;
  while (b + 1 < edges.length - 1 && remaining >= edges[b + 1]) b++;
  return b;
}

function softmax(scores) {
  const m = Math.max(...scores);
  const e = scores.map((s) => Math.exp(s - m));
  const z = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / z);
}

/** probability of each color being the future */
function winProbs(view, model = MODEL) {
  const C = view.counts.length;
  if (!model) {
    const max = Math.max(...view.counts);
    const lead = view.counts.map((v) => (v === max ? 1 : 0));
    const n = lead.reduce((a, b) => a + b, 0);
    return lead.map((x) => x / n);
  }
  const w = model.weights[binOf(view.remaining, model.edges)];
  const scores = [];
  for (let c = 0; c < C; c++) {
    const f = features(view, c);
    scores.push(f[0] * w[0] + f[1] * w[1] + f[2] * w[2]);
  }
  return softmax(scores);
}

module.exports = { observe, localCounts, features, winProbs, binOf, softmax, hasModel: () => Boolean(MODEL) };
