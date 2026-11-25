'use strict';

const $ = (id) => document.getElementById(id);
const key = new URLSearchParams(location.search).get('key') || '';
const socket = io({ auth: { role: 'host', key } });
const view = new WorldView($('world'), { names: true });

const joinUrl = location.origin + '/';
$('qr').src = '/qr.svg?u=' + encodeURIComponent(joinUrl);
$('url').textContent = joinUrl;

let state = null;

// legend: drawn with the same land tiles as the board
(function legend() {
  const tile = (inner = '') =>
    `<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="5" fill="${COLORS[0].hex}"/>${inner}</svg>`;
  $('legend').innerHTML = [
    `${tile('<circle cx="19" cy="5" r="3.2" fill="#0a0c14" stroke="#fff" stroke-width="1.4"/>')}<span>市民の土地（右上の点、または名前）</span>`,
    `${tile('<rect x="3" y="3" width="18" height="18" rx="3.5" fill="none" stroke="#fff" stroke-width="3"/>')}<span>発明者の土地（もう変わらない）</span>`,
    `<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="#fff" stroke-width="2.4" stroke-dasharray="4 3"/></svg><span>カリスマ（不利な発明者に宿り、周りに強い影響を与える）</span>`,
    `<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="${COLORS[2].hex}" stroke-width="3.5"/></svg><span>ムーブメント（低確率で起こる大事件）</span>`,
  ]
    .map((h) => `<div>${h}</div>`)
    .join('');
})();
let botInputsBuilt = false;

socket.on('denied', () => $('denied').classList.remove('hidden'));
socket.on('state', (s) => {
  state = s;
  render();
});

// ---- settings: sent as soon as they change
function sendSettings() {
  const bots = {};
  document.querySelectorAll('[data-bot]').forEach((el) => (bots[el.dataset.bot] = Math.max(0, Number(el.value) || 0)));
  socket.emit('host:settings', {
    rounds: Number($('setRounds').value),
    ticks: Number($('setTicks').value),
    bots,
  });
}
$('setRounds').addEventListener('change', sendSettings);
$('setTicks').addEventListener('change', sendSettings);

function buildBotInputs(types, counts) {
  $('botSettings').innerHTML = Object.entries(types)
    .map(
      ([k, t]) => `<label for="bot-${k}">${esc(t.label)}<small>${esc(t.desc)}</small></label>
      <input id="bot-${k}" data-bot="${k}" type="number" min="0" max="200" value="${counts[k] || 0}">`
    )
    .join('');
  document.querySelectorAll('[data-bot]').forEach((el) => el.addEventListener('change', sendSettings));
  botInputsBuilt = true;
}

$('startBtn').onclick = () => socket.emit('host:start');
$('resetBtn').onclick = () => {
  if (confirm('得点と年表を消して、最初からやり直しますか？')) socket.emit('host:reset');
};

function show(id, on) {
  $(id).classList.toggle('hidden', !on);
}

let observeTimer = null;
let toastTimer = null;
let lastEventTick = -1;

function toast(text, color) {
  const t = $('toast');
  t.textContent = text;
  t.style.color = color;
  t.style.opacity = 1;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.style.opacity = 0), 1600);
}

function render() {
  const s = state;
  const ph = s.phase;
  const editable = ph === 'lobby' || ph === 'result';

  show('lobby', ph === 'lobby');
  show('observe', ph === 'observe');
  show('result', ph === 'result');
  show('final', ph === 'final');
  // settings stay visible (bot descriptions are useful during play); editable only between rounds
  document.querySelectorAll('#settings input').forEach((el) => (el.disabled = !editable));
  show('live', ph !== 'lobby');
  show('rankingBox', ph !== 'lobby');

  if (!botInputsBuilt) buildBotInputs(s.botTypes, s.bots);
  // reflect the server's values unless the operator is typing in that field
  const sync = (el, v) => document.activeElement !== el && (el.value = v);
  sync($('setRounds'), s.rounds);
  sync($('setTicks'), s.ticks);
  document.querySelectorAll('[data-bot]').forEach((el) => sync(el, s.bots[el.dataset.bot] ?? 0));

  view.set(ph === 'lobby' ? null : s.world);
  if (ph === 'playing' && s.world?.events?.length && s.world.tick !== lastEventTick) {
    lastEventTick = s.world.tick;
    const ev = s.world.events[s.world.events.length - 1];
    const c = COLORS[ev.color];
    toast(ev.kind === 'charisma' ? `${c.name}のカリスマ、${s.world.names[ev.player]}` : `${c.name}のムーブメント！`, c.hex);
  }

  $('roundLabel').textContent = s.round ? `${yearOf(s.round)}年代（${s.round}/${s.rounds}）` : `全${s.rounds}ラウンド`;
  $('remaining').textContent = ph === 'playing' ? s.remaining : ph === 'observe' ? s.ticks : '—';
  $('inventors').textContent = s.inventors;

  const counts = s.world?.counts || [0, 0, 0];
  const n = counts.reduce((a, b) => a + b, 0) || 1;
  $('bars').innerHTML = COLORS.map(
    (c, i) => `<div class="bar"><span class="nm" style="color:${c.hex}">${landIcon(i, 22)}${c.name}</span>
      <div class="track"><div class="fill" style="width:${(100 * counts[i]) / n}%;background:${c.hex}"></div></div>
      <span class="count">${counts[i]}</span></div>`
  ).join('');

  const humans = s.players.filter((p) => !p.bot);
  const bots = s.players.length - humans.length;
  $('pcount').textContent = `${s.humanCount}${bots ? ` ＋ボット${bots}` : ''}`;
  $('players').innerHTML = humans.map((p) => `<span class="chip ${p.online ? '' : 'off'}">${esc(p.name)}</span>`).join('');
  // full ranking (scrollable); tied totals share a place
  let place = 0;
  $('ranking').innerHTML = s.players
    .map((p, i) => {
      if (i === 0 || p.total !== s.players[i - 1].total) place = i + 1;
      const cls = p.bot ? 'bot' : 'me';
      return `<span class="muted">${place}</span><span class="${cls}">${esc(p.name)}</span><span class="pts">${p.total}</span>`;
    })
    .join('');
  $('rankCount').textContent = s.players.length;

  const btn = $('startBtn');
  btn.disabled = !editable || s.playerCount === 0;
  btn.textContent =
    ph === 'lobby' ? 'ゲーム開始' : ph === 'result' ? `次のラウンド（${yearOf(s.round + 1)}年代）へ` : ph === 'final' ? '終了' : '進行中…';

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
  return f < 0 ? '未来は定まらなかった' : `「${COLORS[f].name}」の未来`;
}

function renderResult(r) {
  $('resultYear').textContent = `${yearOf(r.round)}年代`;
  const el = $('resultFuture');
  el.textContent = futureLabel(r.future);
  el.style.color = r.future >= 0 ? COLORS[r.future].hex : '';
  $('resultInv').textContent =
    r.inventors === 0
      ? '誰も発明しなかった。世界はなりゆきで決まった。'
      : `${r.inventors}人が発明を選び、そのうち${r.inventorsOfFuture}人がこの未来を創造した。`;
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
