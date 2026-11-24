'use strict';
// 負荷・通信テスト用: 本物のソケット接続でボット参加者をつなぐ。
// 普段のテストやプレイでは、大画面の「ボット」設定を使ってください。
// usage: node test/bots.js [人数] [URL] [種類=follow,wait,inventEarly,inventLate,contrarian]
const { io } = require('socket.io-client');
const { createBot, BOT_TYPES } = require('../src/bots');
const N = Number(process.argv[2] || 20);
const URL = process.argv[3] || 'http://localhost:3000';
const TYPES = (process.argv[4] || Object.keys(BOT_TYPES).join(',')).split(',');

for (let k = 0; k < N; k++) {
  const type = TYPES[k % TYPES.length];
  const s = io(URL, { auth: { role: 'player' }, transports: ['websocket'] });
  let brain = null;
  let round = 0;
  s.on('connect', () => s.emit('join', `ext${String(k + 1).padStart(2, '0')}`, () => {}));
  s.on('state', (st) => {
    if (st.round !== round) {
      round = st.round;
      brain = createBot(type, Math.random, st.ticks);
    }
    if (st.phase !== 'playing' || !brain || !st.me || st.me.cell === null) return;
    brain.act({ tick: st.world.tick, counts: st.world.counts }, { decl: st.me.decl }, {
      predict: (c) => s.emit('predict', c),
      invent: (c) => s.emit('invent', c),
    });
  });
}
console.log(`${N} socket bots connecting to ${URL}`);
