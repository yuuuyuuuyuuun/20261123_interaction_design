'use strict';
// 動作確認用: ボット参加者を接続する
// usage: node test/bots.js [人数] [URL]
const { io } = require('socket.io-client');
const N = Number(process.argv[2] || 20);
const URL = process.argv[3] || 'http://localhost:3000';

for (let k = 0; k < N; k++) {
  const s = io(URL, { auth: { role: 'player' }, transports: ['websocket'] });
  const style = k % 4; // 0,1: 予言（追従） 2: 早めに発明 3: 様子見してから発明
  const wait = 3 + Math.floor(Math.random() * 20);
  let decided = null;
  let round = 0;
  s.on('connect', () => s.emit('join', `bot${String(k + 1).padStart(2, '0')}`, () => {}));
  s.on('state', (st) => {
    if (st.round !== round) { round = st.round; decided = null; }
    if (st.phase !== 'playing' || !st.me || st.me.cell === null) return;
    if (st.me.decl && st.me.decl.invented) return;
    const elapsed = st.ticks - st.remaining;
    const c = st.world.counts;
    const leader = c.indexOf(Math.max(...c));
    if (style <= 1) {
      if (elapsed >= wait % 8 && decided !== leader) { decided = leader; s.emit('predict', leader); }
    } else if (style === 2) {
      if (elapsed >= 1) s.emit('invent', st.world.color[st.me.cell]);
    } else if (elapsed >= wait) s.emit('invent', leader);
    else if (decided !== leader) { decided = leader; s.emit('predict', leader); }
  });
}
console.log(`${N} bots connecting to ${URL}`);
