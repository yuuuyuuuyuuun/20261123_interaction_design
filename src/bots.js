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
  inventEarly: { label: '早期発明', short: '早発', desc: '開始直後に、勝ちそうな色を発明する' },
  local: { label: '地元発明', short: '地元', desc: '自分の周りに仲間が3人以上いる色を、その場で発明する' },
  inventLate: { label: '機を見て発明', short: '機発', desc: '予言で様子を見て、途中で勝ちそうな色を発明する' },
  bandwagon: { label: '勝ち馬発明', short: '勝馬', desc: '予言で様子を見て、勝ちがほぼ確実になった色を発明する' },
  contrarian: { label: '逆張り発明', short: '逆張', desc: '開始直後に、最も少ない色を発明する' },
};
const HIDDEN_TYPES = {};

const SWITCH_MARGIN = 1.1; // switch only when clearly better: estimates are noisy

function argmax(a) {
  let b = 0;
  for (let i = 1; i < a.length; i++) if (a[i] > a[b]) b = i;
  return b;
}

function leaderOf(counts) {
  const max = Math.max(...counts);
  return counts.filter((v) => v === max).length > 1 ? -1 : counts.indexOf(max);
}

/**
 * @param {string} type one of BOT_TYPES
 * @param {() => number} rng
 * @param {number} ticks updates per round
 */
function createBot(type, rng, ticks) {
  const reaction = 1 + Math.floor(rng() * 3); // 1..3 updates before the first move
  const patience = 1 + Math.floor(rng() * 2); // a reason to switch must last this long
  const midpoint = Math.floor(ticks * (0.2 + rng() * 0.4));
  const whimStart = Math.floor(rng() * ticks * 0.3);
  const favorite = Math.floor(rng() * 3);
  let urge = 0;
  let seen = -1;
  let seenSince = 0;

  /** 期待値予言: compare "stay" (my points stay as they are) with "switch" (points restart now) */
  function predictByValue(view, decl, api, p = winProbs(view)) {
    if (!decl) return api.predict(argmax(p));
    const stay = p[decl.color] * (ticks - decl.tick);
    let alt = -1;
    let altValue = 0;
    p.forEach((pc, c) => {
      if (c !== decl.color && pc * view.remaining > altValue) {
        alt = c;
        altValue = pc * view.remaining;
      }
    });
    urge = alt >= 0 && altValue > stay * SWITCH_MARGIN ? urge + 1 : 0;
    if (urge >= patience) {
      urge = 0;
      api.predict(alt);
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
          return predictByValue(view, decl, api);
        case 'follow':
          return follow(view, decl, api);
        case 'whim':
          if (t < whimStart) return;
          if (!decl) return api.predict(favorite);
          if (rng() < 0.03) api.predict(Math.floor(rng() * 3));
          return;
        case 'inventEarly':
          return api.invent(argmax(winProbs(view)));
        case 'local': {
          // own cell excluded: 3+ of the 8 neighbors share a color
          const nb = me.local.slice();
          if (me.color !== undefined) nb[me.color]--;
          const best = argmax(nb);
          if (nb[best] >= 3) return api.invent(best);
          return predictByValue(view, decl, api);
        }
        case 'inventLate':
          if (t >= midpoint) return api.invent(argmax(winProbs(view)));
          return predictByValue(view, decl, api);
        case 'bandwagon': {
          const p = winProbs(view);
          if (p[argmax(p)] >= 0.85) return api.invent(argmax(p));
          return predictByValue(view, decl, api, p);
        }
        case 'contrarian':
          return api.invent(view.counts.indexOf(Math.min(...view.counts)));
      }
    },
  };
}

module.exports = { BOT_TYPES, HIDDEN_TYPES, createBot };
