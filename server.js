'use strict';

const http = require('http');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const { World } = require('./src/engine');
const { BOT_TYPES, createBot } = require('./src/bots');
const { observe, localCounts } = require('./src/odds');

const PORT = Number(process.env.PORT || 3000);
const HOST_KEY = process.env.HOST_KEY || crypto.randomBytes(3).toString('hex');
const TICK_MS = Number(process.env.TICK_MS || 1000);
const OBSERVE_MS = Number(process.env.OBSERVE_MS || 5000);
const MAX_BOTS = 200;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/host', (req, res) => res.sendFile(path.join(__dirname, 'public', 'host.html')));
app.get('/qr.svg', async (req, res) => {
  const url = String(req.query.u || '').slice(0, 500);
  if (!/^https?:\/\//.test(url)) return res.status(400).end();
  const svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  res.type('image/svg+xml').send(svg);
});

// ---------------------------------------------------------------- game state

const game = {
  phase: 'lobby', // lobby | observe | playing | result | final
  round: 0,
  rounds: 5,
  ticks: 40,
  bots: Object.fromEntries(Object.keys(BOT_TYPES).map((k) => [k, 0])),
  world: null,
  order: [], // player index in the world -> player id
  botBrains: [], // player index -> bot instance (or null for humans)
  timeline: [],
  lastResult: null,
  timer: null,
  observeEndsAt: 0,
};

/** @type {Map<string, {id:string,name:string,total:number,sockets:Set<string>,bot:string|null}>} */
const players = new Map();

const isIn = (p) => Boolean(p.bot) || p.sockets.size > 0;

function playerList() {
  return [...players.values()].map((p) => ({
    id: p.id,
    name: p.name,
    total: p.total,
    online: isIn(p),
    bot: p.bot,
  }));
}

const ranking = () => playerList().sort((a, b) => b.total - a.total);

// keep the bot players in line with game.bots
function syncBots() {
  for (const [type, want] of Object.entries(game.bots)) {
    const mine = [...players.values()].filter((p) => p.bot === type);
    for (let k = mine.length; k < want; k++) {
      const id = `bot-${type}-${crypto.randomUUID().slice(0, 8)}`;
      players.set(id, { id, name: '', total: 0, sockets: new Set(), bot: type });
    }
    for (const p of mine.slice(want)) players.delete(p.id);
    [...players.values()]
      .filter((p) => p.bot === type)
      .forEach((p, k) => (p.name = `${BOT_TYPES[type].short}${k + 1}`));
  }
}

function indexOf(p) {
  return game.world ? game.order.indexOf(p.id) : -1;
}

function worldView() {
  const w = game.world;
  if (!w) return null;
  const s = w.snapshot();
  return {
    cols: s.cols,
    rows: s.rows,
    color: s.color,
    fixedCells: s.fixed.reduce((a, f, i) => (f && a.push(i), a), []),
    playerCell: s.playerCell,
    names: game.order.map((id) => players.get(id)?.name ?? ''),
    counts: s.counts,
    tick: s.tick,
    ticks: s.ticks,
    events: s.events,
    charismas: s.charismas,
  };
}

function publicState() {
  const w = game.world;
  return {
    phase: game.phase,
    round: game.round,
    rounds: game.rounds,
    ticks: game.ticks,
    bots: game.bots,
    botTypes: BOT_TYPES,
    remaining: w ? w.remaining : game.ticks,
    observeLeft: game.phase === 'observe' ? Math.max(0, game.observeEndsAt - Date.now()) : 0,
    world: worldView(),
    inventors: w ? w.decl.filter((d) => d?.invented).length : 0,
    timeline: game.timeline,
    lastResult: game.lastResult,
    playerCount: [...players.values()].filter(isIn).length,
    humanCount: [...players.values()].filter((p) => !p.bot && isIn(p)).length,
  };
}

function personalState(p) {
  const w = game.world;
  const idx = indexOf(p);
  const rank = ranking().findIndex((r) => r.id === p.id) + 1;
  return {
    id: p.id,
    name: p.name,
    total: p.total,
    index: idx >= 0 ? idx : null,
    cell: idx >= 0 ? w.playerCell[idx] : null,
    decl: idx >= 0 ? w.decl[idx] : null,
    rank,
  };
}

function broadcast() {
  const pub = publicState();
  io.to('host').emit('state', { ...pub, players: ranking() });
  for (const p of players.values()) {
    for (const sid of p.sockets) io.to(sid).emit('state', { ...pub, me: personalState(p) });
  }
}

// ---------------------------------------------------------------- round flow

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function stopTimers() {
  clearTimeout(game.timer);
  clearInterval(game.timer);
  game.timer = null;
}

function startRound() {
  stopTimers();
  syncBots();
  const ids = shuffle([...players.values()].filter(isIn).map((p) => p.id));
  if (ids.length === 0) return;
  game.order = ids;
  game.world = new World(ids.length, { ticks: game.ticks }, (Math.random() * 2 ** 32) >>> 0);
  game.botBrains = ids.map((id) => {
    const p = players.get(id);
    return p.bot ? createBot(p.bot, Math.random, game.ticks) : null;
  });
  game.round += 1;
  game.lastResult = null;
  game.phase = 'observe';
  game.observeEndsAt = Date.now() + OBSERVE_MS;
  broadcast();
  game.timer = setTimeout(() => {
    game.phase = 'playing';
    broadcast();
    game.timer = setInterval(tick, TICK_MS);
  }, OBSERVE_MS);
}

function tick() {
  const w = game.world;
  const view = observe(w);
  game.botBrains.forEach((b, i) => {
    if (!b) return;
    const cell = w.playerCell[i];
    b.act(view, { decl: w.decl[i], local: localCounts(w, cell), color: w.color[cell] }, {
      predict: (c) => w.predict(i, c),
      invent: (c) => w.invent(i, c),
    });
  });
  w.step();
  if (w.finished) return endRound();
  broadcast();
}

function endRound() {
  stopTimers();
  const w = game.world;
  const res = w.result();
  const perPlayer = {};
  let inventors = 0;
  let inventorsOfFuture = 0;
  game.order.forEach((id, i) => {
    const p = players.get(id);
    const d = w.decl[i];
    const pts = res.scores[i];
    if (p) p.total += pts;
    perPlayer[id] = { decl: d, points: pts };
    if (d?.invented) {
      inventors++;
      if (d.color === res.future) inventorsOfFuture++;
    }
  });
  const summary = {
    round: game.round,
    future: res.future,
    counts: res.counts,
    size: w.size,
    players: w.players,
    inventors,
    inventorsOfFuture,
    history: w.history,
  };
  game.timeline.push(summary);
  game.lastResult = { ...summary, perPlayer };
  game.phase = game.round >= game.rounds ? 'final' : 'result';
  broadcast();
}

function resetGame() {
  stopTimers();
  game.phase = 'lobby';
  game.round = 0;
  game.world = null;
  game.order = [];
  game.botBrains = [];
  game.timeline = [];
  game.lastResult = null;
  for (const [id, p] of players) if (!isIn(p)) players.delete(id);
  for (const p of players.values()) p.total = 0;
  broadcast();
}

// ---------------------------------------------------------------- sockets

io.on('connection', (socket) => {
  const { role, key, token } = socket.handshake.auth || {};

  if (role === 'host') {
    if (key !== HOST_KEY) {
      socket.emit('denied');
      return socket.disconnect(true);
    }
    socket.join('host');
    socket.emit('state', { ...publicState(), players: ranking() });

    socket.on('host:start', () => {
      if (game.phase === 'lobby' || game.phase === 'result') startRound();
    });
    socket.on('host:settings', ({ rounds, ticks, bots } = {}) => {
      if (game.phase !== 'lobby' && game.phase !== 'result') return;
      if (Number.isInteger(rounds) && rounds >= Math.max(1, game.round + (game.phase === 'result' ? 1 : 0)) && rounds <= 20)
        game.rounds = rounds;
      if (Number.isInteger(ticks) && ticks >= 10 && ticks <= 300) game.ticks = ticks;
      if (bots && typeof bots === 'object') {
        let total = 0;
        for (const type of Object.keys(BOT_TYPES)) {
          const n = Number(bots[type]);
          if (Number.isInteger(n) && n >= 0) game.bots[type] = n;
          total += game.bots[type];
        }
        if (total > MAX_BOTS) for (const type of Object.keys(BOT_TYPES)) game.bots[type] = Math.floor((game.bots[type] * MAX_BOTS) / total);
        syncBots();
      }
      broadcast();
    });
    socket.on('host:reset', resetGame);
    return;
  }

  // ---- player
  let p = typeof token === 'string' && players.get(token);
  if (p?.bot) p = null;

  socket.on('join', (rawName, ack) => {
    const name = String(rawName || '').trim().slice(0, 12);
    if (!name) return ack?.({ ok: false, error: '名前を入力してください' });
    if (!p) {
      const id = crypto.randomUUID();
      p = { id, name, total: 0, sockets: new Set(), bot: null };
      players.set(id, p);
    } else p.name = name;
    p.sockets.add(socket.id);
    ack?.({ ok: true, token: p.id });
    broadcast();
  });

  if (p) {
    p.sockets.add(socket.id);
    socket.emit('welcome', { name: p.name });
    broadcast();
  } else socket.emit('state', publicState());

  const act = (fn) => (color, ack) => {
    if (!p || game.phase !== 'playing') return ack?.({ ok: false });
    const i = indexOf(p);
    if (i < 0) return ack?.({ ok: false });
    const ok = fn(i, color);
    ack?.({ ok });
    if (ok) broadcast();
  };
  socket.on('predict', act((i, c) => game.world.predict(i, c)));
  socket.on('invent', act((i, c) => game.world.invent(i, c)));

  socket.on('disconnect', () => {
    if (!p) return;
    p.sockets.delete(socket.id);
    broadcast();
  });
});

server.listen(PORT, () => {
  console.log(`世界は、わたしたちでできている`);
  console.log(`  参加者用  : http://localhost:${PORT}/`);
  console.log(`  大画面用  : http://localhost:${PORT}/host?key=${HOST_KEY}`);
});

module.exports = { server, game, players, HOST_KEY };
