'use strict';

const $ = (id) => document.getElementById(id);
const TOKEN_KEY = 'wmou-token';
const NAME_KEY = 'wmou-name';
const store = {
  get(k) {
    try { return localStorage.getItem(k); } catch { return null; }
  },
  set(k, v) {
    try { localStorage.setItem(k, v); } catch {}
  },
};

let token = store.get(TOKEN_KEY);
let joined = false;
let state = null;
let selected = null; // color currently predicted

const socket = io({ auth: { role: 'player', token } });
const view = new WorldView($('world'));

$('nameInput').value = store.get(NAME_KEY) || '';

socket.on('welcome', ({ name }) => {
  joined = true;
  $('myName').textContent = name;
  render();
});
socket.on('state', (s) => {
  state = s;
  if (s.me) joined = true;
  render();
});
socket.on('connect', () => {
  // the server forgot us (e.g. restarted): rejoin silently with the stored name
  if (token && !joined && store.get(NAME_KEY)) setTimeout(() => !joined && join(store.get(NAME_KEY)), 300);
});

function join(name) {
  socket.emit('join', name, (res) => {
    if (!res?.ok) return ($('joinErr').textContent = res?.error || '参加できませんでした');
    token = res.token;
    store.set(TOKEN_KEY, token);
    store.set(NAME_KEY, name);
    joined = true;
    $('myName').textContent = name;
    render();
  });
}
$('joinBtn').onclick = () => join($('nameInput').value.trim());
$('nameInput').addEventListener('keydown', (e) => e.key === 'Enter' && $('joinBtn').click());

// ---- choices: one tap each
$('predictRow').innerHTML = COLORS.map(
  (c, i) => `<button class="choice" data-act="predict" data-c="${i}" style="background:${c.hex}">${landIcon(i, 28)}${c.name}</button>`
).join('');
$('inventRow').innerHTML = COLORS.map(
  (c, i) => `<button class="choice inv" data-act="invent" data-c="${i}" style="color:${c.hex}">${landIcon(i, 28)}${c.name}</button>`
).join('');
const landLabel = (k) => `<span class="land-inline" style="color:${COLORS[k].hex}">${landIcon(k, 18)}${COLORS[k].name}</span>`;
$('controls').addEventListener('click', (e) => {
  const b = e.target.closest('.choice');
  if (!b || b.disabled) return;
  const c = Number(b.dataset.c);
  const act = b.dataset.act;
  socket.emit(act, c, (r) => r?.ok && navigator.vibrate?.(act === 'invent' ? [30, 50, 90] : 15));
  if (act === 'predict') {
    selected = c;
    render();
  }
});
$('controls').addEventListener('contextmenu', (e) => e.preventDefault());

// ---- render
function screen(id) {
  for (const s of ['join', 'wait', 'play', 'result']) $(s).classList.toggle('hidden', s !== id);
}

let cdTimer = null;

function render() {
  clearInterval(cdTimer);
  if (!joined) return screen('join');
  const s = state;
  if (!s) return screen('wait');
  const me = s.me;
  if (me) $('myName').textContent = me.name;

  if (s.phase === 'lobby') {
    $('waitTitle').textContent = '参加しました';
    $('waitText').textContent = '大画面でゲームが始まるのを待っています。';
    selected = null;
    return screen('wait');
  }

  if (s.phase === 'observe' || s.phase === 'playing') {
    screen('play');
    renderPlay(s, me);
    return;
  }

  // result / final
  screen('result');
  selected = null;
  const r = s.lastResult;
  if (!r) return;
  $('rYear').textContent = `${yearOf(r.round)}年代`;
  const f = r.future;
  $('rFuture').textContent = f < 0 ? '未来は定まらなかった' : `未来は「${COLORS[f].name}」`;
  $('rFuture').style.color = f >= 0 ? COLORS[f].hex : '';
  const mine = me && r.perPlayer[me.id];
  if (!mine) {
    $('rMine').textContent = 'このラウンドには参加していません。';
    $('rPoints').textContent = '';
  } else if (!mine.decl) {
    $('rMine').textContent = '宣言しませんでした。';
    $('rPoints').textContent = '+0';
  } else {
    const how = mine.decl.invented ? '発明' : '予言';
    const hit = mine.decl.color === f;
    $('rMine').textContent = `あなたは「${COLORS[mine.decl.color].name}」を${how}しました — ${hit ? (mine.decl.invented ? '未来を発明した' : '的中') : 'はずれ'}`;
    $('rPoints').textContent = `+${mine.points}`;
  }
  $('rTotal').textContent = me ? me.total : 0;
  $('rRank').textContent = me ? me.rank : '-';
  $('rNext').textContent = s.phase === 'final' ? 'ゲーム終了。大画面を見てください。' : '次のラウンドを待っています。';
}

function renderPlay(s, me) {
  const playing = s.phase === 'playing';
  const inWorld = me && me.cell !== null;
  view.set(s.world);
  view.highlight = inWorld ? me.cell : null;

  $('phaseLbl').textContent = playing ? '未来まで' : '開始まで';
  $('remain').textContent = playing ? s.remaining : '';
  $('worth').textContent = playing ? `+${s.remaining}` : `+${s.ticks}`;
  // countdown before the round starts (the same as on the big screen)
  $('countdown').classList.toggle('hidden', playing);
  if (!playing) {
    const end = Date.now() + (s.observeLeft || 0);
    const tick = () => {
      const sec = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      $('cdNum').textContent = sec;
      $('remain').textContent = sec;
    };
    tick();
    cdTimer = setInterval(tick, 200);
  }

  $('spectate').classList.toggle('hidden', !!inWorld);
  if (!inWorld) {
    $('controls').classList.add('hidden');
    $('fixedBox').classList.add('hidden');
    $('meLine').textContent = '';
    return;
  }

  const decl = me.decl;
  if (decl) selected = decl.color;
  const myColor = s.world.color[me.cell];
  $('meLine').innerHTML = `白い輪の中があなたの土地（いま${landLabel(myColor)}）` +
    (decl && !decl.invented ? ` ・ 予言：${landLabel(decl.color)}（当たれば +${s.ticks - decl.tick}）` : '');

  const invented = decl?.invented;
  const spell = (s.world.charismas || []).find((c) => c.player === me.index);
  if (spell)
    $('meLine').innerHTML = `<b style="color:${COLORS[spell.color].hex}">カリスマが宿った！</b> 周りの土地があなたの${landLabel(spell.color)}に染まりやすい（あと${spell.left}ターン）`;
  $('controls').classList.toggle('hidden', !!invented);
  $('fixedBox').classList.toggle('hidden', !invented);
  if (invented) {
    const c = COLORS[decl.color];
    $('fixedBox').innerHTML = `あなたは${landLabel(decl.color)}を発明した。<br>あなたの土地はもう流されない。<br><span class="muted">当たれば +${s.ticks - decl.tick}</span>`;
    return;
  }

  document.querySelectorAll('.choice').forEach((b) => {
    b.disabled = !playing;
    b.classList.toggle('on', b.dataset.act === 'predict' && Number(b.dataset.c) === selected);
  });
}
