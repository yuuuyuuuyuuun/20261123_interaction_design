'use strict';

// Bot players. Shared by the game server and the simulations so that what we
// measure is exactly what plays in class. Bots react with a human-like delay and
// judge the board with the win-probability model in ./odds.js.

const { winProbs } = require('./odds');

const BOT_TYPES = {
  predict: {
    label: '期待値予言',
    short: '期待',
    desc: '勝率×得点で判断。乗り換えると得点が減るので、少し不利でも粘ることがある',
  },
  follow: { label: '追従予言', short: '追従', desc: '多数派を予言し、多数派が入れ替わるたびに乗り換える' },
  whim: { label: '気まぐれ予言', short: '気分', desc: '好きな色を予言し、ときどき気が変わる' },
  mixed: {
    label: '予言→発明',
    short: '混成',
    desc: '勝ちそうな色がはっきりしていれば最初から発明し、そうでなければ予言する。乗り換えるときは発明で乗り換える',
  },
  inventEarly: { label: '早期発明', short: '早発', desc: '開始直後に、勝ちそうな色を発明する' },
  local: { label: '地元発明', short: '地元', desc: '自分の周りに仲間が3人以上いる色を、その場で発明する' },
  inventLate: { label: '機を見て発明', short: '機発', desc: '何も宣言せずに様子を見て、途中で勝ちそうな色を発明する' },
  bandwagon: { label: '勝ち馬発明', short: '勝馬', desc: '何も宣言せずに様子を見て、勝率が60%を超えた色を発明する' },
  contrarian: { label: '逆張り発明', short: '逆張', desc: '開始直後に、最も少ない色を発明する' },
};
const HIDDEN_TYPES = {};

const SWITCH_MARGIN = 1.1; // switch only when clearly better: estimates are noisy

function argmax(a) {
  let b = 0;
  for (let i = 1; i < a.length; i++) if (a[i] > a[b]) b = i;
  return b;
}

/** the most promising color; when the board says nothing yet, the color around me */
function choose(p, local, own) {
  const max = Math.max(...p);
  const close = [...p.keys()].filter((c) => p[c] >= max - 0.03);
  if (close.length === 1 || !local) return argmax(p);
  const nb = local.slice();
  if (own !== undefined) nb[own]--;
  return close.reduce((b, c) => (nb[c] > nb[b] ? c : b), close[0]);
}

function leaderOf(counts) {
  const max = Math.max(...counts);
  return counts.filter((v) => v === max).length > 1 ? -1 : counts.indexOf(max);
}

/**
 * @param {string} type one of BOT_TYPES
 * @param {() => number} rng
 * @param {number} ticks updates per round
 * @param {object} [opts] for the simulations: { wait } updates an inventor waits before
 *                        inventing ('inventAt'), { margin } how much better a switch must look
 */
function createBot(type, rng, ticks, opts = {}) {
  const margin = opts.margin ?? SWITCH_MARGIN;
  const reaction = 1 + Math.floor(rng() * 3); // 1..3 updates before the first move
  const patience = 1 + Math.floor(rng() * 2); // a reason to switch must last this long
  const midpoint = Math.floor(ticks * (0.2 + rng() * 0.4));
  const whimStart = Math.floor(rng() * ticks * 0.3);
  const favorite = Math.floor(rng() * 3);
  let urge = 0;
  let seen = -1;
  let seenSince = 0;

  /** 期待値予言: compare "stay" (my points stay as they are) with "switch" (points restart now).
   *  `switchBy` is how the switch is declared: api.predict, or api.invent for mixed players. */
  function predictByValue(view, decl, api, p = winProbs(view), me = {}, switchBy = api.predict) {
    if (!decl) return api.predict(choose(p, me.local, me.color));
    const stay = p[decl.color] * (ticks - decl.tick);
    let alt = -1;
    let altValue = 0;
    p.forEach((pc, c) => {
      if (c !== decl.color && pc * view.remaining > altValue) {
        alt = c;
        altValue = pc * view.remaining;
      }
    });
    urge = alt >= 0 && altValue > stay * margin ? urge + 1 : 0;
    if (urge >= patience) {
      urge = 0;
      switchBy(alt);
    }
  }

  function follow(view, decl, api) {
    const leader = leaderOf(view.counts);
    if (leader !== seen) {
      seen = leader;
      seenSince = view.tick;
    }
    if (leader < 0) return;
    if (!decl || (decl.color !== leader && view.tick - seenSince >= patience + 1)) api.predict(leader);
  }

  return {
    type,
    /**
     * called once per update, before the world steps.
     * view: observe(world) from ./odds.js
     * me:   { decl, local } — local: colors among my cell and its 8 neighbors
     * api:  { predict(c), invent(c) }
     */
    act(view, me, api) {
      const t = view.tick;
      const decl = me.decl;
      if (decl?.invented || t < reaction) return;
      switch (type) {
        case 'predict':
          return predictByValue(view, decl, api, undefined, me);
        case 'follow':
          return follow(view, decl, api);
        case 'whim':
          if (t < whimStart) return;
          if (!decl) return api.predict(favorite);
          if (rng() < 0.03) api.predict(Math.floor(rng() * 3));
          return;
        case 'inventEarly':
          return api.invent(choose(winProbs(view), me.local, me.color));
        // mixed: predict first; a switch is made by inventing (it restarts the points either way,
        // so inventing costs nothing more and adds influence). With opts.clear, invent at once
        // when the best color's chance is already at least that high.
        case 'mixed': {
          const p = winProbs(view);
          const clear = 'clear' in opts ? opts.clear : 0.55;
          if (!decl && clear !== undefined) {
            const c = choose(p, me.local, me.color);
            if (p[c] >= clear) return api.invent(c);
          }
          return predictByValue(view, decl, api, p, me, api.invent);
        }
        case 'inventAt': // simulations: wait `opts.wait` updates, declaring nothing, then invent
          if (t >= (opts.wait ?? 0)) api.invent(choose(winProbs(view), me.local, me.color));
          return;
        case 'local': {
          // own cell excluded: 3+ of the 8 neighbors share a color
          const nb = me.local.slice();
          if (me.color !== undefined) nb[me.color]--;
          const best = argmax(nb);
          if (nb[best] >= 3) return api.invent(best);
          return predictByValue(view, decl, api);
        }
        // waiting inventors declare nothing before inventing: by the rules, inventing is a
        // new declaration, so an earlier prediction would only be thrown away
        case 'inventLate':
          if (t >= midpoint) api.invent(argmax(winProbs(view)));
          return;
        case 'bandwagon': {
          const p = winProbs(view);
          if (p[argmax(p)] >= 0.6 || view.remaining <= 3) api.invent(argmax(p));
          return;
        }
        case 'contrarian':
          return api.invent(view.counts.indexOf(Math.min(...view.counts)));
      }
    },
  };
}

module.exports = { BOT_TYPES, HIDDEN_TYPES, createBot };
