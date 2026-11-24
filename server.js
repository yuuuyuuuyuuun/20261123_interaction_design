'use strict';

const http = require('http');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const { World } = require('./src/engine');

const PORT = Number(process.env.PORT || 3000);
const HOST_KEY = process.env.HOST_KEY || crypto.randomBytes(3).toString('hex');
const TICK_MS = Number(process.env.TICK_MS || 1000);
const OBSERVE_MS = Number(process.env.OBSERVE_MS || 5000);

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
  ticks: 60,
  world: null,
  cellOwner: [], // cell index -> player id
  timeline: [], // per round summary
  lastResult: null,
  timer: null,
  observeEndsAt: 0,
};

/** @type {Map<string, {id:string,name:string,total:number,sockets:Set<string>,cell:number|null}>} */
const players = new Map();

function connected(p) {
  return p.sockets.size > 0;
}

function playerList() {
  return [...players.values()].map((p) => ({
    id: p.id,
    name: p.name,
    total: p.total,
    online: connected(p),
    cell: p.cell,
  }));
}

function ranking() {
  return playerList().sort((a, b) => b.total - a.total);
}

function worldView() {
  const w = game.world;
  if (!w) return null;
  return {
    ...w.snapshot(),
    names: game.cellOwner.map((id) => players.get(id)?.name ?? ''),
  };
}

function publicState() {
  return {
    phase: game.phase,
    round: game.round,
    rounds: game.rounds,
    ticks: game.ticks,
    remaining: game.world ? game.world.remaining : game.ticks,
    observeLeft: game.phase === 'observe' ? Math.max(0, game.observeEndsAt - Date.now()) : 0,
    world: worldView(),
    inventors: game.world ? game.world.fixed.filter(Boolean).length : 0,
    timeline: game.timeline,
    lastResult: game.lastResult,
    playerCount: [...players.values()].filter(connected).length,
  };
}

function personalState(p) {
  const w = game.world;
  const cell = p.cell;
  const inWorld = w && cell !== null && cell !== undefined && game.cellOwner[cell] === p.id;
  return {
    id: p.id,
    name: p.name,
    total: p.total,
    cell: inWorld ? cell : null,
    decl: inWorld ? w.decl[cell] : null,
    rank: ranking().findIndex((r) => r.id === p.id) + 1,
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

function startRound() {
  clearInterval(game.timer);
  const ids = shuffle([...players.values()].filter(connected).map((p) => p.id));
  if (ids.length === 0) return;
  for (const p of players.values()) p.cell = null;
  ids.forEach((id, i) => (players.get(id).cell = i));
  game.cellOwner = ids;
  game.world = new World(ids.length, { ticks: game.ticks }, (Math.random() * 2 ** 32) >>> 0);
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
  w.step();
  if (w.finished) return endRound();
  broadcast();
}

function endRound() {
  clearInterval(game.timer);
  const w = game.world;
  const res = w.result();
  const inventors = [];
  const perPlayer = {};
  game.cellOwner.forEach((id, cell) => {
    const p = players.get(id);
    const d = w.decl[cell];
    const pts = res.scores[cell];
    if (p) p.total += pts;
    perPlayer[id] = { decl: d, points: pts };
    if (d && d.invented) inventors.push({ color: d.color, ok: d.color === res.future });
  });
  const summary = {
    round: game.round,
    future: res.future,
    counts: res.counts,
    size: w.n,
    inventors: inventors.length,
    inventorsOfFuture: inventors.filter((x) => x.ok).length,
    history: w.history,
  };
  game.timeline.push(summary);
  game.lastResult = { ...summary, perPlayer };
  game.phase = game.round >= game.rounds ? 'final' : 'result';
  broadcast();
}

function resetGame() {
  clearInterval(game.timer);
  clearTimeout(game.timer);
  game.phase = 'lobby';
  game.round = 0;
  game.world = null;
  game.cellOwner = [];
  game.timeline = [];
  game.lastResult = null;
  for (const p of players.values()) {
    p.total = 0;
    p.cell = null;
  }
  // forget players who left
  for (const [id, p] of players) if (!connected(p)) players.delete(id);
  broadcast();
}

// ---------------------------------------------------------------- sockets

const COLOR_OK = (c) => Number.isInteger(c) && c >= 0 && c < 3;

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
    socket.on('host:settings', ({ rounds, ticks } = {}) => {
      if (game.phase !== 'lobby') return;
      if (Number.isInteger(rounds) && rounds >= 1 && rounds <= 20) game.rounds = rounds;
      if (Number.isInteger(ticks) && ticks >= 10 && ticks <= 300) game.ticks = ticks;
      broadcast();
    });
    socket.on('host:reset', resetGame);
    socket.on('host:kick', (id) => {
      const p = players.get(id);
      if (!p || game.phase === 'observe' || game.phase === 'playing') return;
      for (const sid of p.sockets) io.sockets.sockets.get(sid)?.disconnect(true);
      players.delete(id);
      broadcast();
    });
    return;
  }

  // ---- player
  let p = typeof token === 'string' && players.get(token);
  socket.on('join', (rawName, ack) => {
    const name = String(rawName || '').trim().slice(0, 12);
    if (!name) return ack?.({ ok: false, error: '名前を入力してください' });
    if (!p) {
      const id = crypto.randomUUID();
      p = { id, name, total: 0, sockets: new Set(), cell: null };
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
    if (!p || game.phase !== 'playing' || !COLOR_OK(color)) return ack?.({ ok: false });
    const cell = p.cell;
    if (cell === null || game.cellOwner[cell] !== p.id) return ack?.({ ok: false });
    const ok = fn(cell, color);
    ack?.({ ok });
    if (ok) broadcast();
  };
  socket.on('predict', act((cell, c) => game.world.predict(cell, c)));
  socket.on('invent', act((cell, c) => game.world.invent(cell, c)));

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
