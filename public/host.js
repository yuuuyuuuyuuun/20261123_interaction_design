'use strict';

const $ = (id) => document.getElementById(id);
const key = new URLSearchParams(location.search).get('key') || '';
const socket = io({ auth: { role: 'host', key } });
const view = new WorldView($('world'), { names: true });

const joinUrl = location.origin + '/';
$('qr').src = '/qr.svg?u=' + encodeURIComponent(joinUrl);
$('url').textContent = joinUrl;

let state = null;

socket.on('denied', () => $('denied').classList.remove('hidden'));
socket.on('state', (s) => {
  state = s;
  render();
});

$('startBtn').onclick = () => {
  if (state?.phase === 'lobby') {
    socket.emit('host:settings', {
      rounds: Number($('setRounds').value),
      ticks: Number($('setTicks').value),
    });
  }
  socket.emit('host:start');
};
$('resetBtn').onclick = () => {
  if (confirm('得点と年表を消して、最初からやり直しますか？')) socket.emit('host:reset');
};

function show(id, on) {
  $(id).classList.toggle('hidden', !on);
}

let observeTimer = null;

function render() {
  const s = state;
  const ph = s.phase;

  show('lobby', ph === 'lobby');
  show('observe', ph === 'observe');
  show('result', ph === 'result');
  show('final', ph === 'final');
  show('settings', ph === 'lobby');
  show('rankingBox', ph === 'result' || ph === 'final');

  view.set(ph === 'lobby' ? null : s.world);

  $('roundLabel').textContent = s.round ? `${yearOf(s.round)}年代（${s.round}/${s.rounds}）` : `全${s.rounds}ラウンド`;
  $('remaining').textContent = ph === 'playing' ? s.remaining : ph === 'observe' ? s.ticks : '—';
  $('inventors').textContent = s.inventors;

  const counts = s.world?.counts || [0, 0, 0];
  const n = counts.reduce((a, b) => a + b, 0) || 1;
  $('bars').innerHTML = COLORS.map(
    (c, i) => `<div class="bar"><span style="color:${c.hex}">${c.name}</span>
      <div class="track"><div class="fill" style="width:${(100 * counts[i]) / n}%;background:${c.hex}"></div></div>
      <span class="count">${counts[i]}</span></div>`
  ).join('');

  $('pcount').textContent = s.playerCount;
  $('players').innerHTML = s.players
    .map((p) => `<span class="chip ${p.online ? '' : 'off'}">${esc(p.name)}</span>`)
    .join('');
  $('ranking').innerHTML = s.players
    .slice(0, 10)
    .map((p, i) => `<span class="muted">${i + 1}</span><span>${esc(p.name)}</span><span class="pts">${p.total}</span>`)
    .join('');

  const btn = $('startBtn');
  btn.disabled = !(ph === 'lobby' || ph === 'result') || s.playerCount === 0;
  btn.textContent = ph === 'lobby' ? 'ゲーム開始' : ph === 'result' ? `次のラウンド（${yearOf(s.round + 1)}年代）へ` : ph === 'final' ? '終了' : '進行中…';

  clearInterval(observeTimer);
  if (ph === 'observe') {
    const end = Date.now() + s.observeLeft;
    const upd = () => ($('observeCount').textContent = Math.max(0, Math.ceil((end - Date.now()) / 1000)));
    upd();
    observeTimer = setInterval(upd, 200);
  }

  if ((ph === 'result' || ph === 'final') && s.lastResult) renderResult(s.lastResult);
  if (ph === 'final') renderFinal(s);
}

function futureLabel(f) {
  return f < 0 ? '未来は定まらなかった' : `未来は「${COLORS[f].name}」`;
}

function renderResult(r) {
  $('resultYear').textContent = `${yearOf(r.round)}年代`;
  const el = $('resultFuture');
  el.textContent = futureLabel(r.future);
  el.style.color = r.future >= 0 ? COLORS[r.future].hex : '';
  $('resultInv').textContent =
    r.inventors === 0
      ? '誰も立ち止まらなかった。世界はなりゆきで決まった。'
      : `${r.inventors}人が立ち止まり、そのうち${r.inventorsOfFuture}人がこの未来を発明した。`;
  requestAnimationFrame(() => drawHistory($('hist'), r.history));
}

function renderFinal(s) {
  $('timeline').innerHTML = s.timeline
    .map((t) => {
      const c = t.future >= 0 ? COLORS[t.future] : null;
      const invented = t.inventorsOfFuture > 0;
      return `<div class="era ${invented ? 'invented' : ''}">
        <div class="y">${yearOf(t.round)}年代</div>
        <div class="c" style="background:${c ? c.hex : 'var(--line)'}">${c ? c.name : '—'}</div>
        <div class="k">${invented ? `${t.inventorsOfFuture}人が発明した未来` : 'なりゆきの未来'}</div>
      </div>`;
    })
    .join('');
  const invented = s.timeline.filter((t) => t.inventorsOfFuture > 0).length;
  const people = s.timeline.reduce((a, t) => a + t.inventorsOfFuture, 0);
  $('closing').textContent =
    invented === 0
      ? `${s.timeline.length}回の未来は、すべてなりゆきで決まりました。`
      : `${s.timeline.length}回の未来のうち${invented}回は、のべ${people}人の発明者がつくった未来でした。`;
}

window.addEventListener('resize', () => state?.lastResult && renderResult(state.lastResult));
