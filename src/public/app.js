'use strict';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KEY = 'poker-token' + (new URLSearchParams(location.search).get('p') || '');
let AVATARS = ['🦊', '🐻', '🐼', '🐯', '🦁', '🐸', '🐵', '🐧', '🦉', '🐺']; // запасной набор, если картинок нет
const AVATAR_IMAGES = new Set();
// Аватарка — либо имя картинки из папки avatars, либо эмодзи.
const avatarHtml = (a, cls) => (AVATAR_IMAGES.has(a) ? `<img class="${cls || ''}" src="avatars/${a}.jpg" alt="" draggable="false">` : esc(a));
// Реакции — свои картинки (public/reactions, лист в reactions-source), поэтому у всех одинаковые.
// Порядок здесь — порядок в выборе на вкладке «Профиль».
const REACTION_DEFAULT = ['laugh', 'cool', 'shock', 'think', 'angry', 'cry'];
const REACTIONS = {
  laugh: ['Смех'], cool: ['Круто'], shock: ['Шок'], think: ['Хм…'], angry: ['Злюсь'], cry: ['Слёзы'],
  // дополнительные — каждый игрок сам выбирает шесть для своей кнопки
  love: ['Влюблён'], wink: ['Подмигиваю'], sleep: ['Сплю'], money: ['Деньги'], fire: ['Огонь'], bluff: ['Блефую'],
  like: ['Класс'], dislike: ['Не очень'], clap: ['Браво'], pray: ['Пожалуйста'], facepalm: ['Фейспалм'],
  sweat: ['Нервничаю'], poker: ['Покерфейс'], eyeroll: ['Ну-ну'],
};
const reactionSvg = (id) => `<img class="rx" src="reactions/${id}.png" alt="" draggable="false">`;
Object.keys(REACTIONS).forEach((id) => { new Image().src = `reactions/${id}.png`; }); // заранее, чтобы реакция не мигала при первом показе
const THEME_NAMES = { classic: 'Зелёное', graphite: 'Графит', burgundy: 'Бордо', night: 'Ночь' };
// Координаты в процентах от стола; место 0 — всегда ваше, внизу по центру.
const POS = [[50, 90], [9, 62], [16, 19], [50, 10], [84, 19], [91, 62]];
// У верхнего места ставка и кнопка дилера стоят выше ряда «фишки · банк · часы», по бокам от плашки, зеркально.
// У боковых мест (1 и 5) капсула привязана краем к картам, а не центром: иначе длинная сумма наезжает на карту.
const BET = [[37, 67], [23.6, 56], [29, 34], [36, 18], [71, 34], [76.4, 56]];
const BET_EDGE = { 1: ' l', 5: ' r' };
const DEALER = [[63, 72], [20, 47], [22, 31], [64, 18], [78, 31], [80, 47]];
const RING = 2 * Math.PI * 37;
// Значок блайнда: такая же круглая кнопка, как кнопка реакций, и стоит зеркально к ней.
// У своего места реакции слева — значок справа; у соперников значок на стороне, где нет карт.
function blindBadge(i, v, mine) {
  const label = i === S.sbSeat ? 'МБ' : i === S.bbSeat ? 'ББ' : '';
  if (!label) return '';
  const side = mine || v >= 4 ? 'r' : 'l';
  return `<span class="blind-badge ${side}" title="${label === 'МБ' ? 'Малый блайнд' : 'Большой блайнд'}">${label}</span>`;
}
// Золотая фишка победителя турнира: наклейка под наклоном сверху на краю аватарки (до сброса статистики).
// У соперников, чьи карты лежат справа, — слева, чтобы не наезжать на карты.
function winChip(n, left) {
  if (!n) return '';
  return `<span class="win-chip${left ? ' l' : ''}" title="Победитель турнира${n > 1 ? ' · ' + n + ' раза' : ''}"><svg viewBox="0 0 32 32"><use href="#winchip"/></svg>${n > 1 ? `<b>${n}</b>` : ''}</span>`;
}
const REACT_BTN ='<button class="react-btn" title="Реакции"><svg class="ic" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8.5 14.3c1 1.3 2.2 1.9 3.5 1.9s2.5-.6 3.5-1.9"/><path d="M9 9.4v.8M15 9.4v.8"/></svg></button>';

const prefs = Object.assign({ unit: 'chips', betUnit: 'chips', sound: true, zoom: 1, reactions: REACTION_DEFAULT }, JSON.parse(localStorage.getItem('poker-prefs') || '{}'));
// «Ржу» заменён чертёнком «Блефую» — у кого он стоял на кнопке, встаёт чертёнок
prefs.reactions = (prefs.reactions || []).map((id) => (id === 'rofl' ? 'bluff' : id)).filter((id) => REACTIONS[id]).slice(0, 6);
if (!prefs.reactions.length) prefs.reactions = REACTION_DEFAULT.slice();
const savePrefs = () => localStorage.setItem('poker-prefs', JSON.stringify(prefs));

// ---------- масштаб ----------
// Интерфейс свёрстан под окно 1280x760. Под другое окно он растягивается целиком,
// чтобы на большом мониторе текст и стол не оставались мелкими. prefs.zoom — личная поправка игрока.
const ZOOMS = [[0.85, 'Мельче'], [1, 'Авто'], [1.15, 'Крупнее'], [1.3, 'Крупно']];
function fitScale() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const auto = Math.max(0.7, Math.min(3, Math.min(w / 1280, h / 760)));
  const k = auto * (prefs.zoom || 1);
  const root = document.documentElement.style;
  root.setProperty('--k', k);
  root.setProperty('--vw', w / k + 'px');
  root.setProperty('--vh', h / k + 'px');
}
window.addEventListener('resize', fitScale);
fitScale();
// Места рассчитаны на стол шириной от 900 px. Уже — уменьшаем их вместе со столом (не меньше 0,7).
new ResizeObserver(([e]) => {
  const ts = Math.max(0.7, Math.min(1, e.contentRect.width / 900));
  const t = $('table');
  if (t.style.getPropertyValue('--ts') !== String(ts)) t.style.setProperty('--ts', ts);
}).observe(document.getElementById('table'));
// Окна (итоги турнира, меню админа, пауза) стоят по центру стола. По горизонтали их сдвигают панели (CSS),
// по вертикали — разница высоты шапки и панели действий: её и передаём в CSS как --tdy.
function alignModals() {
  const game = $('game');
  if (game.hidden) return;
  const g = game.getBoundingClientRect();
  const t = $('table').getBoundingClientRect();
  const k = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--k')) || 1;
  const dy = Math.round(((t.top + t.height / 2) - (g.top + g.height / 2)) / k);
  if (game.style.getPropertyValue('--tdy') !== dy + 'px') game.style.setProperty('--tdy', dy + 'px');
}
window.addEventListener('resize', () => requestAnimationFrame(alignModals));

let token = localStorage.getItem(KEY);
let es = null;
let S = null;
let avatar = null;
let deadline = 0;
let drawDeadline = 0;
let drawSequence = '';
let drawStarted = 0;
let raiseTo = 0;
let footerKey = '';
let pageBuild = ''; // отпечаток сборки, с которой загружена страница
let turnKey = '';
let prevBoard = 0;
let prevHand = 0;
let unread = 0;
let wasMyTurn = false;

// ---------- турнир ----------
const TROPHY = '<svg class="ic" viewBox="0 0 24 24"><path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5.5a2.5 2.5 0 0 0 2.6 3.6M16 6h2.5a2.5 2.5 0 0 1-2.6 3.6"/><path d="M12 13v3.5M8.5 20h7M10 16.5h4l.5 3.5h-5z"/></svg>';
let tourDeadline = 0;
let tourKey = '';
let tourSeen = 0; // турнир, итоги которого игрок уже закрыл
const tourPhase = () => (S && S.tour ? S.tour.phase : 'off');
const tourOn = () => tourPhase() === 'play' || tourPhase() === 'done';
const myTourAnswer = () => (S.tour ? S.tour.answers.find((a) => a.id === S.you.id) : null);
const tourPlace = (id) => (S.tour ? S.tour.places.find((p) => p.id === id) : null);
const minutes = (n) => (n >= 60 ? `${Math.floor(n / 60)} ч${n % 60 ? ' ' + (n % 60) + ' мин' : ''}` : n + ' мин');
const clock = (ms) => { const s = Math.ceil(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
// Строка в шапке. В турнире — текущие блайнды и сколько осталось до роста.
function infoText() {
  const blinds = `Блайнды ${fmt(S.cfg.sb, 'chips')}/${fmt(S.cfg.bb, 'chips')}`;
  const watching = S.you.seat < 0 ? ' · вы наблюдаете' : '';
  if (tourPhase() === 'play') {
    return 'Турнир · ' + blinds + watching; // обратный отсчёт до роста — часами на сукне справа от банка
  }
  if (tourPhase() === 'done') return 'Турнир окончен' + watching;
  return blinds + (S.handNo ? ` · раздача ${S.handNo}` : '') + watching;
}

// ---------- формат сумм ----------
function fmt(n, unit) {
  if ((unit || prefs.unit) === 'bb' && S) {
    const v = (n / S.cfg.bb).toFixed(1).replace(/\.0$/, '').replace('.', ',');
    return v + ' ББ';
  }
  return Math.round(n).toLocaleString('ru-RU');
}

// ---------- звук ----------
let ac = null;
function tone(freq, dur, type, vol, delay) {
  if (!prefs.sound) return;
  try {
    ac = ac || new AudioContext();
    const o = ac.createOscillator();
    const g = ac.createGain();
    const t = ac.currentTime + (delay || 0);
    o.type = type || 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol || 0.07, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ac.destination);
    o.start(t);
    o.stop(t + dur);
  } catch (e) { /* звук недоступен */ }
}
const SND = {
  deal: () => { tone(900, 0.04, 'triangle', 0.05); tone(700, 0.04, 'triangle', 0.05, 0.09); tone(900, 0.04, 'triangle', 0.05, 0.18); },
  check: () => { tone(170, 0.06, 'square', 0.05); tone(170, 0.06, 'square', 0.05, 0.11); },
  call: () => { tone(2400, 0.03, 'triangle'); tone(3100, 0.05, 'triangle', 0.07, 0.05); },
  raise: () => { tone(2400, 0.03, 'triangle'); tone(3100, 0.04, 'triangle', 0.07, 0.05); tone(2700, 0.04, 'triangle', 0.07, 0.1); tone(3400, 0.06, 'triangle', 0.07, 0.15); },
  chips: () => SND.call(),
  fold: () => tone(200, 0.16, 'sine', 0.05),
  turn: () => { tone(660, 0.12); tone(880, 0.2, 'sine', 0.08, 0.13); },
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 'triangle', 0.07, i * 0.1)),
  pause: () => tone(440, 0.25, 'sine', 0.06),
  msg: () => tone(1250, 0.05, 'sine', 0.035),
  // олл-ин: тяжёлый двойной удар ниже обычных фишек
  allin: () => { tone(196, 0.16, 'triangle', 0.1); tone(147, 0.24, 'triangle', 0.1, 0.12); tone(2400, 0.03, 'triangle', 0.05, 0.05); },
  // перед ривером: три удара сердца
  heartbeat: () => { tone(70, 0.11, 'sine', 0.35); tone(58, 0.14, 'sine', 0.3, 0.17); }, // один удар «тук-тук»; ритм задаёт открытие карт
};
document.addEventListener('pointerdown', () => { if (ac && ac.state === 'suspended') ac.resume(); });

// ---------- сеть ----------
async function cmd(type, data) {
  try {
    const r = await fetch('/api/cmd', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ token, type }, data)) });
    const j = await r.json();
    if (!r.ok) { toast(j.error || 'Ошибка'); return false; }
    return true;
  } catch (e) { toast('Нет связи с сервером'); return false; }
}

function toast(text, ok) {
  const t = $('toast');
  t.textContent = text;
  t.classList.toggle('ok', !!ok);
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 3000);
}

// Ключ браузера стираем, только когда сервер точно сказал, что такого участника нет.
// При обрыве связи (сервер перезапускается) ключ остаётся, и игра сама переподключается.
async function checkToken() {
  try {
    const r = await fetch('/api/cmd', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, type: 'hello' }) });
    return r.ok ? true : false;
  } catch (e) { return null; }
}
let retryTimer = null;
function waitServer() {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(async () => {
    const ok = await checkToken();
    if (ok === true) connect();
    else if (ok === false) showLogin('Сессия закончилась. Войдите заново.');
    else waitServer();
  }, 2500);
}
function showLogin(message) {
  if (es) { es.close(); es = null; }
  clearTimeout(retryTimer);
  token = null;
  localStorage.removeItem(KEY);
  S = null;
  $('game').hidden = true;
  $('login').hidden = false;
  $('loginError').textContent = message || '';
  refreshAvatarChoice(false);
  $('nick').focus();
}

// Закрыли вкладку или браузер — сразу сообщаем серверу, чтобы остальные увидели «офлайн» без задержки.
window.addEventListener('pagehide', () => {
  if (token && es) navigator.sendBeacon('/api/away', JSON.stringify({ token }));
});
function connect() {
  $('login').hidden = true;
  $('game').hidden = false;
  es = new EventSource('/api/events?token=' + token);
  es.addEventListener('hello', (e) => {
    const h = JSON.parse(e.data);
    // сервер пересобран, а страница старая — перезагружаемся, чтобы у всех был один и тот же вид
    if (h.build && pageBuild && h.build !== pageBuild) { location.reload(); return; }
    pageBuild = h.build;
    if (h.runoutPause) runoutPauseMs = h.runoutPause;
    clearLogs();
    for (const n of JSON.parse(e.data).history) addNote(n, true);
    renderGameLog();
  });
  es.addEventListener('state', (e) => {
    S = JSON.parse(e.data);
    deadline = performance.now() + S.turnLeft;
    drawDeadline = performance.now() + (S.buttonDraw?.remainingMs || 0);
    tourDeadline = S.tour ? performance.now() + S.tour.levelLeft : 0;
    streetReady = performance.now() + (S.streetIn || 0);
    if (S.streetIn) setTimeout(() => { if (S) redrawFooter(); }, S.streetIn + 30);
    render();
    alignModals();
  });
  es.addEventListener('note', (e) => addNote(JSON.parse(e.data), false));
  es.addEventListener('react', (e) => showReaction(JSON.parse(e.data)));
  es.addEventListener('say', (e) => { // «Покажи карты!» — облачко у того, кто попросил
    const m = JSON.parse(e.data);
    const v = seatPosOfPlayer(m.from);
    if (v >= 0) { fxAt(v, 'bubble', m.text, 4000).classList.add('req'); SND.msg(); }
  });
  es.addEventListener('kicked', () => showLogin('Админ удалил вас из игры.'));
  es.addEventListener('bye', () => showLogin(''));
  es.addEventListener('reset', () => { clearLogs(); prevHand = 0; prevBoard = 0; wonHand = 0; });
  es.onerror = () => {
    if (!es || es.readyState !== 2) return; // браузер сам переподключается
    es.close();
    es = null;
    waitServer();
  };
}

// ---------- вход ----------
// На входе показываем 8 случайных свободных аватарок (две строки по 4): занятые игроками за столом не предлагаем.
const CHOICE = 8;
let choice = [];
const mix = (list) => list.map((a) => [Math.random(), a]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
async function refreshAvatarChoice(reshuffle) {
  let taken = new Set();
  try { taken = new Set((await (await fetch('/api/avatars')).json()).taken); } catch (e) { /* сервер недоступен — показываем все */ }
  const free = AVATARS.filter((a) => !taken.has(a));
  let next = reshuffle ? [] : choice.filter((a) => free.includes(a));
  const unseen = mix(free.filter((a) => !choice.includes(a)));
  const seen = mix(free.filter((a) => choice.includes(a) && !next.includes(a)));
  for (const a of unseen.concat(seen)) if (next.length < CHOICE) next.push(a);
  if (next.join() === choice.join() && $('avatars').children.length) return;
  choice = next;
  if (avatar && !choice.includes(avatar)) avatar = null;
  renderAvatarChoice();
}
function renderAvatarChoice() {
  $('avatars').style.gridTemplateColumns = 'repeat(4, 1fr)';
  $('avatars').innerHTML = choice.map((a) => `<button type="button" data-a="${esc(a)}"${a === avatar ? ' class="on"' : ''}>${avatarHtml(a)}</button>`).join('');
}
// пока открыт вход, список занятых обновляется: кто-то мог сесть за стол
setInterval(() => { if (!$('login').hidden) refreshAvatarChoice(false); }, 4000);
$('avatars').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  avatar = b.dataset.a;
  for (const x of $('avatars').children) x.classList.toggle('on', x === b);
});
// Ник уже есть в игре, но его владелец не в сети: можно вернуться под ним со своим местом и фишками.
let reclaimNick = '';
const loginBtn = () => document.querySelector('#loginForm button[type=submit]');
function setReclaim(nick, text) {
  reclaimNick = nick;
  loginBtn().textContent = nick ? 'Это я — вернуться' : 'Сесть за стол';
  $('loginError').classList.toggle('note', !!nick);
  $('loginError').textContent = text || '';
}
$('nick').addEventListener('input', () => { if (reclaimNick && $('nick').value.trim().toLowerCase() !== reclaimNick) setReclaim('', ''); });
$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('nick').value.trim();
  const reclaim = !!reclaimNick && name.toLowerCase() === reclaimNick;
  $('loginError').textContent = '';
  try {
    const r = await fetch('/api/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, avatar, reclaim }) });
    const j = await r.json();
    if (r.status === 409 && j.reclaim) { setReclaim(name.toLowerCase(), j.error); return; }
    if (!r.ok) { setReclaim('', j.error); refreshAvatarChoice(false); return; }
    setReclaim('', '');
    token = j.token;
    localStorage.setItem(KEY, token);
    connect();
  } catch (err) { $('loginError').textContent = 'Нет связи с сервером'; }
});

// ---------- отрисовка ----------
const base = () => (S.you.seat >= 0 ? S.you.seat : 0);
const viewPos = (seat) => (seat - base() + 6) % 6;
const place = (p) => `left:${p[0]}%;top:${p[1]}%`;
const ICON = {
  close: '<svg class="ic" viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17"/></svg>',
  back: '<svg class="ic" viewBox="0 0 24 24"><path d="M14.5 6l-6 6 6 6"/></svg>',
  more: '<svg class="ic" viewBox="0 0 24 24"><circle cx="6" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18" cy="12" r="1.3"/></svg>',
};
let raiseOpen = false;
let sideTab = 'players';
let wonHand = 0;
// Олл-ин: карты стола открываются по улицам, под игроками — шансы на победу.
let runoutHand = 0;
let runoutStep = 0;
let runoutTimer = null;
let runoutActive = false;
let curStage = null;
let heartTimer = null;
let liveHeart = 0; // раздача, в которой уже бьётся сердце при олл-ине с открытием по кнопке дилера
let streetReady = 0; // когда у дилера появится кнопка открыть улицу (пауза при олл-ине) // этап открытия карт, который сейчас на столе
const allInSeen = new Map(); // раздача:игрок -> когда показали «Олл-ин!» (0 — без объявления)
const allInAmt = new Map(); // раздача:игрок -> сумма олл-ина из записи хода
const ALLIN_SAY = 3000; // сколько висит облачко «Олл-ин!»; потом аватарка краснеет
let allInFirst = true;
// Паузы докладки задаёт сервер (приходят в hello), здесь только запасные значения.
let runoutPauseMs = { street: 2200, river: 3500 };
const RUNOUT_PAUSE = (g) => (g && g.board === 4 ? runoutPauseMs.river : runoutPauseMs.street);

function flyChips(v) {
  const colors = ['#ffd60a', '#ff453a', '#0a84ff'];
  for (let n = 0; n < 9; n++) {
    const el = document.createElement('div');
    el.className = 'flychip';
    el.style.setProperty('--c', colors[n % 3]);
    $('fx').appendChild(el);
    const a = el.animate(
      [{ left: `${46 + (n % 3) * 4}%`, top: '34%', opacity: 1 }, { left: POS[v][0] + '%', top: POS[v][1] + '%', opacity: 1, offset: 0.85 }, { left: POS[v][0] + '%', top: POS[v][1] + '%', opacity: 0 }],
      { duration: 800, delay: 250 + n * 55, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'both' },
    );
    a.onfinish = () => el.remove();
  }
}

// Карта: достоинство и малая масть в углу, крупная масть внизу справа. style — задержка и путь анимации раздачи.
function cardHtml(c, cls, style) {
  const st = style ? ` style="${style}"` : '';
  if (!c) return `<div class="card back ${cls || ''}"${st}></div>`;
  const rank = c[0] === 'T' ? '10' : c[0];
  const suit = { s: '♠', h: '♥', d: '♦', c: '♣' }[c[1]];
  return `<div class="card s-${c[1]} ${cls || ''}"${st}><b>${rank}</b><u>${suit}</u><i>${suit}</i></div>`;
}

// Стопка мини-карт: до восьми — рядом, больше — внахлёст веером (видны уголки со значением и мастью).
function pileHtml(cards, hit) {
  const tight = cards.length > 8 ? ' tight' : '';
  return `<div class="pile${tight}">${cards.map((c) => cardHtml(c, 'xs' + (hit ? (c === hit ? ' hit' : ' miss') : ''))).join('')}</div>`;
}
// Отдельные подписи пишутся с заглавной; после «·» продолжение фразы — со строчной.
const cap = (s) => s.replace(/^(<[^>]*>)?([а-яё])/, (m, tag, ch) => (tag || '') + ch.toUpperCase());
const cardsWord = (n) => (n % 10 === 1 && n % 100 !== 11 ? 'карта' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'карты' : 'карт');
// Личная панель аутов при олл-ине: видит только сам игрок, пока ждёт следующую карту. Когда карта из набора
// приходит, её мини-копия загорается — до конца раздачи.
let myOuts = null; // { hand, board, cards } — последний показанный набор
function outsDockHtml(stage) {
  const me = S.you.seat;
  if (me < 0) return '';
  const cards = stage && stage.outs && stage.outs[me];
  if (cards && cards.length) {
    myOuts = { hand: S.handNo, board: stage.board, cards };
    return `<div class="dock-cap">Вас спасут <b>${cards.length} ${cardsWord(cards.length)}</b></div>${pileHtml(cards)}`;
  }
  if (myOuts && myOuts.hand === S.handNo) {
    const shown = stage ? stage.board : S.board.length;
    const came = shown > myOuts.board ? S.board[myOuts.board] : null;
    if (came && myOuts.cards.includes(came)) return `<div class="dock-cap hit">Пришла ваша карта</div>${pileHtml(myOuts.cards, came)}`;
  }
  return '';
}

// Победа: какие карты образуют комбинацию победителей (hit) и какие входят в их лучшую пятёрку (five).
// Решил ли кикер: сравниваем победителя с лучшей рукой среди остальных вскрывшихся. Если они разошлись
// уже на самой комбинации (две пары пятёрок и двоек против троек и двоек), кикер не играл — он бледный, как прочие.
const CORE_LEN = [2, 2, 3, 2, 2, 6, 3, 2, 2]; // сколько первых чисел оценки — сама комбинация, остальное — кикеры
function kickersMatter(res, w) {
  const me = res.hands[w] && res.hands[w].score;
  if (!me) return true;
  let best = null;
  for (const i in res.hands) {
    if (Number(i) === Number(w) || winnersOf(res).has(Number(i))) continue;
    const sc = res.hands[i].score;
    if (!best || cmpScore(sc, best) > 0) best = sc;
  }
  if (!best) return false; // соперников на вскрытии нет — кикер ничего не решал
  let k = 0;
  while (k < me.length && me[k] === best[k]) k++;
  return k >= CORE_LEN[me[0]];
}
const cmpScore = (a, b) => { for (let k = 0; k < Math.max(a.length, b.length); k++) { const d = (a[k] || 0) - (b[k] || 0); if (d) return d; } return 0; };
function winCards(res, winners) {
  const hit = new Set();
  const five = new Set();
  if (res && res.showdown) {
    for (const i of winners) {
      const h = res.hands[i];
      if (!h || !h.core) continue;
      h.core.forEach((c) => hit.add(c));
      if (kickersMatter(res, i)) h.five.forEach((c) => five.add(c)); // кикер светлый, только если решил исход
    }
  }
  return { hit, five, on: hit.size > 0 };
}
const winClass = (c, w) => (!w.on ? '' : w.hit.has(c) ? ' hit' : w.five.has(c) ? '' : ' miss');

function winnersOf(res) {
  const w = new Set();
  if (res) for (const p of res.pots) if (!p.refund) p.winners.forEach((i) => w.add(i));
  return w;
}

// Банк: чем он больше (в больших блайндах), тем выше стопки фишек.
function potHtml(amount) {
  const n = Math.max(1, Math.min(15, Math.ceil(Math.log2(amount / S.cfg.bb + 1) * 2)));
  const colors = ['#ffd60a', '#ff453a', '#0a84ff'];
  const stacks = n <= 3 ? 1 : n <= 8 ? 2 : 3;
  let chips = '';
  for (let s = 0; s < stacks; s++) {
    const count = Math.floor(n / stacks) + (s < n % stacks ? 1 : 0);
    chips += `<div class="stk" style="--c:${colors[s]}">${'<i></i>'.repeat(count)}</div>`;
  }
  return `<div class="potbox"><div class="chips">${chips}</div><span>Банк</span><b>${fmt(amount)}</b></div>`;
}
// Часы турнира на сукне: кольцо тает до роста блайндов, рядом — сколько осталось. Справа от банка (слева у него фишки).
const TCLOCK_R = 15;
const TCLOCK_LEN = 2 * Math.PI * TCLOCK_R;
const STOPWATCH = '<g transform="translate(8 8) scale(.58)"><circle cx="12" cy="13.5" r="7"/><path d="M12 13.5V10M10 3h4"/></g>';
function tclockHtml() {
  if (tourPhase() !== 'play' || !S.tour.next) return '';
  return `<div class="tclock" title="До роста блайндов · дальше ${fmt(S.tour.next / 2, 'chips')}/${fmt(S.tour.next, 'chips')}"><svg viewBox="0 0 36 36"><circle class="track" cx="18" cy="18" r="${TCLOCK_R}"/><circle class="prog" cx="18" cy="18" r="${TCLOCK_R}" stroke-dasharray="${TCLOCK_LEN}" transform="rotate(-90 18 18)"/></svg><b></b></div>`;
}
function tclockTick() {
  const el = document.querySelector('.tclock');
  if (!el) return;
  const left = S.paused ? S.tour.levelLeft : Math.max(0, tourDeadline - performance.now());
  const part = S.tour.levelLeft && S.tour.levelMs ? Math.min(1, left / S.tour.levelMs) : 0;
  const text = S.tour.levelLeft && left > 0 ? clock(left) : '0:00'; // 0:00 — новые блайнды со следующей раздачи
  const b = el.querySelector('b');
  if (b.textContent !== text) b.textContent = text;
  el.querySelector('.prog').style.strokeDashoffset = TCLOCK_LEN * (1 - part);
  el.classList.toggle('soon', part > 0 && part < 0.1);
}
// Блайнды выросли: капсула над банком на 4 секунды и короткий сигнал.
function levelBanner(n) {
  const old = document.querySelector('.level-up');
  if (old) old.remove();
  const el = document.createElement('div');
  el.className = 'level-up';
  el.innerHTML = `<svg class="ic" viewBox="0 0 30 30">${STOPWATCH}</svg><span>Новые блайнды</span><b>${fmt(n.sb, 'chips')}/${fmt(n.bb, 'chips')}</b>`;
  // на месте флопа: блайнды растут перед раздачей, общих карт ещё нет, а сверху сидит игрок
  const b = $('board');
  el.style.top = b.offsetTop + b.offsetHeight / 2 + 'px';
  $('center').appendChild(el);
  setTimeout(() => el.remove(), 4200);
  [784, 1047].forEach((f, i) => tone(f, 0.18, 'triangle', 0.06, i * 0.12));
}

function render() {
  const warning = S.you.isHost && S.saveWarning;
  const notice = $('saveWarning');
  notice.hidden = !warning;
  if (warning) {
    const lastSave = warning.lastSavedAt
      ? 'Последнее сохранение — ' + new Date(warning.lastSavedAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
      : 'Успешных сохранений пока нет';
    const text = 'Не удалось сохранить стол. ' + lastSave;
    if (notice.textContent !== text) notice.textContent = text;
  }
  document.body.dataset.theme = S.look.theme;
  document.body.dataset.cards = S.look.cards;
  const me = S.you.seat;
  const newHand = S.handNo !== prevHand;
  if (newHand) { clearTimeout(runoutTimer); clearTimeout(heartTimer); combosOpen = false; } // справочник в новой раздаче снова свёрнут
  // live — улицы уже открывал дилер, повторять не надо
  const ro = S.phase === 'idle' && S.result && S.result.runout && !S.result.runout.live ? S.result.runout : null;
  if (ro && runoutHand !== S.handNo) {
    runoutHand = S.handNo;
    runoutStep = 0;
    clearTimeout(runoutTimer);
    // этапы держатся по-разному: перед ривером пауза длиннее и бьётся «сердце»
    // сердце бьётся от вскрытия до последней карты и учащается перед ривером
    const hand = S.handNo;
    const beat = () => {
      if (runoutHand !== hand || runoutStep >= ro.stages.length) return;
      SND.heartbeat();
      const g = ro.stages[runoutStep];
      heartTimer = setTimeout(beat, g && g.board === 4 ? 720 : 1050);
    };
    const next = () => {
      const g = ro.stages[runoutStep];
      runoutTimer = setTimeout(() => {
        runoutStep++;
        if (S) render();
        if (runoutStep < ro.stages.length) next(); else clearTimeout(heartTimer);
      }, RUNOUT_PAUSE(g));
    };
    next();
    // сердце начинает биться, когда отзвучало последнее «Олл-ин!»
    const said = Math.max(0, ...[...allInSeen].filter(([k]) => k.startsWith(hand + ':')).map(([, v]) => v));
    heartTimer = setTimeout(beat, Math.max(0, said + ALLIN_SAY - performance.now()));
  }
  const stage = S.runoutLive || (ro && runoutHand === S.handNo && runoutStep < ro.stages.length ? ro.stages[runoutStep] : null);
  // олл-ин, улицы открывает дилер: сердце бьётся, пока не откроется ривер (начинает после «Олл-ин!»)
  if (S.runoutLive && liveHeart !== S.handNo) {
    liveHeart = S.handNo;
    const hand = S.handNo;
    const said = Math.max(0, ...[...allInSeen].filter(([k]) => k.startsWith(hand + ':')).map(([, v]) => v));
    const beat = () => {
      if (!S || S.handNo !== hand || !S.runoutLive) return;
      SND.heartbeat();
      heartTimer = setTimeout(beat, S.runoutLive.board === 4 ? 720 : 1050);
    };
    clearTimeout(heartTimer);
    heartTimer = setTimeout(beat, Math.max(0, said + ALLIN_SAY - performance.now()));
  }
  runoutActive = !!stage;
  curStage = stage;
  const winners = stage ? new Set() : winnersOf(S.result); // победителя показываем, когда открыты все карты
  // Олл-ин: сначала игрок «говорит» — красное облачко «Олл-ин!» и тяжёлый звук, а когда облачко уходит,
  // аватарка становится красной с полосой «олл-ин». Один раз на игрока за раздачу.
  // Последний, кто ответил олл-ином, сразу закрывает торговлю — поэтому смотрим и на открытие карт после неё.
  if (S.phase !== 'idle' || (S.result && S.result.runout)) {
    for (let i = 0; i < 6; i++) {
      const s = S.seats[i];
      if (!s || !s.allIn || !s.inHand || s.folded) continue;
      const key = S.handNo + ':' + s.id;
      if (allInSeen.has(key)) continue;
      if (allInFirst) { allInSeen.set(key, 0); continue; } // открыли страницу посреди раздачи — сразу красная, без объявления
      allInSeen.set(key, performance.now());
      fxAt(viewPos(i), 'bubble', allInAmt.has(key) ? 'Олл-ин ' + fmt(allInAmt.get(key)) : 'Олл-ин!', ALLIN_SAY).classList.add('allin');
      SND.allin();
      setTimeout(() => { if (S) render(); }, ALLIN_SAY + 30);
    }
  }
  allInFirst = false;
  $('info').textContent = infoText();

  const win = winCards(S.result, winners);
  // Раздача: карты по очереди вылетают из центра стола к игрокам, начиная слева от дилера.
  const order = [];
  if (newHand) for (let k = 1; k <= 6; k++) { const i = (S.button + k) % 6; if (S.seats[i] && S.seats[i].inHand) order.push(i); }
  const drawKey = S.buttonDraw?.cards.join(',') || '';
  if (drawKey !== drawSequence) {
    drawSequence = drawKey;
    drawStarted = performance.now();
  }
  const tableW = $('table').offsetWidth;
  const tableH = $('table').offsetHeight;
  const dealStyle = (i, v, n) => {
    const turn = n * order.length + Math.max(0, order.indexOf(i));
    return `--dx:${Math.round((50 - POS[v][0]) / 100 * tableW)}px;--dy:${Math.round((45 - POS[v][1]) / 100 * tableH)}px;animation-delay:${turn * 80}ms`;
  };

  let html = '';
  for (let i = 0; i < 6; i++) {
    const s = S.seats[i];
    const v = viewPos(i);
    if (!s) {
      html += `<div class="seat empty" style="${place(POS[v])}"><div class="av">Свободно</div>${me < 0 && !tourOn() ? '<button data-cmd="sit">Сесть</button>' : ''}</div>`;
      continue;
    }
    const cls = ['seat'];
    if (i === me) cls.push('me');
    if (S.toAct === i) cls.push('turn');
    if (s.inHand && s.folded) cls.push('folded');
    if (s.showed) cls.push('showed');
    if (s.sittingOut || (!s.inHand && S.phase !== 'idle')) cls.push('out');
    if (!s.connected) cls.push('offline');
    if (winners.has(i)) cls.push('win');
    if (stage && stage.eq[i] == null) cls.push('dark'); // открытие карт при олл-ине: свет только на участниках
    const said = allInSeen.get(S.handNo + ':' + s.id);
    const allIn = s.allIn && s.inHand && !s.folded && (S.phase !== 'idle' || !!stage) && !(said && performance.now() - said < ALLIN_SAY);
    if (allIn) cls.push('allin');
    const isDealer = S.waitDealer && i === S.dealerSeat; // ждём, когда дилер начнёт новую раздачу
    if (isDealer) cls.push('dealer-wait');
    let hole = '';
    const drawCard = S.buttonDraw?.cards[i];
    if (drawCard || s.cards || s.hasCards) {
      const size = i === me ? 'lg' : 'sm';
      const drawDelay = drawCard ? S.buttonDraw.cards.slice(0, i).filter(Boolean).length * 140 - (performance.now() - drawStarted) : 0;
      const anim = drawCard ? (drawDelay > -350 ? ' draw-flip' : '') : newHand ? ' deal' : '';
      const side = i === me ? '' : (v >= 4 ? 'left' : 'right');
      const faces = drawCard ? [drawCard] : s.cards || [null, null];
      const lost = win.on && !winners.has(i);
      const cards = faces.map((c, n) => cardHtml(c, size + anim + (c ? (lost ? ' miss' : winClass(c, win)) : ''), drawCard ? `animation-delay:${drawDelay}ms` : newHand ? dealStyle(i, v, n) : '')).join('');
      hole = `<div class="hole ${side}">${cards}</div>`;
    }
    let line = `<div class="st">${fmt(s.stack)}</div>`;
    if (s.sittingOut) line = '<div class="st note">Пропускает</div>';
    else if (s.allIn && S.phase !== 'idle') line = '<div class="st">Олл-ин</div>';
    else if (s.inHand && s.folded && S.phase !== 'idle') line = `<div class="st note">Фолд · ${fmt(s.stack)}</div>`;
    else if (tourOn() && s.stack === 0 && S.phase === 'idle') line = '<div class="st note">Выбыл</div>';
    if (stage && stage.eq[i] != null) line = '<div class="st">Олл-ин</div>'; // пока открываются карты, итог не подсказываем
    let hand = S.result && !stage && S.result.hands[i] ? `<div class="hand">${cap(S.result.hands[i].name)}</div>` : '';
    if (stage && stage.eq[i] != null) {
      const lead = Math.max(...Object.values(stage.eq));
      hand = ''; // шансы и ауты — в панели «Комбинации», на столе только игра
    }
    if (tourPhase() === 'done') {
      const pl = tourPlace(s.id); // итоги турнира: место под каждым игроком
      hand = pl ? `<div class="hand${pl.place === 1 ? '' : ' wait'}">${pl.place === 1 ? 'Победитель' : pl.place + ' место'}</div>` : '';
    } else if (!S.running) {
      const host = S.people.some((p) => p.id === s.id && p.isHost); // админу отмечать готовность не нужно: он запускает игру
      hand = s.ready ? '<div class="hand ok">Готов</div>' : `<div class="hand wait">${host ? 'Админ' : 'Не готов'}</div>`;
    }
    if (isDealer && i !== me) hand += '<div class="hand dl">Дилер</div>';
    html += `<div class="${cls.join(' ')}" style="${place(POS[v])}">${hole}
      <div class="av"><svg class="ring" viewBox="0 0 82 82"><circle class="track" cx="41" cy="41" r="37"/><circle class="prog" cx="41" cy="41" r="37" stroke-dasharray="${RING}"/></svg><span class="face">${avatarHtml(s.avatar)}${allIn ? '<span class="off-band ai">Олл-ин</span>' : s.connected ? '' : '<span class="off-band">Не в сети</span>'}</span>${i === me ? REACT_BTN : ''}${blindBadge(i, v, i === me)}${winChip(s.cups, i !== me && v < 4)}</div>
      <div class="plate"><div class="nm">${esc(s.name)}</div>${line}</div>${hand}</div>`;
    if (s.bet > 0) html += `<div class="bet${BET_EDGE[v] || ''}" style="${place(BET[v])}">${fmt(s.bet)}</div>`;
    // раздача кончилась и ждём дилера — фишка D уже у того, кто начнёт следующую (вместе с подписью «Дилер»)
    const dSeat = S.buttonDraw ? S.buttonDraw.winner : S.waitDealer && S.dealerSeat >= 0 ? S.dealerSeat : S.button;
    if (i === dSeat && (S.buttonDraw || S.handNo)) html += `<div class="dealer" style="${place(DEALER[v])}" title="Дилер">D</div>`;
  }
  $('seats').innerHTML = html;
  $('table').classList.toggle('spot', !!stage); // свет на участниках олл-ина и общих картах

  $('pot').innerHTML = `<div class="potrow">${S.pot > 0 ? potHtml(S.pot) : ''}${tclockHtml()}</div>`;
  tclockTick();
  if (newHand) prevBoard = 0;
  // Общие карты лежат в контурах на сукне: флоп — три места в общей рамке, тёрн и ривер — каждый в своей.
  const shown = stage ? stage.board : S.board.length; // при олл-ине карты стола выходят по улицам
  const rest = !stage && S.phase === 'idle' && S.result && S.result.rest;
  const slot = (k) => {
    const c = k < shown ? S.board[k] : null;
    if (!c && rest && rest[k - S.board.length]) return cardHtml(rest[k - S.board.length], 'ghost' + (k >= prevBoard ? ' flip' : ''), `animation-delay:${(k - prevBoard) * 110 + 600}ms`);
    const nextSlot = S.waitStreet ? (S.board.length === 0 ? k < 3 : k === S.board.length) : stage && stage.board === 4 && k === 4;
    if (!c) return `<div class="slot${nextSlot ? ' next' : ''}"></div>`; // место под следующую карту пульсирует
    return cardHtml(c, (k >= prevBoard ? 'flip' : '') + winClass(c, win), k >= prevBoard ? `animation-delay:${(k - prevBoard) * 110}ms` : '');
  };
  $('board').innerHTML = `<div class="grp">${slot(0)}${slot(1)}${slot(2)}</div><div class="grp">${slot(3)}</div><div class="grp">${slot(4)}</div>`;
  $('board').hidden = !S.handNo || (!S.running && !S.result); // пока игра не идёт, в центре только кнопки готовности и старта
  prevBoard = rest ? 5 : shown;
  prevHand = S.handNo;


  // Победа: один раз за раздачу фишки из банка летят к победителям.
  if (S.result && S.phase === 'idle' && !stage && wonHand !== S.handNo) {
    wonHand = S.handNo;
    for (const i of winners) flyChips(viewPos(i));
  }

  renderStatus();
  renderFooter();
  renderPause();
  renderTour();
  if (!$('settings').hidden && document.activeElement.tagName !== 'INPUT') renderSettings();
  if (!$('sidePanel').hidden) renderSide();
  if (!$('seatMenu').hidden) renderSeatMenu();

  $('btnReact').hidden = me >= 0; // за столом кнопка реакций живёт на аватарке
  $('btnTable').hidden = !S.you.isHost; // меню «Игра» и «Турнир» — только у админа
  $('btnTour').hidden = !S.you.isHost;
  $('btnTour').classList.toggle('on', tourPhase() !== 'off'); // турнир собирается или идёт
  if (!$('chatPanel').hidden && chatTab === 'log') renderLogFilter();
  if (!$('chatPanel').hidden && chatTab === 'me') renderProfile();
  const myTurn = me >= 0 && S.toAct === me && !S.paused;
  if (myTurn && !wasMyTurn) SND.turn();
  wasMyTurn = myTurn;
}

function renderStatus() {
  const el = $('status');
  if (S.buttonDraw) {
    const winner = S.seats[S.buttonDraw.winner];
    el.innerHTML = '<div class="hint">Жеребьёвка первого батона</div>' +
      (winner ? `<div>Первый дилер — ${esc(winner.name)}</div>` : '') +
      (S.autoDeal ? '<div class="hint" id="drawCountdown"></div>' : '');
    return;
  }
  if (tourPhase() === 'done') {
    const w = S.tour.places.find((p) => p.place === 1);
    el.innerHTML = `<div class="win">Победитель турнира — ${esc(w ? w.name : '')}</div>${S.you.isHost ? '' : '<div class="hint">Ждём решения админа</div>'}`;
    return;
  }
  if (S.result && S.phase === 'idle') {
    if (runoutActive) { el.innerHTML = '<div class="hint">Все в олл-ине — открываем карты</div>'; return; }
    const ghost = S.result.rest ? '<div class="hint">Полупрозрачные карты — что пришло бы дальше</div>' : '';
    // подсказка про полупрозрачные карты — сразу под картами, к которым относится; итог банка ниже
    el.innerHTML = ghost + S.result.pots.filter((p) => !p.refund).map((p) => {
      const names = p.winners.map((i) => (S.seats[i] ? esc(S.seats[i].name) : '—')).join(', ');
      const hand = S.result.showdown && S.result.hands[p.winners[0]] ? ` — ${S.result.hands[p.winners[0]].name}` : '';
      return `<div class="win">${names}: +${fmt(p.amount)}${hand}</div>`;
    }).join('');
  } else if (S.phase !== 'idle') {
    el.innerHTML = '';
  } else if (!S.running) {
    // До старта игроки отмечают готовность, а запускает игру только админ.
    const mine = S.you.seat >= 0 ? S.seats[S.you.seat] : null;
    const players = S.seats.filter(Boolean);
    const ready = players.filter((p) => p.ready || (S.you.isHost && mine && p.id === mine.id)).length;
    const count = `<div class="hint">Готовы ${ready} из ${players.length}</div>`;
    if (S.you.isHost) el.innerHTML = `<button class="primary large" data-cmd="start"${ready >= 2 ? '' : ' disabled'}>Начать игру</button>${count}`;
    else if (!mine) el.innerHTML = `<div>Ждём начала игры</div>${count}`;
    else if (mine.ready) el.innerHTML = `<button class="large" data-cmd="ready" data-value="0">Отменить готовность</button><div class="hint">Вы готовы. Игру начнёт админ.</div>`;
    else el.innerHTML = `<button class="primary large" data-cmd="ready" data-value="1">Готов</button>${count}`;
  } else {
    el.textContent = tourPhase() === 'play' ? 'Турнир начинается…' : 'Ждём игроков с фишками…';
  }
}

// ---------- панель действий ----------
function renderFooter() {
  const me = S.you.seat;
  const s = me >= 0 ? S.seats[me] : null;
  const L = S.legal;
  const free = S.seats.some((x) => !x);
  const key = JSON.stringify([me, S.toAct, S.handNo, S.phase, L, S.pot, S.paused, s && [s.stack, s.sittingOut, s.inHand], prefs.unit, prefs.betUnit, S.cfg.bb, free, raiseOpen, S.rules, S.rebuyReqs, s && s.buyins, S.waitDealer, S.dealerSeat, tourPhase(), S.tour && S.tour.answers, S.tour && S.tour.places, S.askedShow, s && s.showed, runoutActive, runoutStep, S.board.length, S.waitStreet, S.button, S.autoDeal, performance.now() >= streetReady]);
  if (key === footerKey) return;
  footerKey = key;
  const f = $('actions');
  // Тихая панель: подпись (без точки в конце) по центру над кнопкой; без кнопки — просто строка подсказки.
  const top = ''; // ауты при олл-ине — в «Комбинациях», не на столе
  const quiet = (text, buttons) => {
    f.innerHTML = buttons
      ? `<div class="dock quiet">${top}${text ? `<div class="dock-cap">${text}</div>` : ''}<div class="row">${buttons}</div></div>`
      : `<div class="dock quiet">${top}${top && !text ? '' : `<div class="row">${text ? `<span class="hint">${text}</span>` : ''}</div>`}</div>`;
  };
  // кто нажал «Не сейчас», может передумать, пока турнир собирается
  const mine = myTourAnswer();
  const join = (tourPhase() === 'gather' || tourPhase() === 'starting') && !S.you.isHost && mine && !mine.agree;
  const JOIN = '<button class="primary large" data-cmd="tourAnswer" data-agree="1">Участвовать</button>';
  if (!s) {
    const pl = tourPlace(S.you.id);
    if (tourOn()) quiet(pl ? `Вы выбыли · ${pl.place} место · можно смотреть и писать в чат` : tourPhase() === 'done' ? 'Турнир окончен — ждём админа' : 'Идёт турнир — вы наблюдаете');
    else if (join) quiet('Собираем турнир', JOIN);
    else if (free) quiet('Вы наблюдаете за игрой', '<button class="primary large" data-cmd="sit">Сесть за стол</button>');
    else quiet('Вы наблюдаете за игрой · свободных мест нет');
    return;
  }
  // круг торговли закончен — следующую улицу открывает дилер (при олл-ине кнопка появляется после паузы)
  if (S.waitStreet && !S.autoDeal) {
    const street = S.board.length === 0 ? 'флоп' : S.board.length === 3 ? 'тёрн' : 'ривер';
    if (me !== S.button) { quiet(runoutActive ? '' : 'Ждём дилера'); return; }
    if (performance.now() < streetReady) { quiet(''); return; }
    quiet('Вы дилер', `<button class="primary large deal-go" data-cmd="street">Открыть ${street}</button>`);
    return;
  }
  if (runoutActive) { quiet(''); return; } // пока открываются карты олл-ина — ни докупки, ни «Вы выбыли»: не подсказываем итог
  if (L && !S.paused) {
    const tk = `${S.handNo}:${S.phase}:${S.currentBet}`;
    if (tk !== turnKey) { turnKey = tk; raiseTo = L.minTo; raiseOpen = false; }
    raiseTo = Math.min(L.maxTo, Math.max(L.minTo, raiseTo));
    const sizable = L.canRaise && L.minTo < L.maxTo;
    if (raiseOpen && sizable) {
      f.innerHTML = raiseDockHtml(L);
      syncRaise();
      return;
    }
    raiseOpen = false;
    const call = L.canCheck
      ? '<button data-act="check">Чек</button>'
      : L.toCall >= s.stack
        ? `<button class="allin-call" data-act="call">Колл · олл-ин<span>${fmt(L.toCall)}</span></button>` // своим цветом: не обычный колл и не красный «Фолд»
        : `<button data-act="call">Колл<span>${fmt(L.toCall)}</span></button>`;
    let raise = '';
    if (sizable) raise = `<button class="primary" data-raise="open">${S.currentBet ? 'Рейз' : 'Ставка'}</button>`;
    else if (L.canRaise) raise = `<button class="primary" data-act="raise">Олл-ин<span>${fmt(L.maxTo)}</span></button>`;
    f.innerHTML = `<div class="dock"><div class="acts"><button class="danger" data-act="fold">Фолд</button>${call}${raise}</div></div>`;
    return;
  }
  // После раздачи: сбросивший может показать свои карты, победитель — попросить показать.
  const res = S.phase === 'idle' && !runoutActive ? S.result : null;
  let after = '';
  if (res && s.inHand && s.folded && !s.showed) after += '<button class="large" data-cmd="showCards">Показать карты</button>';
  if (res && res.payouts[me] > 0 && !S.askedShow && S.seats.some((x, k) => x && k !== me && x.inHand && x.folded && !x.showed)) after += '<button class="large" data-cmd="askShow">Попросить показать</button>';
  if (S.waitDealer && S.dealerSeat === me && !runoutActive) { // пока открываются карты олл-ина, кнопки нет
    // дилеру — кнопка новой раздачи на месте кнопок хода; стол и борд остаются открытыми для обсуждения
    quiet('Вы дилер', after + '<button class="primary large deal-go" data-cmd="deal">Новая раздача</button>');
    return;
  }
  if (tourOn() && s.stack === 0 && !(s.inHand && S.phase !== 'idle')) {
    const pl = tourPlace(S.you.id);
    quiet(`Вы выбыли${pl ? ` · ${pl.place} место` : ''}`);
    return;
  }
  if (join && !(s.inHand && S.phase !== 'idle')) { quiet('Собираем турнир', JOIN); return; }
  if (s.sittingOut) quiet('Вы пропускаете раздачи', '<button class="primary large" data-cmd="sitout" data-value="0">Вернуться в игру</button>');
  else if (s.stack === 0 && !(s.inHand && S.phase !== 'idle')) {
    // Докупку нельзя взять самому: её выдаёт админ (админу — стол), и только пока не исчерпан лимит.
    const req = S.rebuyReqs.find((r) => r.id === S.you.id);
    const limit = S.rules.rebuyLimit;
    if (req) quiet(req.mode === 'host' ? 'Ждём решения админа о докупке…' : `Ждём согласия стола на докупку · ${req.votes.length}/${req.needed.length}`);
    else if (limit >= 0 && s.buyins - 1 >= limit) quiet('Фишки закончились, лимит докупок исчерпан', '<button class="large" data-cmd="leave">Встать и наблюдать</button>');
    else quiet('Фишки закончились', `<button class="primary large" data-cmd="rebuyRequest">Попросить докупку ${fmt(S.cfg.startStack)}</button>`);
  }
  else if (S.toAct >= 0 && S.seats[S.toAct]) quiet(`Ходит ${esc(S.seats[S.toAct].name)}`);
  else if (after) quiet('Раздача окончена', after);
  else quiet('');
}

// Меню рейза: крупно сумма (под ней ББ и доля банка), ползунок от минимума до олл-ина с шагом в малый блайнд,
// под ним подписи быстрых размеров — нажатие ставит ровно эту сумму, а при перетаскивании ползунок к ним «прилипает».
// Сумма — только на синей кнопке; справа, симметрично «Отмене», — она же в ББ: нажал — ввод в ББ.
function raisePresets(L) {
  const pot = S.pot + L.toCall; // банк после уравнивания
  const clamp = (v) => Math.min(L.maxTo, Math.max(L.minTo, Math.round(v)));
  const list = [
    { k: 'min', label: 'Мин', name: 'минимум', v: L.minTo },
    { k: 'third', label: '⅓', name: 'треть банка', v: clamp(S.currentBet + pot / 3) },
    { k: 'half', label: '½', name: 'полбанка', v: clamp(S.currentBet + pot / 2) },
    { k: 'pot', label: 'Банк', name: 'банк', v: clamp(S.currentBet + pot) },
    { k: 'max', label: 'Олл-ин', name: 'олл-ин', v: L.maxTo },
  ];
  // доли банка, упёршиеся в минимум или олл-ин, не показываем — они совпали бы с краями
  return list.filter((p) => p.k === 'min' || p.k === 'max' || (p.v > L.minTo && p.v < L.maxTo));
}
function raiseDockHtml(L) {
  const ps = raisePresets(L);
  const marks = ps.map((p) => `<button data-size="${p.k}">${p.label}</button>`).join('');
  return `<div class="dock raise">
    <div class="rslider"><input type="range" id="raiseRange" min="${L.minTo}" max="${L.maxTo}" step="any" value="${raiseTo}"></div>
    <div class="rmarks">${marks}</div>
    <div class="acts"><button class="cancel" data-raise="close">Отмена</button><button class="primary" id="raiseBtn" data-act="raise"></button><button class="rbb" id="raiseBB" title="Ввести сумму в больших блайндах"></button><input id="raiseInput" class="rbb" inputmode="decimal" autocomplete="off" hidden></div>
  </div>`;
}
function syncRaise(from) {
  const L = S.legal;
  if (!L) return;
  const btn = $('raiseBtn');
  if (btn) btn.innerHTML = `${raiseTo >= L.maxTo ? 'Олл-ин' : (S.currentBet ? 'Рейз до' : 'Ставка')}<span>${fmt(raiseTo)}</span>`;
  const bbBtn = $('raiseBB');
  if (bbBtn) {
    bbBtn.innerHTML = `${String(+(raiseTo / S.cfg.bb).toFixed(1)).replace('.', ',')} <span>ББ</span>`;
    const ps = raisePresets(L);
    for (const m of document.querySelectorAll('.rmarks button')) { const q = ps.find((x) => x.k === m.dataset.size); m.classList.toggle('on', !!q && q.v === raiseTo); }
  }
  const range = $('raiseRange');
  if (range && from !== 'range') range.value = raiseTo;
  if (range) range.style.setProperty('--p', (((raiseTo - L.minTo) / Math.max(1, L.maxTo - L.minTo)) * 100).toFixed(2) + '%');
}
function setRaise(v, from) {
  const L = S.legal;
  if (!L || !Number.isFinite(v)) return;
  raiseTo = Math.min(L.maxTo, Math.max(L.minTo, Math.round(v)));
  syncRaise(from);
}
function redrawFooter() { footerKey = ''; renderFooter(); }

$('actions').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || !S) return;
  const L = S.legal;
  if (b.dataset.act) {
    cmd('act', { action: b.dataset.act, amount: raiseTo });
  } else if (b.dataset.raise) {
    raiseOpen = b.dataset.raise === 'open';
    if (raiseOpen && L) raiseTo = Math.min(L.maxTo, Math.max(L.minTo, 3 * S.cfg.bb)); // по умолчанию 3 ББ
    redrawFooter();
  } else if (b.dataset.size && L) {
    const p = raisePresets(L).find((x) => x.k === b.dataset.size);
    if (p) setRaise(p.v); // ровно эта сумма
  } else if (b.id === 'raiseBB') {
    const inp = $('raiseInput');
    b.hidden = true; inp.hidden = false; inp.value = String(+(raiseTo / S.cfg.bb).toFixed(1)).replace('.', ','); inp.focus(); inp.select();
  }
});
// ползунок: шаг — малый блайнд от минимума, у края — ровно олл-ин, возле быстрых размеров — прилипает к ним
$('actions').addEventListener('input', (e) => {
  if (e.target.id !== 'raiseRange' || !S.legal) return;
  const L = S.legal;
  const raw = Number(e.target.value);
  const sb = S.cfg.sb || Math.max(1, S.cfg.bb / 2);
  let v = raw >= L.maxTo - sb / 2 ? L.maxTo : L.minTo + Math.round((raw - L.minTo) / sb) * sb;
  const near = raisePresets(L).find((p) => Math.abs(raw - p.v) < (L.maxTo - L.minTo) * 0.025);
  if (near) v = near.v;
  setRaise(v, 'range');
});
// ввод суммы в ББ (2,5 → 2,5 ББ); Enter — применить, Esc — отменить
function applyRaiseInput(ok) {
  const inp = $('raiseInput');
  if (!inp || inp.hidden) return;
  const n = Number(String(inp.value).replace(',', '.').replace(/\s/g, ''));
  if (ok && Number.isFinite(n) && n > 0) setRaise(n * S.cfg.bb);
  inp.hidden = true;
  $('raiseBB').hidden = false;
  syncRaise();
}
$('actions').addEventListener('keydown', (e) => {
  if (e.target.id === 'raiseInput') {
    if (e.key === 'Enter') applyRaiseInput(true);
    else if (e.key === 'Escape') { e.stopPropagation(); applyRaiseInput(false); }
  } else if (e.target.id === 'raiseRange' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault(); // стрелки — ровно на малый блайнд
    const sb = S.cfg.sb || Math.max(1, S.cfg.bb / 2);
    setRaise(e.key === 'ArrowRight' ? Math.min(S.legal.maxTo, raiseTo + sb) : raiseTo - sb);
  }
});
$('actions').addEventListener('focusout', (e) => { if (e.target.id === 'raiseInput') applyRaiseInput(true); });

// Кнопки с data-cmd работают в любом месте страницы.
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-cmd]');
  if (!b) return;
  const data = {};
  if (b.dataset.value !== undefined) data.value = b.dataset.value === '1';
  if (b.dataset.id) data.id = Number(b.dataset.id);
  if (b.dataset.agree !== undefined) data.agree = b.dataset.agree === '1';
  if (b.dataset.confirm && !confirm(b.dataset.confirm)) return;
  cmd(b.dataset.cmd, data);
});

// ---------- таймер хода: кольцо вокруг аватарки ----------
function tick() {
  if (S?.buttonDraw && S.autoDeal) {
    const counter = $('drawCountdown');
    const ms = S.paused ? S.buttonDraw.remainingMs : drawDeadline - performance.now();
    const text = 'До первой раздачи · ' + Math.max(0, Math.ceil(ms / 1000)) + ' с';
    if (counter && counter.textContent !== text) counter.textContent = text;
  }
  if (S && tourPhase() === 'play' && !S.paused) {
    const text = infoText(); // обратный отсчёт до роста блайндов
    if ($('info').textContent !== text) $('info').textContent = text;
    tclockTick();
  }
  if (S && S.toAct >= 0) {
    const ring = document.querySelector('.seat.turn .prog');
    if (ring) {
      const left = S.paused ? S.turnLeft : Math.max(0, deadline - performance.now());
      const part = S.turnTotal ? Math.min(1, left / S.turnTotal) : 1; // без ограничения времени кольцо стоит полным
      ring.style.strokeDashoffset = RING * (1 - part);
      ring.style.stroke = part > 0.5 ? '#30d158' : part > 0.2 ? '#ffd60a' : '#ff453a';
    }
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ---------- пауза и запросы ----------
// Запрос, который ждёт решения (пауза или докупка), показывается крупной карточкой под верхней панелью.
// Сама пауза — окно по центру поверх затемнённого стола, чтобы её видели все.
function renderPause() {
  const bar = $('askBar');
  const r = S.pauseReq;
  const seated = S.you.seat >= 0;
  const card = (title, sub, buttons) => `<div class="ask-t">${title}</div><div class="ask-s">${sub}</div>${buttons}`;
  if (r && !S.paused) {
    const who = S.people.find((p) => p.id === r.by);
    const voted = r.votes.includes(S.you.id);
    const count = `Согласны ${r.votes.filter((id) => r.needed.includes(id)).length} из ${r.needed.length}`;
    bar.innerHTML = card(`${esc(who ? who.name : 'Игрок')} просит паузу`, count, seated && !voted
      ? '<div class="acts"><button class="primary" data-cmd="pauseVote" data-agree="1">Согласен</button><button data-cmd="pauseVote" data-agree="0">Против</button></div>'
      : '<div class="wait">Ждём остальных игроков</div>');
    bar.hidden = false;
  } else {
    // Запрос докупки показывается тому, кто его решает: админу или игрокам за столом.
    const ask = S.rebuyReqs.find((q) => q.id !== S.you.id && q.needed.includes(S.you.id) && !q.votes.includes(S.you.id));
    const who = ask && S.seats.find((p) => p && p.id === ask.id);
    if (ask && who) {
      const host = ask.mode === 'host';
      bar.innerHTML = card(`${esc(who.name)} просит докупку ${fmt(S.cfg.startStack)}`, `Уже докупок: ${who.buyins - 1}`,
        `<div class="acts"><button class="primary" data-cmd="rebuyAnswer" data-id="${ask.id}" data-agree="1">${host ? 'Выдать' : 'Согласен'}</button><button data-cmd="rebuyAnswer" data-id="${ask.id}" data-agree="0">${host ? 'Отказать' : 'Против'}</button></div>`);
      bar.hidden = false;
    } else {
      bar.hidden = true;
    }
  }
  $('pauseOverlay').hidden = !S.paused;
  $('pauseText').textContent = (S.pausedBy ? `По просьбе игрока ${S.pausedBy}. ` : '') + 'Время хода остановлено.' + (seated ? '' : ' Продолжить может любой игрок за столом.');
  $('btnResume').hidden = !seated && !S.you.isHost;
  $('btnPause').disabled = (!seated && !S.you.isHost) || S.paused || (!!r && !S.you.isHost);
  $('btnPause').title = S.you.isHost ? 'Поставить паузу' : 'Попросить паузу';
}$('btnPause').onclick = () => cmd('pauseRequest');
$('btnResume').onclick = () => cmd('resume');

// ---------- турнир: приглашение, окно админа, итоги ----------
// Приглашение видят все, кто в игре; кто сейчас разыгрывает свою раздачу, увидит его, когда она кончится.
function tourRow(p, right, num) {
  return `<div class="line prow${p.id === S.you.id ? ' me' : ''}">${num != null ? `<span class="num${num === 1 ? ' gold' : ''}">${num}</span>` : ''}<span class="pav">${avatarHtml(p.avatar)}</span><div class="grow"><div class="pn">${esc(p.name)}${p.id === S.you.id ? ' (вы)' : ''}</div></div>${right}</div>`;
}
function tourPeople() {
  const t = S.tour;
  const rank = (p) => { const a = t.answers.find((x) => x.id === p.id); return a ? (a.agree ? 0 : 2) : 1; };
  return S.people.slice().sort((a, b) => rank(a) - rank(b)).map((p) => {
    const a = t.answers.find((x) => x.id === p.id);
    let right;
    if (p.id === S.you.id && S.you.isHost) right = `<button class="switch${a && a.agree ? ' on' : ''}" data-cmd="tourAnswer" data-agree="${a && a.agree ? 0 : 1}" title="Участвую сам"></button>`;
    else if (a) right = a.agree ? '<span class="tst ok">Участвует</span>' : '<span class="tst">Не сейчас</span>';
    else right = `<span class="tst">${p.connected ? 'Думает…' : 'Не в сети'}</span>`;
    return tourRow(p, right);
  }).join('');
}
function renderTour() {
  const t = S.tour;
  const me = S.you.seat >= 0 ? S.seats[S.you.seat] : null;
  const busy = me && me.inHand && !me.folded && S.phase !== 'idle';
  const mine = myTourAnswer();
  let mode = '';
  if (t && (t.phase === 'gather' || t.phase === 'starting') && !busy) mode = S.you.isHost ? 'host' : !mine ? 'invite' : mine.agree ? 'wait' : '';
  else if (t && t.phase === 'done' && (S.you.isHost || tourSeen !== t.id)) mode = 'done';
  const key = JSON.stringify([mode, t && [t.phase, t.answers, t.places, t.mins, t.estimate], mode === 'host' || mode === 'wait' ? S.people : 0]);
  if (key === tourKey) return;
  tourKey = key;
  $('tourOverlay').hidden = !mode;
  if (!mode) return;
  const chip = (cls) => `<div class="win-ic ${cls}"><svg viewBox="0 0 32 32"><use href="#winchip"/></svg></div>`;
  const icon = chip('still'); // знак турнира — золотая фишка; в окне победы она влетает и светится
  const yes = t.answers.filter((a) => a.agree && S.people.some((p) => p.id === a.id)).length;
  const val = (label, v) => `<div class="line"><span class="grow">${label}</span><span class="tst">${v}</span></div>`;
  let h = '';
  if (mode === 'invite') {
    h = `${icon}<h2>Турнир</h2><p>Все начинают с равными фишками</p>
      <div class="group">${val('Блайнды', `растут каждые ${t.mins} мин`)}${val('Стек', `${fmt(t.stack, 'chips')} · ${t.rebuy ? 'докупок ' + t.rebuy : 'без докупок'}`)}${val('Займёт', `около ${minutes(t.estimate)}`)}</div>
      <div class="acts"><button data-cmd="tourAnswer" data-agree="0">Не сейчас</button><button class="primary" data-cmd="tourAnswer" data-agree="1">Участвую</button></div>`;
  } else if (mode === 'wait') {
    h = `${icon}<h2>Вы участвуете</h2><p>${t.phase === 'starting' ? 'Турнир начнётся после текущей раздачи' : 'Ждём, когда админ начнёт турнир'}</p>
      <div class="group">${tourPeople()}</div>
      <div class="acts"><button data-cmd="tourAnswer" data-agree="0">Не участвовать</button></div>`;
  } else if (mode === 'host') {
    const starting = t.phase === 'starting';
    h = `${icon}<h2>Турнир</h2><p>Блайнды растут каждые ${t.mins} мин · участвуют ${yes} из ${S.people.length}</p>
      <div class="group">${tourPeople()}</div>
      <div class="acts"><button data-cmd="tourCancel">Отменить</button><button class="primary" data-cmd="tourStart"${yes >= 2 && !starting ? '' : ' disabled'}>${starting ? 'После раздачи…' : 'Начать турнир'}</button></div>`;
  } else {
    const places = t.places.slice().sort((a, b) => a.place - b.place);
    h = `${chip('glow')}<h2 class="solo">Турнир окончен</h2>
      <div class="group">${places.map((p) => tourRow(p, `<span class="tst${p.place === 1 ? ' gold' : ''}">${p.place === 1 ? 'Победитель' : p.place + ' место'}</span>`, p.place)).join('')}</div>
      <div class="acts">${S.you.isHost
        ? '<button data-cmd="tourEnd">Вернуться к игре</button><button class="primary" data-cmd="tourGather">Новый турнир</button>'
        : `<button class="primary" data-tourclose="${t.id}">Закрыть</button>`}</div>`;
  }
  $('tourBody').innerHTML = h;
  if (mode === 'done' && confettiFor !== t.id) { confettiFor = t.id; confetti($('confetti')); }
}
// Конфетти за окном итогов турнира: бумажки идут сверху по всей ширине, пока окно открыто.
let confettiFor = 0;
function confetti(cv) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const g = cv.getContext('2d');
  const COLORS = ['#ffd60a', '#0a84ff', '#30d158', '#ff453a', '#bf5af2', '#ff9f0a', '#64d2ff', '#ffffff'];
  let W = 0, H = 0;
  const fit = () => {
    if (W === cv.clientWidth && H === cv.clientHeight) return;
    const dpr = window.devicePixelRatio || 1;
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  fit();
  const piece = (y) => ({ x: Math.random() * W, y, vy: 70 + Math.random() * 90, sway: Math.random() * 6.3, swing: 15 + Math.random() * 35,
    w: 6 + Math.random() * 5, h: 9 + Math.random() * 6, r: Math.random() * 6.3, vr: (Math.random() - 0.5) * 5,
    flip: Math.random() * 6.3, vf: 3 + Math.random() * 6, c: COLORS[Math.floor(Math.random() * COLORS.length)], round: Math.random() < 0.25 });
  const density = () => Math.round(W * H / 9000); // сколько бумажек в воздухе одновременно
  const bits = [];
  for (let i = 0; i < density(); i++) bits.push(piece(-Math.random() * H)); // первые уже на подлёте, сверху
  let last = performance.now();
  (function frame(now) {
    if ($('tourOverlay').hidden || tourPhase() !== 'done') { g.clearRect(0, 0, W, H); return; }
    fit();
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    const time = now / 1000;
    g.clearRect(0, 0, W, H);
    for (let i = 0; i < bits.length; i++) {
      const b = bits[i];
      b.y += b.vy * dt;
      b.r += b.vr * dt; b.flip += b.vf * dt;
      if (b.y > H + 20) { bits[i] = piece(-20); continue; } // упала — новая сверху
      const x = b.x + Math.sin(time * 1.6 + b.sway) * b.swing;
      g.save();
      g.translate(x, b.y); g.rotate(b.r); g.scale(1, Math.cos(b.flip));
      g.fillStyle = b.c;
      if (b.round) { g.beginPath(); g.arc(0, 0, b.w / 2, 0, 6.3); g.fill(); } else g.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      g.restore();
    }
    requestAnimationFrame(frame);
  })(last);
}
$('tourBody').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tourclose]');
  if (!b) return;
  tourSeen = Number(b.dataset.tourclose);
  renderTour();
});

// ---------- сообщения и реакции у аватарок ----------
function seatPosOfPlayer(id) {
  if (!S) return -1;
  const i = S.seats.findIndex((s) => s && s.id === id);
  return i < 0 ? -1 : viewPos(i);
}
function fxAt(v, cls, content, ms) {
  const el = document.createElement('div');
  el.className = cls;
  if (cls === 'reaction') el.innerHTML = reactionSvg(content); else el.textContent = content;
  if (cls === 'bubble' && v === 0) {
    // своё место: облачко справа от аватарки (слева на ней кнопка реакций, сверху карты)
    el.className += ' side-right';
    el.style.left = `calc(${POS[v][0]}% + 62px)`; // правее значка блайнда (он висит у аватарки на 20 px наружу)
    el.style.top = `calc(${POS[v][1]}% + 22px)`;
  } else if (cls === 'bubble' && v === 3) {
    // верхнее место: облачко слева от аватарки (справа карты, сверху край экрана)
    el.className += ' side-left';
    el.style.left = `calc(${POS[v][0]}% - 62px)`; // левее значка блайнда
    el.style.top = `calc(${POS[v][1]}% - 20px)`;
  } else {
    el.style.left = POS[v][0] + '%';
    // реакция встаёт по центру аватарки, облачко — над ней
    el.style.top = cls === 'reaction' ? `calc(${POS[v][1]}% ${v === 0 ? '+ 28px' : '- 20px'})` : `calc(${POS[v][1]}% - 64px)`;
  }
  if (cls === 'bubble') for (const old of $('fx').querySelectorAll(`.bubble[data-v="${v}"]`)) old.remove();
  el.dataset.v = v;
  $('fx').appendChild(el);
  if (cls === 'bubble') {
    // длинное облачко у верхних мест не должно уходить под шапку и закрывать её значки
    const head = document.querySelector('header');
    const over = head ? head.getBoundingClientRect().bottom + 8 - el.getBoundingClientRect().top : 0;
    if (over > 0) {
      const k = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--k')) || 1;
      el.style.top = `calc(${el.style.top.replace(/^calc\((.*)\)$/, '$1')} + ${Math.ceil(over / k)}px)`;
    }
  }
  setTimeout(() => el.remove(), ms);
  return el;
}
function showReaction(r) {
  if (!Object.prototype.hasOwnProperty.call(REACTIONS, r.emoji)) return;
  const v = seatPosOfPlayer(r.from);
  if (v >= 0) { fxAt(v, 'reaction', r.emoji, 2800); return; }
  const who = S && S.people.find((p) => p.id === r.from); // наблюдатель: реакция идёт в чат
  if (who) addNote({ kind: 'chat', from: r.from, name: who.name, avatar: who.avatar, text: REACTIONS[r.emoji][0], reaction: r.emoji }, false);
}

// ---------- чат и ход игры ----------
// В чате только сообщения игроков. Действия игроков по улицам идут во вкладку «Ход игры»;
// служебные события (кто сел, кто вышел) туда не попадают, чтобы не шуметь.
let chatTab = 'chat';
const PCOLORS = ['#0a84ff', '#ff9f0a', '#30d158', '#bf5af2', '#ff375f', '#64d2ff']; // цвет игрока = номер его места
const STREETS = { preflop: 'Префлоп', flop: 'Флоп', turn: 'Тёрн', river: 'Ривер' };
const HAND_ACTS = new Set(['deal', 'blind', 'fold', 'check', 'call', 'raise', 'street', 'show', 'win', 'level', 'bust', 'tourstart', 'tourend']);
let gameNotes = [];
let logPlayer = 0; // 0 — все игроки, иначе id выбранного игрока
function pColor(pid) {
  const i = S ? S.seats.findIndex((s) => s && s.id === pid) : -1;
  return i >= 0 ? PCOLORS[i] : '#8e8e93';
}
function moveText(n) {
  const amt = n.amount ? ' ' + fmt(n.amount) : '';
  const words = { sb: 'Малый блайнд', bb: 'Большой блайнд', fold: 'Фолд', check: 'Чек', call: 'Колл', bet: 'Ставка', raise: 'Рейз до' };
  return (words[n.move || n.act] || n.text) + amt;
}
function renderGameLog() {
  const el = $('gameLog');
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  let h = '';
  for (const n of gameNotes) {
    if (n.act === 'deal') { h += `<div class="handhd">Раздача ${n.hand}</div><div class="street"><span>Префлоп</span></div>`; continue; }
    if (n.act === 'street') { h += `<div class="street"><span>${STREETS[n.street]}</span><div class="cc">${n.board.map((c) => cardHtml(c, 'xs')).join('')}</div></div>`; continue; }
    if (n.act === 'level') { h += `<div class="lw lvl">Блайнды растут: ${fmt(n.sb, 'chips')}/${fmt(n.bb, 'chips')}</div>`; continue; }
    if (n.act === 'bust') { h += `<div class="lw out">${esc(n.name)} выбывает · ${n.place} место</div>`; continue; }
    if (n.act === 'tourstart' || n.act === 'tourend') { h += `<div class="lw lvl">${esc(n.text)}</div>`; continue; }
    if (n.act === 'win') { h += `<div class="lw">${esc(n.names || '')} ${n.split ? 'делят' : 'забирает'} ${fmt(n.amount)}${n.handName ? ' · ' + n.handName : ''}</div>`; continue; }
    if (logPlayer && n.pid !== logPlayer) continue;
    const style = `style="--pc:${pColor(n.pid)}"`;
    if (n.act === 'show') {
      h += `<div class="la show" ${style}><i></i><b>${esc(n.name)}</b><span class="mv">Показал</span><span class="cc">${n.cards.map((c) => cardHtml(c, 'xs')).join('')}</span><span class="hn">${n.handName}</span></div>`;
      continue;
    }
    const mv = n.move || n.act;
    h += `<div class="la ${mv}${n.allIn ? ' allin' : ''}" ${style}><i></i><b>${esc(n.name || '')}</b><span class="mv">${moveText(n)}${n.allIn ? ' · олл-ин' : ''}${n.timeout ? ' · время вышло' : ''}</span></div>`;
  }
  el.innerHTML = h || '<div class="empty">Игра ещё не началась</div>';
  if (atBottom) el.scrollTop = el.scrollHeight;
}
function renderLogFilter() {
  if (!S) return;
  const players = S.seats.filter(Boolean);
  if (logPlayer && !players.some((p) => p.id === logPlayer)) logPlayer = 0;
  $('logFilter').innerHTML = `<button data-lp="0" class="${logPlayer ? '' : 'on'}">Все</button>` +
    players.map((p) => `<button data-lp="${p.id}" class="${logPlayer === p.id ? 'on' : ''}" style="--pc:${pColor(p.id)}"><i></i>${esc(p.name)}</button>`).join('');
}
function addNote(n, silent) {
  if (n.kind !== 'chat') {
    if (HAND_ACTS.has(n.act)) {
      gameNotes.push(n);
      if (gameNotes.length > 1200) gameNotes.shift();
      if (!silent) renderGameLog();
    }
    if (!silent && n.act && SND[n.act]) SND[n.act]();
    if (!silent && n.act === 'level') levelBanner(n);
    // Реплика игрока на ход — как будто он сказал это вслух. Все системные облачка синие, белые — только чат;
    // олл-ин объявляется своим красным облачком; фолд — без облачка.
    if ((n.act === 'call' || n.act === 'raise') && n.allIn && n.amount) allInAmt.set(n.hand + ':' + n.pid, n.amount); // для облачка «Олл-ин 1 250»
    if (!silent && (n.act === 'check' || n.act === 'call' || n.act === 'raise') && !n.allIn) {
      const v = seatPosOfPlayer(n.pid);
      const amt = n.amount ? ' ' + fmt(n.amount) : '';
      const say = { check: 'Чек', call: 'Колл' + amt, bet: 'Ставка' + amt, raise: 'Рейз до' + amt }[n.move || n.act];
      if (v >= 0 && say) fxAt(v, 'bubble', say, 1800).classList.add('act'); // синие, как все системные: белые — только чат
    }
    return;
  }
  const p = document.createElement('div');
  p.className = 'msg' + (S && n.from === S.you.id ? ' mine' : '');
  p.innerHTML = `<div class="who">${avatarHtml(n.avatar, 'mini')}${esc(n.name)}</div><div class="text${n.reaction ? ' rx-msg' : ''}">${n.reaction ? reactionSvg(n.reaction) : esc(n.text)}</div>`;
  const log = $('chatLog');
  const empty = log.querySelector('.empty');
  if (empty) empty.remove();
  log.appendChild(p);
  while (log.children.length > 300) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
  if (silent) return;
  const v = seatPosOfPlayer(n.from);
  if (v >= 0) fxAt(v, 'bubble', n.text.length > 70 ? n.text.slice(0, 70) + '…' : n.text, 5000);
  if ($('chatPanel').hidden || chatTab !== 'chat') { unread++; $('unread').textContent = unread; $('unread').hidden = false; }
  if (!S || n.from !== S.you.id) SND.msg();
}
function clearLogs() {
  $('chatLog').innerHTML = '<div class="empty">Сообщений пока нет</div>';
  gameNotes = [];
  renderGameLog();
}
function showChatTab(tab) {
  chatTab = tab;
  for (const b of document.querySelectorAll('#chatPanel [data-ctab]')) b.classList.toggle('on', b.dataset.ctab === tab);
  $('chatLog').hidden = tab !== 'chat';
  $('gameLog').hidden = tab !== 'log';
  $('logFilter').hidden = tab !== 'log';
  $('chatForm').hidden = tab !== 'chat';
  $('profile').hidden = tab !== 'me';
  if (tab === 'log') { renderLogFilter(); renderGameLog(); }
  if (tab === 'me') { renderProfile(true); $('profile').scrollTop = 0; return; }
  const log = $(tab === 'chat' ? 'chatLog' : 'gameLog');
  log.scrollTop = log.scrollHeight;
  if (tab === 'chat' && !$('chatPanel').hidden) { unread = 0; $('unread').hidden = true; $('chatInput').focus(); }
}
function toggleChat(open) {
  $('chatPanel').hidden = !open;
  $('game').classList.toggle('chat', open);
  if (open) showChatTab(chatTab);
  syncNav();
}$('chatPanel').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ctab]');
  if (b) { showChatTab(b.dataset.ctab); return; }
  const lp = e.target.closest('[data-lp]');
  if (lp) { logPlayer = Number(lp.dataset.lp); renderLogFilter(); renderGameLog(); }
});
$('btnChat').onclick = () => toggleChat($('chatPanel').hidden);
$('chatClose').onclick = () => toggleChat(false);
$('chatForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('chatInput').value.trim();
  if (text) cmd('chat', { text });
  $('chatInput').value = '';
});

// ---------- вкладка «Профиль»: ник и аватарка, своя статистика, свои реакции, личные настройки ----------
let profEdit = null; // { name, avatar } — пока игрок меняет ник и аватарку
let rxEdit = false;  // раскрыт ли выбор реакций
let profKey = '';
function renderProfile(force) {
  if (!S) return;
  const seat = S.you.seat >= 0 ? S.seats[S.you.seat] : null;
  const key = JSON.stringify([S.you.name, S.you.avatar, S.you.isHost, !!seat, profEdit, rxEdit, prefs, S.people.map((p) => p.avatar)]);
  if (!force && key === profKey) return;
  if (!force && document.activeElement && document.activeElement.id === 'profNick') return; // не сбивать набор ника
  profKey = key;
  const on = (c) => (c ? ' class="on"' : '');
  const role = S.you.isHost ? 'админ' : seat ? 'за столом' : 'наблюдает';
  let h = `<div class="prof"><span class="pav">${avatarHtml(S.you.avatar)}</span><div class="grow"><div class="pn">${esc(S.you.name)}</div><div class="ps">${role}</div></div>${profEdit ? '' : '<button data-prof="edit">Изменить</button>'}</div>`;
  if (profEdit) {
    // аватарку можно взять только свободную: занятые другими игроками не показываем
    const taken = new Set(S.people.filter((p) => p.id !== S.you.id).map((p) => p.avatar));
    h += `<span class="caption">Ник</span><input id="profNick" maxlength="14" autocomplete="off" value="${esc(profEdit.name)}">`;
    h += '<span class="caption">Аватарка · свободные</span><div class="avatars">' +
      AVATARS.filter((a) => !taken.has(a)).map((a) => `<button type="button" data-pav="${esc(a)}"${on(a === profEdit.avatar)}>${avatarHtml(a)}</button>`).join('') + '</div>';
    h += '<div class="acts prof-acts"><button data-prof="cancel">Отмена</button><button class="primary" data-prof="save">Сохранить</button></div>';
  }
  // Реакции: свёрнуто — шесть своих в строку и «Изменить»; развёрнуто — весь набор, отмечаются до шести.
  h += '<span class="caption">Мои реакции</span>';
  if (!rxEdit) {
    h += `<div class="group"><div class="line"><div class="rx-row grow">${prefs.reactions.map((id) => `<span title="${REACTIONS[id][0]}">${reactionSvg(id)}</span>`).join('')}</div><button data-prof="rx">Изменить</button></div></div>`;
  } else {
    h += '<div class="rx-pick">' + Object.keys(REACTIONS).map((id) => { const k = prefs.reactions.indexOf(id); return `<button data-rx="${id}"${on(k >= 0)} title="${REACTIONS[id][0]}">${reactionSvg(id)}${k >= 0 ? `<b class="rx-n">${k + 1}</b>` : ''}</button>`; }).join('') + '</div>';
    h += `<div class="acts prof-acts"><button class="primary" data-prof="rxdone">Готово · ${prefs.reactions.length} из 6</button></div>`;
  }
  h += '<span class="caption">На вашем экране</span><div class="group">';
  h += `<div class="line"><span class="grow">Суммы</span><div class="seg"><button data-unit="chips"${on(prefs.unit === 'chips')}>Фишки</button><button data-unit="bb"${on(prefs.unit === 'bb')}>Блайнды</button></div></div>`;
  h += '<div class="line stack"><span>Размер</span><div class="seg wide">' + ZOOMS.map((z) => `<button data-zoom="${z[0]}"${on((prefs.zoom || 1) === z[0])}>${z[1]}</button>`).join('') + '</div></div>';
  h += `<div class="line"><span class="grow">Звук</span><button class="switch${prefs.sound ? ' on' : ''}" data-sound title="Звук"></button></div>`;
  h += '</div>';
  $('profile').innerHTML = h;
}
$('profile').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b || !S) return;
  const nick = $('profNick');
  if (b.dataset.prof === 'edit') { profEdit = { name: S.you.name, avatar: S.you.avatar }; renderProfile(true); $('profNick').focus(); }
  else if (b.dataset.prof === 'cancel') { profEdit = null; renderProfile(true); }
  else if (b.dataset.prof === 'rx') { rxEdit = true; renderProfile(true); }
  else if (b.dataset.prof === 'rxdone') { rxEdit = false; renderProfile(true); }
  else if (b.dataset.prof === 'save') {
    const ok = await cmd('profile', { name: nick ? nick.value : profEdit.name, avatar: profEdit.avatar });
    if (ok) { profEdit = null; toast('Профиль обновлён', true); }
    renderProfile(true);
  } else if (b.dataset.pav) { profEdit = { name: nick ? nick.value : profEdit.name, avatar: b.dataset.pav }; renderProfile(true); }
  else if (b.dataset.rx) {
    const id = b.dataset.rx;
    const has = prefs.reactions.includes(id);
    if (has && prefs.reactions.length === 1) { toast('Нужна хотя бы одна реакция'); return; }
    if (!has && prefs.reactions.length >= 6) { toast('Можно выбрать шесть — сначала снимите одну'); return; }
    const next = has ? prefs.reactions.filter((x) => x !== id) : prefs.reactions.concat(id);
    prefs.reactions = next; // порядок выбора = порядок на дуге слева направо
    savePrefs();
    renderReactPop();
    renderProfile(true);
  } else if (b.dataset.unit) { prefs.unit = b.dataset.unit; prefs.betUnit = b.dataset.unit; savePrefs(); render(); renderProfile(true); }
  else if (b.dataset.zoom) { prefs.zoom = Number(b.dataset.zoom); savePrefs(); fitScale(); renderProfile(true); }
  else if (b.dataset.sound !== undefined) { prefs.sound = !prefs.sound; savePrefs(); renderProfile(true); if (prefs.sound) SND.call(); }
});
$('profile').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'profNick') $('profile').querySelector('[data-prof="save"]').click(); });

// ---------- левая панель «Стол»: игроки и комбинации ----------
const COMBOS = [
  ['Роял-флеш', 'As Ks Qs Js Ts', 5],
  ['Стрит-флеш', '9h 8h 7h 6h 5h', 5],
  ['Каре', 'Qs Qh Qd Qc 7s', 4],
  ['Фулл-хаус', 'Ks Kh Kd 8c 8s', 5],
  ['Флеш', 'Ad Jd 8d 6d 3d', 5],
  ['Стрит', 'Ts 9h 8d 7c 6s', 5],
  ['Сет', '7s 7h 7d Kc 4s', 3],
  ['Две пары', 'Js Jh 5d 5c As', 4],
  ['Пара', 'As Ah 9d 6c 3s', 2],
  ['Старшая карта', 'Ks Jh 8d 5c 2s', 1],
];
function playersHtml() {
  const seated = S.seats.filter(Boolean).sort((a, b) => b.stack - a.stack); // по размеру стека
  const tour = tourOn();
  // в турнире выбывшие идут отдельной группой со своими местами
  const out = tour ? S.tour.places.filter((p) => !S.seats.some((x) => x && x.id === p.id)).sort((a, b) => a.place - b.place) : [];
  const away = S.people.filter((p) => !p.seated && !out.some((o) => o.id === p.id));
  const watching = away.filter((p) => p.connected);
  const offline = away.filter((p) => !p.connected); // ушли, но помнятся: вернутся под своим ником со своими фишками
  const kick = (p) => (S.you.isHost && p.id !== S.you.id
    ? `<button class="icon pm" data-pmenu="${p.id}" title="Убрать игрока">${ICON.close}</button>`
    : S.you.isHost ? '<span class="icon-ph"></span>' : ''); // у админа своя строка без «⋯», но колонка стека стоит ровно
  let h = '<span class="caption">За столом</span>';
  if (!seated.length) h += '<div class="group"><div class="line hint">Пока никого</div></div>';
  else {
    h += '<div class="group">';
    for (const p of seated) {
      const net = p.net; // считает сервер: фишки на руках и в текущем банке минус всё полученное
      const notes = [];
      const hidden = runoutActive && curStage && curStage.eq[S.seats.indexOf(p)] != null; // пока открываются карты олл-ина — итог не подсказываем
      if (hidden) {
        h += `<div class="line prow${p.id === S.you.id ? ' me' : ''}"><span class="num">${seated.indexOf(p) + 1}</span><span class="pav">${avatarHtml(p.avatar)}</span><div class="grow"><div class="pn">${esc(p.name)}${p.id === S.you.id ? ' (вы)' : ''}</div><div class="ps">Олл-ин</div></div><div class="pr"><b>—</b></div>${kick(p)}</div>`;
        continue;
      }
      if (p.sittingOut) notes.push('пропускает');
      if (!p.connected) notes.push('не в сети');
      if (tour) {
        const pl = tourPlace(p.id);
        if (pl) notes.push(pl.place === 1 ? 'победитель' : `${pl.place} место`);
        else notes.push('в игре');
      } else {
        if (S.rebuyReqs.some((r) => r.id === p.id)) notes.push('просит докупку');
        if (p.buyins > 1 || S.rules.rebuyLimit >= 0) notes.push(`докупки ${p.buyins - 1}${S.rules.rebuyLimit >= 0 ? '/' + S.rules.rebuyLimit : ''}`);
        // Стек — только фишки на руках: поставленное в банк из него уже вычтено. Показываем в фишках и в ББ.
        notes.push(`<span class="${net >= 0 ? 'plus' : 'minus'}">${net > 0 ? '+' : ''}${fmt(net, 'chips')}</span>`);
      }
      h += `<div class="line prow${p.id === S.you.id ? ' me' : ''}"><span class="num">${seated.indexOf(p) + 1}</span><span class="pav">${avatarHtml(p.avatar)}</span>
        <div class="grow"><div class="pn">${esc(p.name)}${p.id === S.you.id ? ' (вы)' : ''}</div><div class="ps">${cap(notes.join(' · '))}</div></div>
        <div class="pr"><b>${fmt(p.stack, 'chips')}</b><small>${fmt(p.stack, 'bb')}</small></div>${kick(p)}</div>`;
    }
    h += '</div>';
  }
  if (out.length) {
    h += '<span class="caption">Выбыли</span><div class="group">';
    for (const p of out) {
      h += `<div class="line prow${p.id === S.you.id ? ' me' : ''}"><span class="num">${p.place}</span><span class="pav">${avatarHtml(p.avatar)}</span><div class="grow"><div class="pn">${esc(p.name)}${p.id === S.you.id ? ' (вы)' : ''}</div><div class="ps">${p.place} место</div></div>${S.you.isHost ? '<span class="icon-ph"></span>' : ''}</div>`;
    }
    h += '</div>';
  }
  if (watching.length) {
    h += '<span class="caption">Наблюдают</span><div class="group">';
    for (const p of watching) {
      h += `<div class="line prow"><span class="pav">${avatarHtml(p.avatar)}</span><div class="grow"><div class="pn">${esc(p.name)}${p.id === S.you.id ? ' (вы)' : ''}</div><div class="ps">Смотрит игру</div></div>${kick(p)}</div>`;
    }
    h += '</div>';
  }
  if (offline.length) {
    // строка как у сидящих: стек справа, «+/−» в подписи — чтобы было видно, с чем человек вернётся
    h += '<span class="caption">Не в сети · вернутся под своим ником</span><div class="group">';
    for (const p of offline) {
      const c = p.chips;
      const sub = c && !tour ? `<span class="${c.net >= 0 ? 'plus' : 'minus'}">${c.net > 0 ? '+' : ''}${fmt(c.net, 'chips')}</span>` : 'Не в сети';
      const right = c && !tour ? `<div class="pr"><b>${fmt(c.stack, 'chips')}</b><small>${fmt(c.stack, 'bb')}</small></div>` : '';
      h += `<div class="line prow off"><span class="pav">${avatarHtml(p.avatar)}</span><div class="grow"><div class="pn">${esc(p.name)}</div><div class="ps">${sub}</div></div>${right}${kick(p)}</div>`;
    }
    h += '</div>';
  }
  // админу — управление данными игроков прямо здесь, рядом со списком (раньше было в меню «Игра»)
  if (S.you.isHost && !tour) { // в турнире статистику не сбрасывают — блока нет
    const row = (label, control) => `<div class="line"><span class="grow">${label}</span>${control}</div>`;
    h += '<span class="caption">Управление · админ</span><div class="group">';
    if (offline.length) h += row('Не в сети', `<button data-cmd="purgeOffline" data-confirm="Убрать всех, кто не в сети (${offline.length})? Их фишки и докупки забудутся, ники и аватарки освободятся.">Убрать всех</button>`);
    h += row('Статистика', '<button data-cmd="resetResults" data-confirm="Сбросить статистику? Фишки у всех останутся, а «+/−», счётчик докупок и кубки победителей турниров начнутся заново.">Сбросить</button>');
    h += '</div>';
  }
  return h; // блайнды здесь не дублируем: они в шапке и на столе
}
// Справочник комбинаций. Во время раздачи он же подсказывает по вашим картам (S.hint с сервера):
// собранная комбинация выделена и показывает ваши настоящие карты, у близких написано, скольких карт
// не хватает, уже недостижимые бледнеют. Высота строк при этом не меняется.
// «Комбинации»: в раздаче сначала ваша рука — что собрано сейчас и чем её усилить следующей картой (стопки тех самых
// карт), при олл-ине — шансы и ауты. Полный справочник тогда свёрнут в строку «Все комбинации». Вне раздачи — сразу справочник.
let combosOpen = false;
function combosHtml() {
  const hint = S && S.hint;
  let h = '';
  let focus = false;
  if (runoutActive) { h += allInHtml(curStage); focus = true; }
  else if (S && S.phase === 'idle' && S.result && S.result.runout) {
    const o = outsDockHtml(null); // карты открыты: «Пришла ваша карта» видно до конца раздачи
    if (o) { h += `<span class="caption">Олл-ин</span><div class="group outsbox">${o}</div>`; focus = true; }
  }
  if (hint) {
    focus = true;
    h += `<div class="group hero"><div class="hs">У вас сейчас</div><div class="hn">${COMBOS[9 - hint.made][0]}</div><div class="hc">${hint.five.map((c) => cardHtml(c, 'xs' + (hint.core.includes(c) ? '' : ' dimc'))).join('')}</div></div>`;
    const cats = Object.keys(hint.outs || {}).map(Number).filter((c) => hint.outs[c].length).sort((x, y) => y - x);
    const total = cats.reduce((s, c) => s + hint.outs[c].length, 0);
    if (total) {
      h += `<span class="caption">Усилят следующей картой · ${total}</span><div class="group">`;
      for (const c of cats) h += `<div class="line combo"><div class="grow"><div class="cn">${COMBOS[9 - c][0]}</div></div>${fitPile(hint.outs[c])}<b class="ocount">${hint.outs[c].length}</b></div>`;
      h += '</div>';
    } else if (hint.outs) h += '<div class="group note">Следующей картой рука не усилится</div>';
    else if (S.board.length === 0) h += '<div class="group note">Чем усилить руку — покажу с флопа</div>';
    else if (S.board.length === 5) h += '<div class="group note">Все карты на столе — дальше только торговля</div>';
  }
  if (focus && !combosOpen) return h + '<button class="combos-more" data-combos="1">Все комбинации ›</button>';
  if (focus) h += '<button class="combos-more" data-combos="0">Свернуть справочник</button>';
  h += '<div class="group">';
  COMBOS.forEach((c, i) => {
    const cards = c[1].split(' ').map((card, k) => (k < c[2] ? card : null));
    h += `<div class="line combo"><span class="num">${i + 1}</span><div class="grow"><div class="cn">${c[0]}</div></div><div class="cc">${cards.map((x) => cardHtml(x, 'xs')).join('')}</div></div>`;
  });
  return h + '</div><span class="caption">Жеребьёвка первого батона</span><div class="group draw-rule">Батон получает игрок со старшей картой. При равном достоинстве — по масти, от старшей к младшей: ♠ пики, ♥ червы, ♦ бубны, ♣ трефы.</div>';
}
// Олл-ин в «Комбинациях»: шансы каждого участника полосой и свои ауты стопкой (на столе их нет — там только игра).
function allInHtml(stage) {
  if (!stage) return '';
  const ids = Object.keys(stage.eq).map(Number).sort((a, b) => stage.eq[b] - stage.eq[a]);
  const lead = stage.eq[ids[0]];
  let h = '<span class="caption">Олл-ин · шансы</span><div class="group">';
  for (const i of ids) {
    const s = S.seats[i];
    if (!s) continue;
    const mine = i === S.you.seat;
    h += `<div class="line prow eqrow${mine ? ' me' : ''}"><span class="pav">${avatarHtml(s.avatar)}</span><div class="grow"><div class="pn">${esc(s.name)}${mine ? ' (вы)' : ''}</div><div class="eqbar"><i style="width:${stage.eq[i]}%"${stage.eq[i] === lead ? ' class="lead"' : ''}></i></div></div><b class="eqv${stage.eq[i] === lead ? ' lead' : ''}">${stage.eq[i]}%</b></div>`;
  }
  h += '</div>';
  const out = outsDockHtml(stage); // свои ауты или «Пришла ваша карта»
  const me = S.you.seat;
  if (out) h += `<div class="group outsbox">${out}</div>`;
  else if (stage.eq[me] != null && stage.board >= 3 && stage.eq[me] === Math.max(...Object.values(stage.eq))) h += '<div class="group note">Вы впереди — соперникам нужна карта</div>';
  return h;
}
// Стопка в строке комбинации: занимает ту же ширину, что пять карт-образцов; если карт больше, они ложатся внахлёст.
function fitPile(cards) {
  const W = 5 * 24 + 4 * 3; // ширина пяти мини-карт с зазорами
  const step = cards.length > 5 ? Math.max(4, (W - 24) / (cards.length - 1)) : 27;
  return `<div class="cc pile-fit" style="width:${W}px">${cards.map((c, k) => cardHtml(c, 'xs', k ? `margin-left:${(step - 24).toFixed(1)}px` : '')).join('')}</div>`;
}
function renderSide() {
  for (const b of document.querySelectorAll('#sidePanel [data-tab]')) b.classList.toggle('on', b.dataset.tab === sideTab);
  $('sideBody').innerHTML = sideTab === 'players' ? playersHtml() : combosHtml();
}
function openSide(tab) {
  if (!$('sidePanel').hidden && sideTab === tab) { closeSide(); return; }
  sideTab = tab;
  $('sidePanel').hidden = false;
  $('game').classList.add('left');
  renderSide();
  $('sideBody').scrollTop = 0;
  syncNav();
}
function closeSide() {
  $('sidePanel').hidden = true;
  $('game').classList.remove('left');
  syncNav();
}
$('btnPlayers').onclick = () => openSide('players');
$('btnCombos').onclick = () => openSide('combos');
$('sideClose').onclick = closeSide;
$('sidePanel').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (b) { sideTab = b.dataset.tab; renderSide(); $('sideBody').scrollTop = 0; syncNav(); }
  const m = e.target.closest('[data-combos]');
  if (m) { combosOpen = m.dataset.combos === '1'; renderSide(); }
});

// Подсветка значков, у которых сейчас открыта панель или меню.
function syncNav() {
  const side = !$('sidePanel').hidden;
  $('btnPlayers').classList.toggle('on', side && sideTab === 'players');
  $('btnCombos').classList.toggle('on', side && sideTab === 'combos');
  $('btnChat').classList.toggle('on', !$('chatPanel').hidden);
  $('btnSeat').classList.toggle('on', !$('seatMenu').hidden);
}

// ---------- реакции и меню места ----------
// Реакции раскрываются полукругом над своей аватаркой (у наблюдателя — дугой под кнопкой в шапке).
// Шаг между реакциями постоянный, поэтому дуга подстраивается под число выбранных в «Профиле».
// своя аватарка: радиус 100, шаг 36° — дуга сверху; кнопка в шапке: радиус 130, шаг 28° — пологая дуга целиком под шапкой
function renderReactPop() { $('reactPop').hidden = true; } // набор поменялся — меню соберётся заново при открытии
function toggleReactions(btn) {
  const pop = $('reactPop');
  if (!pop.hidden) { pop.hidden = true; return; }
  const k = Number(document.documentElement.style.getPropertyValue('--k')) || 1;
  const seat = btn.closest('.seat');
  const r = (seat ? seat.querySelector('.av') : btn).getBoundingClientRect();
  const mid = seat ? 270 : 90; // 270° — дуга сверху, 90° — снизу
  const RX_RADIUS = seat ? 100 : 130;
  const RX_STEP = seat ? 36 : 28;
  const n = prefs.reactions.length;
  const half = RX_RADIUS * Math.sin((Math.min(180, (n - 1) * RX_STEP) / 2) * Math.PI / 180) + 30;
  const vw = window.innerWidth / k;
  const cx = Math.min(vw - 8 - half, Math.max(8 + half, (r.left + r.width / 2) / k)); // не выходить за края окна
  const cy = (r.top + r.height / 2) / k + (seat ? 0 : 14); // под шапкой — с зазором от панели значков
  pop.innerHTML = prefs.reactions.map((id, i) => {
    const a = ((mid + (seat ? 1 : -1) * (i - (n - 1) / 2) * RX_STEP) * Math.PI) / 180; // первая выбранная — слева, и сверху, и снизу
    const dx = Math.round(RX_RADIUS * Math.cos(a));
    const dy = Math.round(RX_RADIUS * Math.sin(a));
    return `<button data-id="${id}" title="${REACTIONS[id][0]}" style="left:${cx + dx}px;top:${cy + dy}px;--dx:${-dx}px;--dy:${-dy}px;animation-delay:${i * 35}ms">${reactionSvg(id)}</button>`;
  }).join('');
  pop.hidden = false;
}$('reactPop').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  cmd('react', { emoji: b.dataset.id });
  $('reactPop').hidden = true;
});

function renderSeatMenu() {
  const me = S.you.seat;
  const s = me >= 0 ? S.seats[me] : null;
  let h = '';
  if (s) {
    h += `<button data-cmd="sitout" data-value="${s.sittingOut ? 0 : 1}">Пропускать раздачи${s.sittingOut ? '<span class="check">✓</span>' : ''}</button>`;
    h += tourPhase() === 'play'
      ? '<button data-cmd="leave" data-confirm="Выйти из турнира? Ваши фишки сгорят, вы займёте место выбывшего.">Выйти из турнира</button>'
      : '<button data-cmd="leave">Встать и наблюдать</button>';
  } else if (S.seats.some((x) => !x) && !tourOn()) {
    h += '<button data-cmd="sit">Сесть за стол</button>';
  }
  h += `${h ? '<hr>' : ''}<button class="danger" data-cmd="quit" data-confirm="Выйти из игры? Место и ник освободятся. Если вернётесь под тем же ником до «Начать заново», фишки и счёт докупок будут прежними.">Выйти из игры</button>`;
  $('seatMenu').innerHTML = h;
}

// Меню админа у строки игрока в «Игроках»: перевести в наблюдатели (фишки сохраняются) или удалить совсем.
function openPlayerMenu(btn) {
  const menu = $('playerMenu');
  const id = Number(btn.dataset.pmenu);
  const p = S.people.find((x) => x.id === id);
  if (!p) return;
  const name = esc(p.name);
  menu.innerHTML = (p.seated ? `<button data-cmd="standup" data-id="${id}">В наблюдатели</button><hr>` : '') +
    `<button class="danger" data-cmd="kick" data-id="${id}" data-confirm="Удалить ${name} совсем? Его фишки и докупки забудутся, ник освободится.">Удалить совсем</button>`;
  menu.hidden = false;
  const k = Number(document.documentElement.style.getPropertyValue('--k')) || 1;
  const b = btn.getBoundingClientRect();
  menu.style.left = Math.max(8, b.right / k - menu.offsetWidth) + 'px';
  menu.style.top = b.bottom / k + 4 + 'px';
  menu.style.right = 'auto';
}
document.addEventListener('click', (e) => {
  const t = e.target;
  const pm = t.closest('[data-pmenu]');
  $('playerMenu').hidden = true;
  if (pm) { $('seatMenu').hidden = true; $('reactPop').hidden = true; openPlayerMenu(pm); syncNav(); return; }
  const reactBtn = t.closest('.react-btn, #btnReact');
  if (reactBtn) { $('seatMenu').hidden = true; toggleReactions(reactBtn); syncNav(); return; }
  if (t.closest('#btnSeat')) {
    $('reactPop').hidden = true;
    if ($('seatMenu').hidden) { renderSeatMenu(); $('seatMenu').hidden = false; } else $('seatMenu').hidden = true;
    syncNav();
    return;
  }
  if (!t.closest('#reactPop')) $('reactPop').hidden = true;
  $('seatMenu').hidden = true;
  syncNav();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  $('reactPop').hidden = true;
  $('seatMenu').hidden = true;
  $('playerMenu').hidden = true;
  $('settings').hidden = true;
  if (raiseOpen) { raiseOpen = false; if (S) redrawFooter(); }
  syncNav();
});

// ---------- меню админа: «Игра» и «Турнир» ----------
// Два отдельных окна вместо переключателя режима. Личные настройки (суммы, размер, звук) — во вкладке «Профиль».
let hostMenu = 'game';
// оформление стола одно на обе игры и есть в обоих меню
const lookGroup = (on, line) => '<span class="caption">Оформление · у всех игроков</span><div class="group">' +
  line('Сукно', '<div class="seg">' + Object.keys(THEME_NAMES).map((t) => `<button data-theme="${t}"${on(S.look.theme === t)}>${THEME_NAMES[t]}</button>`).join('') + '</div>') +
  line('Масти', `<div class="seg"><button data-cards="two"${on(S.look.cards === 'two')}>2 цвета</button><button data-cards="four"${on(S.look.cards === 'four')}>4 цвета</button></div>`) + '</div>';
function renderSettings() {
  if (!S.you.isHost) { $('settings').hidden = true; return; }
  const on = (c) => (c ? ' class="on"' : '');
  const line = (label, control) => `<div class="line"><span class="grow">${label}</span>${control}</div>`;
  const tp = tourPhase();
  let h = '';
  if (hostMenu === 'tour') {
    const R = S.rules;
    const bb = Math.round(R.tourStack / 100); // старт — 1/100 стека, дальше блайнды растут по таймеру
    h = '<div class="sheet-head"><h2>Турнир</h2><button id="setClose" class="icon" title="Закрыть"><svg class="ic" viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17"/></svg></button></div>' + lookGroup(on, line) + '<span class="caption">Правила турнира</span><div class="group">';
    h += line('Блайнды растут каждые', '<div class="seg">' + [5, 10, 15].map((m) => `<button data-tourmin="${m}"${on(R.tourMin === m)}>${m} мин</button>`).join('') + '</div>');
    h += line('Стек', '<div class="seg">' + [5000, 10000, 20000].map((v) => `<button data-tstack="${v}"${on(R.tourStack === v)}>${fmt(v, 'chips')}</button>`).join('') + '</div>');
    h += line('Докупок на игрока', '<div class="seg">' + [0, 1, 2, 3].map((v) => `<button data-trebuy="${v}"${on(R.tourRebuy === v)}>${v}</button>`).join('') + '</div>');
    h += line('Автораздача', `<button class="switch${R.tourAutoDeal ? ' on' : ''}" data-tautodeal="${R.tourAutoDeal ? 0 : 1}" title="Новая раздача и улицы — сами, без кнопки дилера"></button>`);
    h += line('Время на ход', '<div class="seg">' + [[30000, '30 с'], [60000, '1 мин'], [0, 'Без времени']].map((o) => `<button data-tturn="${o[0]}"${on(R.tourTurn === o[0])}>${o[1]}</button>`).join('') + '</div>');
    h += `<div class="line"><span class="grow hint">${tourOn() ? 'Изменения — со следующего турнира или после «Начать заново».' : `Старт ${fmt(Math.floor(bb / 2), 'chips')}/${fmt(bb, 'chips')}. Докупка — сразу, как кончились фишки.`}</span></div>`;
    h += '</div><div class="group gap">';
    if (tp === 'off') h += line('Пригласить всех в игре', '<button class="primary" data-tourgo>Собрать турнир</button>');
    else if (tp === 'gather' || tp === 'starting') h += line('Идёт сбор участников', '<button data-cmd="tourCancel">Отменить</button>');
    else {
      h += line('Те же участники, фишки с начала', '<button data-cmd="tourRestart" data-confirm="Начать турнир заново? Все участники получат новый стек, блайнды — с начала.">Начать заново</button>');
      h += line(tp === 'play' ? 'Турнир идёт' : 'Турнир окончен', '<button class="danger" data-cmd="tourEnd" data-confirm="Завершить турнир? Все вернутся к обычной игре со своими фишками.">Завершить турнир</button>');
    }
    h += '</div>';
  } else {
    const cfg = S.pendingCfg || S.cfg;
    const busy = tourOn(); // во время турнира блайнды, стек и докупки обычной игры не меняются
    h = '<div class="sheet-head"><h2>Игра</h2><button id="setClose" class="icon" title="Закрыть"><svg class="ic" viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17"/></svg></button></div>' + lookGroup(on, line) + '<span class="caption">Правила</span><div class="group">';
    h += line('Автораздача', `<button class="switch${S.rules.nextHand === 'auto' ? ' on' : ''}" data-nexthand="${S.rules.nextHand === 'auto' ? 'dealer' : 'auto'}" title="Новая раздача и улицы — сами, без кнопки дилера"></button>`);
    h += line('Время на ход', '<div class="seg">' + [[30000, '30 с'], [60000, '1 мин'], [0, 'Без времени']].map((o) => `<button data-turn="${o[0]}"${on(S.rules.turnMs === o[0])}>${o[1]}</button>`).join('') + '</div>');
    if (busy) {
      h += '<div class="line"><span class="grow hint">Идёт турнир. Блайнды, стек и докупки обычной игры — после него.</span></div>';
    } else {
      h += line('Большой блайнд', `<input class="num" id="setBB" inputmode="numeric" autocomplete="off" value="${fmt(cfg.bb, 'chips')}">`);
      h += line('Стартовый стек', `<input class="num" id="setStack" inputmode="numeric" autocomplete="off" value="${fmt(cfg.startStack, 'chips')}">`);
      h += line('Докупок на игрока', '<div class="seg">' + [[0, '0'], [1, '1'], [2, '2'], [3, '3'], [-1, 'Без лимита']].map((o) => `<button data-rebuy="${o[0]}"${on(S.rules.rebuyLimit === o[0])}>${o[1]}</button>`).join('') + '</div>');
      h += `<div class="line"><span class="grow hint">${S.pendingCfg ? 'Новые значения вступят в силу со следующей раздачи.' : 'Блайнды и стек меняются со следующей раздачи.'}</span><button id="setApply">Применить</button></div>`;
    }
    h += '</div><div class="group gap">';
    h += line('Новая игра', '<button class="danger" data-cmd="restart" data-confirm="Начать игру заново? Стеки, докупки и настройки стола вернутся к начальным, все игроки снова отметят готовность.">Начать заново</button>');
    h += '</div>';
  }
  $('settingsBody').innerHTML = h;
}
// Кнопки «Готово» нет: изменения применяются сразу, окно закрывается крестиком в углу, кликом мимо, Esc или повторным нажатием на значок в шапке.
// Числа в меню вводятся с клавиатуры и сразу показываются с разделением тысяч: «20 000», без стрелок.
const digits = (v) => Number(String(v).replace(/\D/g, '')) || 0;
$('settings').addEventListener('input', (e) => {
  const el = e.target;
  if (!el.classList || !el.classList.contains('num')) return;
  const fromEnd = el.value.length - el.selectionEnd; // курсор держим на том же месте от конца
  const raw = el.value.replace(/\D/g, '').slice(0, 9);
  el.value = raw ? Number(raw).toLocaleString('ru-RU') : '';
  const pos = Math.max(0, el.value.length - fromEnd);
  el.setSelectionRange(pos, pos);
});
function openHostMenu(kind) {
  if (!$('settings').hidden && hostMenu === kind) { $('settings').hidden = true; syncNav(); return; }
  hostMenu = kind;
  $('settings').hidden = false;
  renderSettings();
}
$('btnTable').onclick = () => openHostMenu('game');
$('btnTour').onclick = () => openHostMenu('tour');
$('settings').addEventListener('click', (e) => {
  if (e.target === $('settings') || e.target.closest('#setClose')) { $('settings').hidden = true; syncNav(); return; }
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.tourmin) cmd('settings', { tourMin: Number(b.dataset.tourmin) });
  else if (b.dataset.tstack) cmd('settings', { tourStack: Number(b.dataset.tstack) });
  else if (b.dataset.trebuy !== undefined) cmd('settings', { tourRebuy: Number(b.dataset.trebuy) });
  else if (b.dataset.tturn !== undefined) cmd('settings', { tourTurn: Number(b.dataset.tturn) });
  else if (b.dataset.tourgo !== undefined) { cmd('tourGather'); $('settings').hidden = true; }
  else if (b.dataset.rebuy !== undefined) cmd('settings', { rebuyLimit: Number(b.dataset.rebuy) });
  else if (b.dataset.turn !== undefined) cmd('settings', { turnMs: Number(b.dataset.turn) });
  else if (b.dataset.nexthand) cmd('settings', { nextHand: b.dataset.nexthand });
  else if (b.dataset.tautodeal !== undefined) cmd('settings', { tourAutoDeal: b.dataset.tautodeal === '1' });
  else if (b.dataset.theme) cmd('settings', { theme: b.dataset.theme });
  else if (b.dataset.cards) cmd('settings', { cards: b.dataset.cards });
  else if (b.id === 'setApply') cmd('settings', { bb: digits($('setBB').value), startStack: digits($('setStack').value) });
});

// ---------- запуск ----------
(async function init() {
  try {
    const ids = await (await fetch('avatars/index.json')).json();
    if (Array.isArray(ids) && ids.length) { AVATARS = ids; ids.forEach((id) => AVATAR_IMAGES.add(id)); }
  } catch (e) { /* картинок нет — остаются эмодзи */ }
  await refreshAvatarChoice(false);
  if (token) {
    const ok = await checkToken();
    if (ok === true) { connect(); return; }
    if (ok === null) { $('login').hidden = true; $('game').hidden = false; toast('Нет связи с сервером — переподключаемся…'); waitServer(); return; }
  }
  showLogin('');
})();
