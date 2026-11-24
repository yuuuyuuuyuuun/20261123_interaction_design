'use strict';

// Bot players. Shared by the game server and the simulations so that what we
// measure is exactly what plays in class. Bots react with a human-like delay.

const BOT_TYPES = {
  follow: { label: '追従予言', short: '追従', desc: 'すぐ多数派を予言し、多数派が入れ替わると乗り換える' },
  wait: { label: '様子見予言', short: '様子見', desc: 'しばらく様子を見てから多数派を予言し、以後は乗り換える' },
  inventEarly: { label: '早期発明', short: '早発', desc: '開始直後に多数派を発明する' },
  inventLate: { label: '機を見て発明', short: '機発', desc: '予言で様子を見て、途中で多数派を発明する' },
  contrarian: { label: '逆張り発明', short: '逆張', desc: '開始直後に最も少ない色を発明する' },
};

function leaderOf(counts) {
  let best = -1;
  let bestN = -1;
  let tie = false;
  counts.forEach((v, k) => {
    if (v > bestN) {
      best = k;
      bestN = v;
      tie = false;
    } else if (v === bestN) tie = true;
  });
  return tie ? -1 : best;
}

/**
 * @param {keyof BOT_TYPES} type
 * @param {() => number} rng
 * @param {number} ticks ticks per round
 */
function createBot(type, rng, ticks) {
  const reaction = 1 + Math.floor(rng() * 3); // 1..3 updates to react
  const patience = 2 + Math.floor(rng() * 3); // the new leader must hold this long before switching
  const midpoint = Math.floor(ticks * (0.15 + rng() * 0.35));
  let seen = -1; // leader currently being watched
  let seenSince = 0;

  return {
    type,
    /** called once per update, before the world steps. api: { predict(c), invent(c) } */
    act(view, me, api) {
      const t = view.tick;
      const counts = view.counts;
      const leader = leaderOf(counts);
      if (leader !== seen) {
        seen = leader;
        seenSince = t;
      }
      const stable = leader >= 0 && t - seenSince >= patience;
      const decl = me.decl;
      if (decl?.invented) return;

      const followFrom = (start) => {
        if (t < start || leader < 0) return;
        if (!decl) api.predict(leader);
        else if (decl.color !== leader && stable) api.predict(leader);
      };

      switch (type) {
        case 'follow':
          return followFrom(reaction);
        case 'wait':
          return followFrom(midpoint);
        case 'inventEarly':
          if (t >= reaction && leader >= 0) api.invent(leader);
          return;
        case 'inventLate':
          if (t >= midpoint && leader >= 0) return api.invent(leader);
          return followFrom(reaction);
        case 'contrarian':
          if (t >= reaction) api.invent(counts.indexOf(Math.min(...counts)));
          return;
      }
    },
  };
}

module.exports = { BOT_TYPES, createBot, leaderOf };
