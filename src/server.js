'use strict';
// Сервер покера для локальной сети. Без внешних зависимостей: node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { Game, SEATS, outlook, improveOuts, equities, outsOf } = require('./engine');

const FIRST_PORT = Number(process.env.PORT) || 3000;
let PORT = FIRST_PORT;
const FROM_LAUNCHER = !!process.env.POKER_LAUNCHER; // запущен окном «Покер.exe»

// В собранном приложении страницы игры лежат внутри exe, при запуске из исходников — в папке public.
let sea = null;
try { const s = require('node:sea'); if (s.isSea()) sea = s; } catch (e) { /* обычный запуск */ }
// Отпечаток страницы игры: если приложение пересобрали, открытые вкладки увидят другой отпечаток при переподключении
// и сами перезагрузятся — иначе у игрока остаются старые стили и код.
const BUILD = (() => {
  const h = require('crypto').createHash('sha1');
  for (const f of ['index.html', 'app.js', 'style.css']) {
    try { h.update(sea ? Buffer.from(sea.getAsset(f)) : fs.readFileSync(path.join(__dirname, 'public', f))); } catch (e) { /* нет файла */ }
  }
  return h.digest('hex').slice(0, 12);
})();

// Адреса, по которым игру видно из локальной сети. Виртуальные адаптеры и VPN друзьям не подойдут.
function lanAddresses() {
  const virtual = /vEthernet|Hyper-V|WSL|VirtualBox|VMware|Loopback|^tun|^tap|VPN|WireGuard|Tailscale|ZeroTier/i;
  const all = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list) if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) all.push({ name, address: a.address });
  }
  const real = all.filter((a) => !virtual.test(a.name));
  return real.length ? real : all;
}
const PAUSE_REQUEST_MS = 20000;
const EMOJI_AVATARS = ['🦊', '🐻', '🐼', '🐯', '🦁', '🐸', '🐵', '🐧', '🦉', '🐺'];
const THEMES = ['classic', 'graphite', 'burgundy', 'night'];
const CARD_STYLES = ['two', 'four'];
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };

// Аватарки-картинки лежат в public/avatars (их готовит build/avatars.ps1). Если их нет, остаются эмодзи.
function loadAvatarIds() {
  try {
    const raw = sea ? Buffer.from(sea.getAsset('avatars/index.json')).toString('utf8') : fs.readFileSync(path.join(PUBLIC, 'avatars', 'index.json'), 'utf8');
    const ids = JSON.parse(raw);
    if (Array.isArray(ids) && ids.length) return ids.map(String);
  } catch (e) { /* картинок нет */ }
  return null;
}
const AVATARS = loadAvatarIds() || EMOJI_AVATARS;

// Заводские настройки: с ними начинается каждая игра — при запуске приложения и после «Начать заново».
const FACTORY = {
  cfg: { sb: 100, bb: 200, startStack: 20000 },
  look: { theme: 'classic', cards: 'two' },
  // nextHand: 'dealer' — новую раздачу запускает дилер, 'auto' — сама; mode: 'cash' — обычная игра, 'tour' — турнир
  rules: { rebuyLimit: -1, turnMs: 0, nextHand: 'dealer', mode: 'cash', tourMin: 5, tourStack: 10000, tourRebuy: 0, tourTurn: 30000, tourAutoDeal: false },
};

// ---------- турнир ----------
// Все начинают с одинаковым стеком, докупок нет, большой блайнд растёт по таймеру (каждые 5, 10 или 15 минут).
// Новые блайнды вступают в силу с ближайшей раздачи. Пауза останавливает и часы уровня.
// Фишки обычной игры на время турнира откладываются (tour.cash) и возвращаются, когда админ выходит из турнира.
const LEVELS = [100, 150, 200, 300, 400, 600, 800, 1000, 1400, 2000, 3000, 4000, 6000, 8000, 12000, 16000, 20000, 30000, 40000];
const BASE_STACK = 10000; // уровни LEVELS рассчитаны на этот стек; при другом стеке блайнды масштабируются
const TOUR_STACKS = [5000, 10000, 20000];
const TOUR_REBUYS = [0, 1, 2, 3];
// параметры турнира: во время игры — те, с которыми он начался; при сборе — текущие настройки админа
const tourCfg = () => (tourOn() && tour.cfg ? tour.cfg : { mins: rules.tourMin, stack: rules.tourStack, rebuy: rules.tourRebuy });
const levelBB = (k, stack) => Math.round((LEVELS[k] * stack) / BASE_STACK);
const TOUR_MINS = [5, 10, 15];
const MIN_MS = Number(process.env.POKER_MIN_MS) || 60000; // длина минуты; в проверках её укорачивают
const TOUR_SPOTS = { 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4], 6: [0, 1, 2, 3, 4, 5] };
let tourSeq = 0;
// phase: off — нет турнира, gather — сбор участников, starting — стартует после текущей раздачи, play — идёт, done — окончен
const freshTour = () => ({ phase: 'off', prev: 'off', id: 0, by: '', answers: new Map(), cash: null, count: 0, places: [], level: 0, played: 0, since: 0, ticking: false, finishTimer: null });
let tour = freshTour();
const game = new Game(Object.assign({}, FACTORY.cfg));
const look = Object.assign({}, FACTORY.look);
let pendingCfg = null;      // новые блайнды и стек вступают в силу со следующей раздачи
const clients = new Map();  // token -> client
let nextId = 1;
let running = false;
let paused = false;
let pauseReq = null;        // { by, votes:Set, timer }
let pausedBy = '';          // ник того, по чьей просьбе включена пауза
let turnTimer = null;
let turnDeadline = 0;
let turnLeftOnPause = 0;
let turnKey = '';
let nextHandTimer = null;
const history = [];         // последние сообщения чата и журнала
const REBUY_REQUEST_MS = 60000;
const OFFLINE_TURN_MS = 30000;
const TURN_OPTIONS = [30000, 60000, 0];
const rules = Object.assign({}, FACTORY.rules);  // докупок на игрока (-1 — без лимита) и время на ход в мс (0 — без времени)
let runoutUntil = 0;               // до какого момента на столах открываются карты олл-ина
let boardLogged = 0;              // сколько карт стола уже записано в ход игры
let turnTotal = 0;                // сколько времени дано на текущий ход
const ledger = new Map();         // ключ браузера -> { stack, buyins, bought }: фишки участника, который сейчас не за столом
const departed = new Map();       // ник (в нижнем регистре) -> { stack, buyins, bought }: фишки вышедших из игры
const rebuyReqs = new Map();      // id игрока -> { id, mode: 'host' | 'table', votes:Set, timer }

const seatOf = (c) => game.seats.findIndex((s) => s && s.id === c.id);
const clientById = (id) => [...clients.values()].find((c) => c.id === id);
const tourOn = () => tour.phase === 'play' || tour.phase === 'done';
const tourYes = () => [...tour.answers].filter(([id, agree]) => agree && clientById(id)).map(([id]) => id);
const tourAlive = () => game.seats.filter((s) => s && s.stack > 0 && !s.leaving && !s.busted);
const tourElapsed = () => tour.played + (tour.ticking ? Date.now() - tour.since : 0);
// часы уровня идут, только пока турнир играется и не стоит на паузе
function tourClock() {
  if (tour.phase !== 'play') return;
  const now = Date.now();
  if (tour.ticking) tour.played += now - tour.since;
  tour.since = now;
  tour.ticking = !paused;
}
// Примерная длительность: пока большой блайнд не дорастёт до 1/40 всех фишек за столом.
function tourEstimate(n) {
  const need = (BASE_STACK * Math.max(2, Math.min(6, n))) / 40;
  const k = LEVELS.findIndex((b) => b >= need);
  return Math.max(1, k < 0 ? LEVELS.length : k) * tourCfg().mins;
}
function tourView() {
  if (tour.phase === 'off') return null;
  const tc = tourCfg();
  const iv = tc.mins * MIN_MS;
  const e = tourElapsed();
  const due = Math.min(LEVELS.length - 1, Math.floor(e / iv));
  const yes = tourYes().length;
  const online = [...clients.values()].filter((c) => c.res).length;
  const play = tour.phase === 'play';
  const top = tour.level >= LEVELS.length - 1;
  return {
    id: tour.id, phase: tour.phase, by: tour.by, mins: tc.mins, stack: tc.stack, rebuy: tc.rebuy, first: levelBB(0, tc.stack),
    answers: [...tour.answers].map(([id, agree]) => ({ id, agree })),
    estimate: tourEstimate(tourOn() ? tour.count : yes >= 2 ? yes : Math.min(6, online)),
    count: tour.count, places: tour.places,
    // сколько осталось до роста блайндов; 0 — новые блайнды со следующей раздачи
    levelLeft: play && !top && due <= tour.level ? (tour.level + 1) * iv - e : 0,
    levelMs: iv,
    next: play && !top ? levelBB(tour.level + 1, tc.stack) : 0,
  };
}

function send(c, event, data) {
  if (c.res) c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
function broadcast(event, data) {
  for (const c of clients.values()) send(c, event, data);
}
// При олл-ине ход игры не должен обгонять стол: пока на столе по очереди открываются карты,
// записи об итоге (банк, выбывание, докупка) придерживаются до конца открытия.
let noteHoldUntil = 0;
function note(entry, now) {
  const wait = noteHoldUntil - Date.now();
  if (!now && wait > 0 && entry.kind !== 'chat') { setTimeout(() => note(entry, true), wait); return; } // чат не ждёт
  entry.ts = Date.now();
  history.push(entry);
  if (history.length > 1200) history.shift(); // около 40 раздач
  broadcast('note', entry);
}
const log = (text, extra) => note(Object.assign({ kind: 'log', text }, extra));

function view(c) {
  const mySeat = seatOf(c);
  const res = game.result;
  const seats = game.seats.map((s, i) => {
    if (!s) return null;
    const owner = clientById(s.id);
    const showed = !!res && s.showedHand === game.handNo; // сам открыл карты после раздачи
    const liveAllIn = game.phase !== 'idle' && game.runoutFrom != null && s.inHand && !s.folded; // олл-ин, улицы открывает дилер: карты уже на столе
    const shown = i === mySeat || (res && res.showdown && s.inHand && !s.folded) || showed || liveAllIn;
    return {
      id: s.id, name: s.name, avatar: s.avatar, stack: s.stack, bet: s.bet,
      inHand: s.inHand, folded: s.folded, allIn: s.allIn, sittingOut: s.sittingOut,
      connected: !!(owner && owner.res), cups: owner ? owner.cups || 0 : 0, buyins: s.buyins, leaving: !!s.leaving, ready: !!s.ready,
      net: s.stack + (game.phase !== 'idle' && s.inHand ? s.total : 0) - s.bought,
      hasCards: s.inHand && !s.folded && s.cards.length === 2,
      cards: shown && s.inHand ? s.cards : null, showed,
    };
  });
  const me = mySeat >= 0 ? game.seats[mySeat] : null;
  const hint = me && me.inHand && !me.folded && me.cards.length === 2 && game.phase !== 'idle' ? Object.assign(outlook(me.cards.concat(game.board), 5 - game.board.length), { outs: improveOuts(me.cards, game.board) }) : null;
  return {
    ...(c.isHost ? { saveWarning } : {}),
    you: { id: c.id, seat: mySeat, isHost: c.isHost, name: c.name, avatar: c.avatar }, hint,
    cfg: game.cfg, pendingCfg, look, seats,
    links: lanAddresses().map((a) => `http://${a.address}:${PORT}`),
    people: [...clients.values()].map((p) => {
      const seated = seatOf(p) >= 0;
      // фишки того, кто не за столом (во время турнира — отложенные фишки обычной игры): для списка «Не в сети»
      const ch = seated ? null : tour.cash ? (tour.cash.people.get(p.token) || {}).chips : ledger.get(p.token);
      return { id: p.id, name: p.name, avatar: p.avatar, seated, connected: !!p.res, isHost: p.isHost, cups: p.cups || 0,
        chips: ch ? { stack: ch.stack, net: ch.stack - ch.bought } : null };
    }),
    board: game.board, pot: game.pot() || (res ? res.total : 0),
    phase: game.phase, handNo: game.handNo, button: game.button,
    toAct: game.toAct, legal: mySeat >= 0 ? game.legal(mySeat) : null,
    currentBet: game.currentBet,
    sbSeat: game.phase !== 'idle' ? game.sbSeat : -1,
    bbSeat: game.phase !== 'idle' ? game.bbSeat : -1,
    turnLeft: game.toAct >= 0 ? (paused ? turnLeftOnPause : (turnDeadline ? Math.max(0, turnDeadline - Date.now()) : 0)) : 0,
    turnTotal,
    askedShow: !!res && game.askedHand === game.handNo, // победитель уже попросил показать карты
    // улица закрыта и ждёт дилера; streetIn — через сколько мс кнопка станет доступна (пауза открытия при олл-ине)
    waitStreet: !!game.waitStreet, streetIn: game.waitStreet ? Math.max(0, streetReadyAt - Date.now()) : 0, autoDeal: autoDeal(),
    runoutLive: liveStage(),
    running, paused, pausedBy: paused ? pausedBy : '', rules, tour: tourView(),
    waitDealer, dealerSeat: waitDealer ? nextDealerSeat() : -1,
    rebuyReqs: [...rebuyReqs.values()].map((r) => ({ id: r.id, mode: r.mode, votes: [...r.votes], needed: rebuyApprovers(r).map((p) => p.id) })),
    pauseReq: pauseReq ? { by: pauseReq.by, votes: [...pauseReq.votes], needed: pauseVoters().map((p) => p.id) } : null,
    result: res ? { showdown: res.showdown, pots: res.pots, payouts: res.payouts, hands: res.hands, runout: res.runout, rest: res.rest } : null,
  };
}

function push() {
  syncTurnTimer();
  for (const c of clients.values()) send(c, 'state', view(c));
  scheduleSave();
}

// ---------- сохранение стола ----------
// Стол пишется в обычный файл в папке пользователя (%LOCALAPPDATA%\PokerLAN): прав администратора и вопросов
// от Windows не нужно. Если приложение закрылось, при следующем запуске стеки, докупки и настройки вернутся,
// а игроки, войдя под своим ником, сядут со своими фишками. Сохранение старше недели не восстанавливается: коллеги возвращаются на следующий день со своими фишками.
const SAVE_DIR = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'PokerLAN');
const SAVE_FILE = path.join(SAVE_DIR, 'table.json');
const SAVE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // неделя
let saveTimer = null;
let lastSavedAt = null;
let saveWarning = null;
// Участник узнаётся по ключу своего браузера, а не по нику: после перезапуска приложения он сам
// возвращается на своё место, а чужой человек с тем же ником занять его не может.
function snapshot() {
  const people = [];
  const cash = tour.cash; // во время турнира сохраняем отложенные фишки обычной игры, а не турнирные
  for (const c of clients.values()) {
    if (cash) {
      const p = cash.people.get(c.token);
      people.push({ token: c.token, name: c.name, avatar: c.avatar, cups: c.cups || 0, seat: p ? p.seat : -1, chips: p ? p.chips : null });
      continue;
    }
    const i = seatOf(c);
    const s = i >= 0 ? game.seats[i] : null;
    // посреди раздачи сохраняем фишки на её начало: поставленное в банк возвращается игроку
    const chips = s ? { stack: s.stack + (game.phase !== 'idle' && s.inHand ? s.total : 0), buyins: s.buyins, bought: s.bought } : ledger.get(c.token) || null;
    people.push({ token: c.token, name: c.name, avatar: c.avatar, cups: c.cups || 0, seat: s && !s.leaving ? i : -1, chips });
  }
  const saved = cash ? Object.assign({}, rules, { mode: 'cash', turnMs: cash.turnMs }) : rules;
  return { version: 2, savedAt: Date.now(), cfg: cash ? cash.cfg : game.cfg, look, rules: saved, people, departed: [...departed] };
}
function saveNow(onExit = false) {
  const previousWarning = saveWarning;
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    fs.mkdirSync(SAVE_DIR, { recursive: true });
    const table = snapshot();
    fs.writeFileSync(SAVE_FILE + '.tmp', JSON.stringify(table));
    fs.renameSync(SAVE_FILE + '.tmp', SAVE_FILE);
    lastSavedAt = table.savedAt;
    saveWarning = null;
  } catch (e) {
    if (!saveWarning) saveWarning = { lastSavedAt };
    if (!onExit) saveTimer = setTimeout(saveNow, 5000);
  }
  if (!onExit && previousWarning !== saveWarning) {
    for (const c of clients.values()) if (c.isHost && c.res) send(c, 'state', view(c));
  }
}
function scheduleSave() {
  if (!saveTimer) saveTimer = setTimeout(saveNow, 400);
}
function restoreTable() {
  try {
    const d = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'));
    if (!d || d.version !== 2 || Date.now() - d.savedAt > SAVE_MAX_AGE) return 0;
    Object.assign(game.cfg, d.cfg);
    Object.assign(look, d.look);
    Object.assign(rules, d.rules);
    for (const p of d.people || []) {
      const c = { id: nextId++, token: p.token, name: p.name, avatar: p.avatar, cups: p.cups || 0, isHost: false, res: null };
      clients.set(c.token, c);
      if (p.chips) ledger.set(c.token, p.chips);
      if (p.seat >= 0) seatClient(c, p.seat, true);
    }
    for (const [name, chips] of d.departed || []) departed.set(name, chips);
    lastSavedAt = d.savedAt;
    return clients.size;
  } catch (e) {
    return 0;
  }
}

// ---------- таймер хода ----------
function syncTurnTimer() {
  const key = game.toAct >= 0 ? `${game.handNo}:${game.phase}:${game.toAct}:${game.currentBet}` : '';
  if (key === turnKey) return;
  turnKey = key;
  clearTimeout(turnTimer);
  turnTimer = null;
  if (!key) { turnTotal = 0; return; }
  const ms = turnMsFor(game.toAct);
  turnTotal = ms;
  if (paused) { turnLeftOnPause = ms; return; }
  armTurn(ms);
}
// Время на ход задаёт админ (0 — без ограничения). Игроку не в сети всегда даётся OFFLINE_TURN_MS,
// иначе при игре без времени закрытая вкладка остановила бы стол навсегда.
function turnMsFor(seat) {
  const s = game.seats[seat];
  const online = s && (clientById(s.id) || {}).res;
  return rules.turnMs || (online ? 0 : OFFLINE_TURN_MS);
}
function armTurn(ms) {
  clearTimeout(turnTimer);
  turnTimer = null;
  turnDeadline = ms ? Date.now() + ms : 0;
  if (ms) turnTimer = setTimeout(onTurnTimeout, ms);
}

function onTurnTimeout() {
  const i = game.toAct;
  if (i < 0 || paused) return;
  const s = game.seats[i];
  const L = game.legal(i);
  const owner = clientById(s.id);
  const street = game.phase;
  const move = L.canCheck ? 'check' : 'fold';
  game.act(i, move);
  logAction(i, move, street, 0, 0, true);
  if (!owner || !owner.res) s.sittingOut = true; // отключившийся игрок пропускает следующие раздачи
  afterAction();
}

// ---------- ход игры ----------
// Записи хода игры структурированы: улица, игрок, действие, сумма. По ним вкладка «Ход игры»
// строит ленту раздачи от префлопа до ривера и умеет показывать одного игрока.
function logAction(i, action, street, before, amount, timeout) {
  const s = game.seats[i];
  const move = action === 'raise' ? (before ? 'raise' : 'bet') : action;
  const words = { fold: 'фолд', check: 'чек', call: 'колл', bet: 'ставка', raise: 'рейз до' };
  const sized = action === 'call' || action === 'raise';
  log(`${s.name}: ${timeout ? 'время вышло, ' : ''}${words[move]}${s.allIn ? ' (олл-ин)' : ''}`, {
    act: action, move, pid: s.id, name: s.name, street, amount: sized ? amount : 0, allIn: s.allIn, timeout: !!timeout, hand: game.handNo,
  });
}
function logStreets() {
  while (boardLogged < game.board.length) logStreets.one();
}
logStreets.one = () => {
  const names = { 3: 'flop', 4: 'turn', 5: 'river' };
  const n = boardLogged === 0 ? 3 : boardLogged + 1;
  note({ kind: 'log', act: 'street', street: names[n], board: game.board.slice(0, n), hand: game.handNo, text: '' }, true);
  boardLogged = n;
};

// ---------- карты раздаёт дилер ----------
// Автораздача: в обычной игре — «Новая раздача: автоматически», в турнире — своя настройка.
function autoDeal() { return tour.phase === 'play' ? !!rules.tourAutoDeal : rules.nextHand === 'auto'; }
let streetReadyAt = 0;   // раньше этого момента дилер улицу не откроет (пауза при олл-ине)
let streetTimer = null;  // автооткрытие: дилер не в сети или включили автораздачу
let liveShownHand = 0;   // в какой раздаче карты олл-ина уже записаны в ход игры
let liveCache = null;
// олл-ин, улицы открывает дилер: шансы и ауты на текущей доске — для «Комбинаций»
function liveStage() {
  if (game.phase === 'idle' || game.runoutFrom == null) return null;
  const key = game.handNo + ':' + game.board.length;
  if (liveCache && liveCache.key === key) return liveCache.stage;
  const holes = {};
  game.seats.forEach((s, i) => { if (s && s.inHand && !s.folded) holes[i] = s.cards; });
  const board = game.board.slice();
  const eq = equities(holes, board);
  liveCache = { key, stage: { board: board.length, eq, outs: outsOf(holes, board), live: true } };
  return liveCache.stage;
}
function dealerClient() {
  const s = game.seats[game.button];
  return s ? clientById(s.id) : null;
}
// улица закрылась: при олл-ине — пауза перед кнопкой, карты участников — в ход игры; дилера нет в сети — открываем сами
function onWaitStreet() {
  const allIn = game.runoutFrom != null;
  streetReadyAt = Date.now() + (allIn ? runoutPause({ board: game.board.length }) : 0);
  if (allIn && liveShownHand !== game.handNo) {
    liveShownHand = game.handNo;
    game.seats.forEach((s) => { if (s && s.inHand && !s.folded) note({ kind: 'log', act: 'show', pid: s.id, name: s.name, cards: s.cards, handName: '', hand: game.handNo, text: `${s.name} показывает карты` }, true); });
  }
  autoStreet();
}
function autoStreet() {
  clearTimeout(streetTimer);
  streetTimer = null;
  if (!game.waitStreet || paused) return;
  const d = dealerClient();
  if (!autoDeal() && d && d.res) return; // дилер в сети — ждём его кнопку
  streetTimer = setTimeout(() => { streetTimer = null; openStreetNow(); }, Math.max(700, streetReadyAt - Date.now()));
}
function openStreetNow() {
  clearTimeout(streetTimer);
  streetTimer = null;
  if (!game.openStreet()) return;
  afterAction();
}

function afterAction() {
  if (game.phase === 'idle' && game.result && game.result.runout && !game.result.runout.live && boardLogged < game.board.length) logRunout();
  if (game.waitStreet) onWaitStreet();
  if (game.phase === 'idle' && game.result && game.result.runout && game.result.runout.live && liveShownHand === game.handNo) game.result.shownEarly = true;
  logStreets();
  if (game.phase === 'idle' && game.result) announceResult();
  if (game.phase === 'idle' && tour.phase === 'play') tourBusts();
  push();
  // при олл-ине карты на столах открываются по улицам (около 1,5 с на улицу) — даём время досмотреть
  const r = game.result;
  if (game.phase !== 'idle') return;
  // при олл-ине карты выходят с паузами (перед ривером дольше) — следующая раздача ждёт, пока клиенты их покажут
  const replay = r && r.runout && !r.runout.live; // карты олл-ина клиенты показывают сами, по этапам
  const delay = !r ? 3500 : replay ? 7000 + r.runout.stages.reduce((s, g) => s + runoutPause(g), 0) : r.showdown ? 7000 : r.rest ? 5000 : 3500;
  if (tour.phase === 'starting') { beginTournament(); return; }
  if (tour.phase === 'play' && tourAlive().length <= 1) { finishSoon(delay); return; }
  // По кнопке дилера: прошлая раздача остаётся на столе, пока следующий дилер не нажмёт «Новая раздача».
  // при олл-ине дилер начинает новую раздачу только после того, как на столах открылись все карты
  const shownIn = replay ? r.runout.stages.reduce((s, g) => s + runoutPause(g), 0) : 0;
  runoutUntil = shownIn ? noteHoldUntil : 0; // тот же момент, что и итог банка в «Ходе игры»
  if (shownIn) setTimeout(push, shownIn); // все увидят, что можно продолжать
  if (r && running && !autoDeal()) { waitDealer = true; push(); return; }
  scheduleNextHand(delay);
}

// ---------- турнир: старт, выбывание, итоги ----------
function recordBust(s) {
  if (s.busted) return;
  s.busted = true;
  const place = tour.count - tour.places.length;
  tour.places.push({ id: s.id, name: s.name, avatar: s.avatar, place });
  note({ kind: 'log', act: 'bust', pid: s.id, name: s.name, place, hand: game.handNo, text: `${s.name} выбывает · ${place} место` });
}
// Кто остался без фишек, выбывает. Если выбыли сразу несколько, выше место у того, кто начинал раздачу с большим стеком.
function tourBusts() {
  const out = game.seats.filter((s) => s && s.stack === 0 && !s.busted).sort((a, b) => a.total - b.total);
  for (const s of out) {
    // докупка в турнире — сразу и без вопросов, пока не исчерпан лимит
    if ((s.rebuys || 0) < tour.cfg.rebuy) {
      s.rebuys = (s.rebuys || 0) + 1;
      s.stack = tour.cfg.stack;
      s.bought += tour.cfg.stack;
      s.buyins++;
      log(`${s.name} докупается · ${s.rebuys} из ${tour.cfg.rebuy}`, { amount: tour.cfg.stack, act: 'chips' });
    } else recordBust(s);
  }
}
// ушедшие посреди раздачи выбывают в том порядке, в каком уходили
function bustLeavers() {
  const gone = game.seats.filter((s) => s && s.leaving && !s.busted).sort((a, b) => (a.leftAt || 0) - (b.leftAt || 0));
  for (const s of gone) recordBust(s);
}
function finishSoon(delay) {
  clearTimeout(nextHandTimer);
  nextHandTimer = null;
  waitDealer = false;
  if (!tour.finishTimer) tour.finishTimer = setTimeout(finishTournament, delay);
}
function finishTournament() {
  clearTimeout(tour.finishTimer);
  tour.finishTimer = null;
  if (tour.phase !== 'play') return;
  bustLeavers();
  for (let i = 0; i < SEATS; i++) if (game.seats[i] && game.seats[i].leaving) game.seats[i] = null; // ушедшие уже не за столом
  const w = tourAlive()[0];
  if (w) tour.places.push({ id: w.id, name: w.name, avatar: w.avatar, place: 1 });
  const champ = w && clientById(w.id);
  if (champ) champ.cups = (champ.cups || 0) + 1; // кубок у аватарки — до сброса статистики
  tourClock();
  tour.ticking = false;
  tour.phase = 'done';
  running = false;
  waitDealer = false;
  note({ kind: 'log', act: 'tourend', name: w ? w.name : '', hand: game.handNo, text: w ? `Турнир окончен. Победитель — ${w.name}` : 'Турнир окончен' });
  push();
}
// игрок ушёл из-за стола между раздачами: может остаться один — тогда турнир окончен
function tourCheckEnd() {
  if (tour.phase === 'play' && game.phase === 'idle' && !tour.finishTimer && tourAlive().length <= 1) finishTournament();
}
function clearTable() {
  for (let i = 0; i < SEATS; i++) game.seats[i] = null;
  Object.assign(game, { phase: 'idle', board: [], button: -1, toAct: -1, currentBet: 0, result: null });
}
function beginTournament() {
  clearTimeout(nextHandTimer);
  nextHandTimer = null;
  waitDealer = false;
  for (const id of [...rebuyReqs.keys()]) cancelRebuy(id);
  // фишки обычной игры откладываем: после турнира каждый получит свои обратно и сядет на своё место
  if (!tour.cash) {
    const people = new Map();
    for (const c of clients.values()) {
      const i = seatOf(c);
      const s = i >= 0 ? game.seats[i] : null;
      people.set(c.token, { seat: s && !s.leaving ? i : -1, chips: s ? { stack: s.stack, buyins: s.buyins, bought: s.bought } : ledger.get(c.token) || null });
    }
    tour.cash = { people, cfg: Object.assign({}, pendingCfg || game.cfg), turnMs: rules.turnMs };
  }
  pendingCfg = null;
  ledger.clear();
  clearTable();
  const tc = { mins: rules.tourMin, stack: rules.tourStack, rebuy: rules.tourRebuy }; // правила фиксируются на старте
  const ids = tourYes().map((id) => [Math.random(), id]).sort((a, b) => a[0] - b[0]).map((x) => x[1]).slice(0, SEATS);
  const spots = TOUR_SPOTS[ids.length];
  ids.forEach((id, k) => {
    const c = clientById(id);
    game.sit(spots[k], { id: c.id, name: c.name, avatar: c.avatar, ready: true, buyins: 1, bought: tc.stack, stack: tc.stack });
  });
  Object.assign(game.cfg, { sb: Math.floor(levelBB(0, tc.stack) / 2), bb: levelBB(0, tc.stack), startStack: tc.stack });
  rules.turnMs = rules.tourTurn; // своё время на ход; после турнира вернётся время обычной игры
  Object.assign(tour, { phase: 'play', cfg: tc, entrants: ids, count: ids.length, places: [], level: 0, played: 0, since: Date.now(), ticking: !paused });
  running = true;
  boardLogged = 0;
  note({ kind: 'log', act: 'tourstart', hand: game.handNo, text: `Турнир начался · игроков ${ids.length}` });
  push();
  scheduleNextHand(3000);
}
// Выход из турнира: стол обычной игры возвращается таким, каким был до турнира.
function endTournament() {
  clearTimeout(nextHandTimer);
  nextHandTimer = null;
  clearTimeout(tour.finishTimer);
  clearTimeout(turnTimer);
  turnTimer = null;
  turnKey = '';
  turnTotal = 0;
  for (const id of [...rebuyReqs.keys()]) cancelRebuy(id);
  clearTable();
  const cash = tour.cash;
  tour = freshTour();
  if (cash) {
    Object.assign(game.cfg, cash.cfg);
    rules.turnMs = cash.turnMs;
    ledger.clear();
    for (const c of clients.values()) { const p = cash.people.get(c.token); if (p && p.chips) ledger.set(c.token, p.chips); }
    for (const c of clients.values()) { const p = cash.people.get(c.token); if (p && p.seat >= 0) seatClient(c, p.seat, true); }
  }
  rules.mode = 'cash';
  running = false;
  waitDealer = false;
  cancelPauseReq();
  paused = false;
  boardLogged = 0;
  log('Турнир завершён, возвращаемся к обычной игре');
  push();
}

// Олл-ин и колл: карты участников открываются сразу — так их и пишем, следом за коллом, без названий комбинаций
// (до открытия стола это подсказка). Улицы записываются в том же темпе, что открываются на столе.
function logRunout() {
  const r = game.result;
  const hand = game.handNo;
  const from = r.runout.from;
  while (boardLogged < from) logStreets.one();
  for (const i in r.hands) {
    const s = game.seats[i];
    if (s) note({ kind: 'log', act: 'show', pid: s.id, name: s.name, cards: s.cards, handName: '', hand, text: `${s.name} показывает карты` }, true);
  }
  let at = 0;
  for (const g of r.runout.stages) {
    at += runoutPause(g);
    const n = g.board === 0 ? 3 : g.board + 1;
    setTimeout(() => {
      if (game.handNo !== hand) return;
      const names = { 3: 'flop', 4: 'turn', 5: 'river' };
      note({ kind: 'log', act: 'street', street: names[n], board: game.board.slice(0, n), hand, text: '' }, true);
    }, at);
  }
  boardLogged = game.board.length;
  r.shownEarly = true;
  noteHoldUntil = Date.now() + at + 300; // итог банка — после ривера
}

function announceResult() {
  const r = game.result;
  if (r.showdown && !r.shownEarly) {
    for (const i in r.hands) {
      const s = game.seats[i];
      if (s) note({ kind: 'log', act: 'show', pid: s.id, name: s.name, cards: s.cards, handName: r.hands[i].name, hand: game.handNo, text: `${s.name} показывает карты` });
    }
  }
  for (const p of r.pots) {
    if (p.refund) continue;
    const ws = p.winners.map((i) => game.seats[i]);
    const names = ws.map((s) => s.name).join(', ');
    const handName = r.showdown ? r.hands[p.winners[0]].name : '';
    const split = p.winners.length > 1;
    log(`${names} ${split ? 'делят' : 'забирает'} банк`, { amount: p.amount, tail: handName ? ' — ' + handName : '', act: 'win', names, split, handName, pids: ws.map((s) => s.id), hand: game.handNo });
  }
}

// ---------- места и фишки ----------
// Кто встал из-за стола, сохраняет фишки и счёт докупок: «встал и сел» не выдаёт свежий стартовый стек.
// «Выйти из игры» забывает всё — и фишки, и ник.
function seatClient(c, at, quiet) {
  const free = at != null ? at : game.seats.findIndex((s) => !s);
  if (free < 0 || game.seats[free]) return false;
  const saved = ledger.get(c.token);
  ledger.delete(c.token);
  // bought — сколько фишек игрок всего получил (стартовый стек и докупки по суммам на момент выдачи):
  // от него считается результат «+/−», и смена стартового стека посреди игры его не сбивает.
  const bought = saved ? (saved.bought || saved.buyins * game.cfg.startStack) : game.cfg.startStack;
  game.sit(free, { id: c.id, name: c.name, avatar: c.avatar, ready: running, buyins: saved ? saved.buyins : 1, bought, stack: saved ? saved.stack : game.cfg.startStack });
  if (!quiet) log(`${c.name} садится за стол`);
  return true;
}
function unseat(i) {
  const s = game.seats[i];
  const owner = clientById(s.id);
  // в турнире фишки с собой не уносят: кто встал из-за стола, выбывает
  if (tour.phase === 'play') recordBust(s);
  else if (owner && !tourOn()) ledger.set(owner.token, { stack: s.stack, buyins: s.buyins, bought: s.bought });
  cancelRebuy(s.id);
  game.unseat(i);
}
function cleanupSeats() {
  if (tour.phase === 'play') bustLeavers();
  for (let i = 0; i < SEATS; i++) {
    const s = game.seats[i];
    if (s && s.busted) unseat(i); // выбывшие в турнире становятся наблюдателями
    else if (s && s.leaving) { unseat(i); log(`${s.name} выходит из-за стола`); }
  }
}

// ---------- докупка: только при нуле фишек и только с разрешения ----------
// Обычному игроку докупку выдаёт админ. Самому админу (или если админа нет в сети) — стол: все игроки должны согласиться.
const onlineSeats = (exceptId) => game.seats.filter((s) => s && s.id !== exceptId && !s.leaving && (clientById(s.id) || {}).res);
const onlineHosts = (exceptId) => [...clients.values()].filter((c) => c.isHost && c.res && c.id !== exceptId);
const rebuyApprovers = (r) => (r.mode === 'host' ? onlineHosts(r.id) : onlineSeats(r.id));
function cancelRebuy(id) {
  const r = rebuyReqs.get(id);
  if (!r) return;
  clearTimeout(r.timer);
  rebuyReqs.delete(id);
}
function grantRebuy(id) {
  const s = game.seats.find((x) => x && x.id === id);
  cancelRebuy(id);
  if (!s) return;
  s.stack += game.cfg.startStack;
  s.bought += game.cfg.startStack;
  s.buyins++;
  log(`${s.name} получает докупку`, { amount: game.cfg.startStack, act: 'chips' });
}
function checkRebuyVotes() {
  for (const r of [...rebuyReqs.values()]) {
    const need = rebuyApprovers(r);
    if (r.mode === 'host' && !need.length) r.mode = 'table'; // админ ушёл — решает стол
    if (r.mode !== 'table') continue;
    const voters = rebuyApprovers(r);
    if (!voters.length || voters.every((s) => r.votes.has(s.id))) grantRebuy(r.id);
  }
}

// Пауза между улицами при докладке после олл-ина (перед ривером дольше). Клиент получает эти числа в hello.
const RUNOUT_PAUSE = { street: 2200, river: 3500 };
const runoutPause = (g) => (g.board === 4 ? RUNOUT_PAUSE.river : RUNOUT_PAUSE.street);
function scheduleNextHand(delay) {
  clearTimeout(nextHandTimer);
  nextHandTimer = setTimeout(() => { nextHandTimer = null; tryStartHand(); }, delay);
}

// Следующий дилер: первый после нынешней фишки «D» игрок с фишками, который в игре и в сети.
// Кто пропускает раздачи, роль дилера пропускает. Отключившийся дилер её сохраняет: стол ждёт, админ решает.
let waitDealer = false;
function nextDealerSeat() {
  for (let k = 1; k <= SEATS; k++) {
    const i = (((game.button + k) % SEATS) + SEATS) % SEATS;
    const s = game.seats[i];
    if (s && s.stack > 0 && !s.sittingOut && !s.leaving) return i; // отключившийся дилер остаётся дилером: ждём его или админа
  }
  return -1;
}

function tryStartHand() {
  if (!running || paused || game.phase !== 'idle' || nextHandTimer || waitDealer || tour.finishTimer || tour.phase === 'starting') return;
  cleanupSeats();
  if (pendingCfg) { Object.assign(game.cfg, pendingCfg); pendingCfg = null; }
  if (tour.phase === 'play') {
    // уровень блайндов по часам турнира; новые блайнды — с этой раздачи
    const due = Math.min(LEVELS.length - 1, Math.floor(tourElapsed() / (tour.cfg.mins * MIN_MS)));
    if (due > tour.level) {
      tour.level = due;
      const bb = levelBB(due, tour.cfg.stack);
      Object.assign(game.cfg, { sb: Math.floor(bb / 2), bb });
      note({ kind: 'log', act: 'level', sb: game.cfg.sb, bb: game.cfg.bb, hand: game.handNo + 1, text: `Блайнды растут: ${game.cfg.sb}/${game.cfg.bb}` });
    }
  }
  if (!game.canStart()) { game.result = null; push(); return; }
  // фишка «D» переходит ровно к тому, кого все видели дилером
  const dealer = nextDealerSeat();
  if (dealer >= 0) game.button = (dealer + SEATS - 1) % SEATS;
  game.holdStreets = !autoDeal(); // карты раздаёт дилер, если не включена автораздача
  game.startHand();
  boardLogged = 0;
  note({ kind: 'log', text: `Раздача ${game.handNo}`, act: 'deal', hand: game.handNo });
  for (const [i, move] of [[game.sbSeat, 'sb'], [game.bbSeat, 'bb']]) {
    const s = game.seats[i];
    note({ kind: 'log', act: 'blind', move, pid: s.id, name: s.name, street: 'preflop', amount: s.bet, allIn: s.allIn, hand: game.handNo, text: `${s.name}: ${move === 'sb' ? 'малый' : 'большой'} блайнд` });
  }
  afterAction();
}

// ---------- пауза ----------
function pauseVoters() {
  return game.seats.filter((s) => s && !s.sittingOut && !s.leaving && (clientById(s.id) || {}).res);
}
function cancelPauseReq() {
  if (pauseReq) clearTimeout(pauseReq.timer);
  pauseReq = null;
}
function checkPauseVotes() {
  if (!pauseReq) return;
  const need = pauseVoters();
  if (!need.length || !need.every((s) => pauseReq.votes.has(s.id))) return;
  const asker = clientById(pauseReq.by);
  pausedBy = asker ? asker.name : '';
  cancelPauseReq();
  paused = true;
  turnLeftOnPause = turnTimer ? Math.max(1000, turnDeadline - Date.now()) : 0;
  clearTimeout(turnTimer);
  turnTimer = null;
  tourClock();
  log('Пауза: все согласны', { act: 'pause' });
}
function resume() {
  paused = false;
  tourClock();
  if (game.toAct >= 0) {
    const remaining = turnLeftOnPause || turnMsFor(game.toAct);
    if (!turnLeftOnPause) turnTotal = remaining;
    armTurn(remaining);
  }
  autoStreet(); // улица ждала, а дилера нет — после паузы откроется сама
}

// ---------- команды игроков ----------
const fail = (msg) => { throw new Error(msg); };
const int = (v, min, max) => {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < min || n > max) fail('Неверное число');
  return n;
};

// Полностью убирает участника: освобождает место (в раздаче — сбрасывает карты) и закрывает его сессию.
function removeClient(target, text, event) {
  const i = seatOf(target);
  let inHand = false;
  // Кто вышел сам, того фишки и счёт докупок помним по нику до «Начать заново»: иначе проигравший всё
  // вышел бы и вернулся под тем же ником со свежим стеком в обход лимита докупок. Удалённых админом забываем.
  if (event === 'bye' && !tourOn()) {
    const s = i >= 0 ? game.seats[i] : null;
    const chips = s ? { stack: s.stack, buyins: s.buyins, bought: s.bought } : ledger.get(target.token);
    if (chips) departed.set(target.name.toLowerCase(), chips);
  }
  if (i >= 0) {
    const s = game.seats[i];
    inHand = game.phase !== 'idle' && s.inHand;
    if (inHand) {
      s.leaving = true;
      s.leftAt = Date.now(); // в турнире кто ушёл раньше, занимает место ниже
      if (!s.folded) { const street = game.phase; game.forceFold(i); logAction(i, 'fold', street, 0, 0); }
    } else {
      unseat(i);
    }
  }
  cancelRebuy(target.id);
  send(target, event, {});
  if (target.res) target.res.end();
  target.res = null;
  clients.delete(target.token);
  ledger.delete(target.token);
  log(text);
  if (pauseReq) { pauseReq.votes.delete(target.id); if (pauseReq.by === target.id) cancelPauseReq(); }
  checkPauseVotes();
  checkRebuyVotes();
  if (tour.answers.has(target.id)) tour.answers.delete(target.id);
  if (inHand) afterAction(); else { tourCheckEnd(); push(); }
}

const commands = {
  act(c, m) {
    const i = seatOf(c);
    if (i < 0) fail('Вы не за столом');
    if (paused) fail('Игра на паузе');
    const L = game.legal(i) || fail('Сейчас не ваш ход');
    const street = game.phase;
    const before = game.currentBet;
    const seat = game.seats[i], betWas = seat.bet, inWas = seat.total;
    game.act(i, m.action, m.amount);
    // сумма — сколько фишек игрок реально внёс: колл на олл-ине не больше стека, рейз — «до» итоговой ставки улицы
    const put = seat.total - inWas;
    logAction(i, m.action, street, before, m.action === 'call' ? put : betWas + put);
    afterAction();
  },
  // Игру запускает только админ. Остальные отмечают готовность; кто не отметил — пропускает раздачи, пока не нажмёт «Готов».
  start(c) {
    if (!c.isHost) fail('Игру запускает админ');
    if (running) return;
    const mine = seatOf(c);
    if (mine >= 0) game.seats[mine].ready = true;
    const ready = game.seats.filter((s) => s && s.ready && s.stack > 0);
    if (ready.length < 2) fail('Нужно минимум два готовых игрока с фишками');
    for (const s of game.seats) if (s) s.sittingOut = !s.ready;
    running = true;
    log('Админ начинает игру');
    tryStartHand();
  },
  ready(c, m) {
    const i = seatOf(c);
    if (i < 0) fail('Сначала сядьте за стол');
    const s = game.seats[i];
    s.ready = !!m.value;
    if (running && s.ready) s.sittingOut = false;
    push();
    tryStartHand();
  },
  chat(c, m) {
    const text = String(m.text || '').trim().slice(0, 200);
    if (!text) return;
    // не чаще раза в 700 мс, как реакции: иначе поток сообщений вытеснит из истории ход игры
    const now = Date.now();
    if (now - (c.lastChat || 0) < 700) fail('Слишком часто');
    c.lastChat = now;
    note({ kind: 'chat', from: c.id, name: c.name, avatar: c.avatar, text });
  },
  // После раздачи: кто сбросил карты, может их показать всем — до начала следующей раздачи.
  showCards(c) {
    const i = seatOf(c);
    const s = i >= 0 ? game.seats[i] : null;
    const res = game.result;
    if (!s || game.phase !== 'idle' || !res || !s.inHand || s.cards.length !== 2) fail('Сейчас нечего показывать');
    if (s.showedHand === game.handNo || (res.showdown && !s.folded)) return; // уже открыты
    s.showedHand = game.handNo;
    log(`${c.name} показывает карты`);
    push();
  },
  // Победитель может попросить сбросивших показать карты: у него над аватаркой облачко «Покажи карты!». Раз за раздачу.
  askShow(c) {
    const i = seatOf(c);
    const res = game.result;
    if (i < 0 || game.phase !== 'idle' || !res || !(res.payouts[i] > 0)) fail('Попросить может только победитель раздачи');
    if (game.askedHand === game.handNo) return;
    game.askedHand = game.handNo;
    broadcast('say', { from: c.id, text: 'Покажи карты!' });
    push();
  },
  react(c, m) {
    const emoji = String(m.emoji || '').slice(0, 8);
    if (!emoji) return;
    const now = Date.now();
    if (now - (c.lastReact || 0) < 700) return;
    c.lastReact = now;
    broadcast('react', { from: c.id, emoji });
  },
  sit(c) {
    if (seatOf(c) >= 0) return;
    if (tourOn()) fail('Идёт турнир — можно смотреть и писать в чат');
    if (!seatClient(c)) fail('Свободных мест нет');
    push();
    tryStartHand();
  },
  leave(c) {
    const i = seatOf(c);
    if (i < 0) return;
    const s = game.seats[i];
    if (game.phase !== 'idle' && s.inHand) {
      s.leaving = true;
      s.leftAt = Date.now(); // в турнире кто ушёл раньше, занимает место ниже
      if (!s.folded) { const street = game.phase; game.forceFold(i); logAction(i, 'fold', street, 0, 0); }
      afterAction();
    } else {
      unseat(i);
      if (tour.phase !== 'play') log(`${s.name} выходит из-за стола`);
      tourCheckEnd();
      push();
    }
    checkPauseVotes();
    checkRebuyVotes();
  },
  sitout(c, m) {
    const i = seatOf(c);
    if (i < 0) return;
    game.seats[i].sittingOut = !!m.value;
    if (!m.value) game.seats[i].ready = true;
    log(`${c.name} ${m.value ? 'пропускает раздачи' : 'снова в игре'}`);
    checkPauseVotes();
    push();
    tryStartHand();
  },
  rebuyRequest(c) {
    const i = seatOf(c);
    if (i < 0) fail('Вы не за столом');
    const s = game.seats[i];
    if (tourOn()) fail('В турнире докупок нет');
    if (s.stack > 0) fail('Докупка возможна, только когда фишки закончились');
    if (game.phase !== 'idle' && s.inHand) fail('Дождитесь конца раздачи');
    if (rules.rebuyLimit >= 0 && s.buyins - 1 >= rules.rebuyLimit) fail('Лимит докупок исчерпан');
    if (rebuyReqs.has(c.id)) return;
    const mode = !c.isHost && onlineHosts(c.id).length ? 'host' : 'table';
    const timer = setTimeout(() => { rebuyReqs.delete(c.id); log(`Докупка для ${c.name} не подтверждена`); push(); }, REBUY_REQUEST_MS);
    rebuyReqs.set(c.id, { id: c.id, mode, votes: new Set(), timer });
    log(`${c.name} просит докупку`);
    checkRebuyVotes();
    push();
    tryStartHand();
  },
  rebuyAnswer(c, m) {
    const r = rebuyReqs.get(Number(m.id));
    if (!r || r.id === c.id) return;
    const who = clientById(r.id);
    const name = who ? who.name : 'игрока';
    if (!rebuyApprovers(r).some((p) => p.id === c.id)) fail(r.mode === 'host' ? 'Докупку подтверждает админ' : 'Голосуют игроки за столом');
    if (!m.agree) {
      cancelRebuy(r.id);
      log(r.mode === 'host' ? `Админ отказал в докупке: ${name}` : `${c.name} против докупки для ${name}`);
    } else if (r.mode === 'host') {
      grantRebuy(r.id);
    } else {
      r.votes.add(c.id);
      checkRebuyVotes();
    }
    push();
    tryStartHand();
  },
  hello() {},
  // Сбросить статистику: фишки у всех остаются, «+/−» считается заново с текущих стеков, докупки и кубки — с нуля.
  resetResults(c) {
    if (!c.isHost) fail('Статистику сбрасывает админ');
    if (tourOn()) fail('Идёт турнир — статистика сбрасывается после него');
    for (const s of game.seats) {
      if (!s) continue;
      s.bought = s.stack + (game.phase !== 'idle' && s.inHand ? s.total : 0);
      s.buyins = 1;
    }
    for (const [token, chips] of ledger) ledger.set(token, { stack: chips.stack, buyins: 1, bought: chips.stack });
    for (const p of clients.values()) p.cups = 0;
    log(`${c.name} сбрасывает статистику игроков`);
    push();
  },
  // Убрать всех, кто не в сети: накопившиеся ники освобождаются, их фишки забываются.
  purgeOffline(c) {
    if (!c.isHost) fail('Убирать игроков может только админ');
    const gone = [...clients.values()].filter((p) => p !== c && !p.res);
    for (const p of gone) removeClient(p, `Админ убрал игрока не в сети: ${p.name}`, 'kicked');
    push();
  },
  // Профиль: свой ник и аватарку можно сменить прямо в игре — место, фишки и статистика остаются.
  profile(c, m) {
    const others = [...clients.values()].filter((x) => x !== c);
    let name = c.name;
    let avatar = c.avatar;
    if (m.name !== undefined) {
      name = String(m.name || '').trim().replace(/\s+/g, ' ').slice(0, 14);
      if (name.length < 2) fail('Ник — от 2 до 14 символов');
      if (others.some((x) => x.name.toLowerCase() === name.toLowerCase())) fail('Такой ник уже занят');
    }
    if (m.avatar !== undefined) {
      if (!AVATARS.includes(m.avatar)) fail('Нет такой аватарки');
      if (others.some((x) => x.avatar === m.avatar)) fail('Эту аватарку уже выбрал другой игрок');
      avatar = m.avatar;
    }
    if (name === c.name && avatar === c.avatar) return;
    const old = c.name;
    c.name = name;
    c.avatar = avatar;
    const s = game.seats.find((x) => x && x.id === c.id);
    if (s) { s.name = name; s.avatar = avatar; }
    for (const p of tour.places) if (p.id === c.id) { p.name = name; p.avatar = avatar; }
    if (old !== name) log(`${old} теперь ${name}`);
    push();
  },
  // Турнир: админ собирает участников, у всех появляется приглашение, админ видит ответы и запускает.
  tourGather(c) {
    if (!c.isHost) fail('Турнир собирает админ');
    if (tour.phase !== 'off' && tour.phase !== 'done') return;
    Object.assign(tour, { prev: tour.phase, phase: 'gather', id: ++tourSeq, by: c.name, answers: new Map([[c.id, true]]) });
    log(`${c.name} собирает турнир`);
    push();
  },
  tourAnswer(c, m) {
    if (tour.phase !== 'gather' && tour.phase !== 'starting') return;
    const agree = !!m.agree;
    if (agree && !tour.answers.get(c.id) && tourYes().length >= SEATS) fail('Мест нет: в турнире до 6 игроков');
    tour.answers.set(c.id, agree);
    push();
  },
  tourCancel(c) {
    if (!c.isHost) fail('Отменить турнир может админ');
    if (tour.phase !== 'gather' && tour.phase !== 'starting') return;
    tour.phase = tour.prev;
    tour.answers = new Map();
    log('Сбор на турнир отменён');
    push();
  },
  tourStart(c) {
    if (!c.isHost) fail('Турнир начинает админ');
    if (tour.phase !== 'gather') return;
    if (tourYes().length < 2) fail('Нужно минимум два участника');
    if (game.phase === 'idle') beginTournament();
    else { tour.phase = 'starting'; push(); } // текущая раздача обычной игры доигрывается
  },
  // Турнир заново с теми же участниками и текущими правилами: если кто-то не понял правила с первого раза.
  tourRestart(c) {
    if (!c.isHost) fail('Начать турнир заново может только админ');
    if (!tourOn()) return;
    const ids = (tour.entrants || []).filter((id) => clientById(id));
    if (ids.length < 2) fail('Нужно минимум два участника');
    clearTimeout(tour.finishTimer);
    tour.finishTimer = null;
    clearTimeout(turnTimer);
    turnTimer = null;
    turnKey = '';
    turnTotal = 0;
    cancelPauseReq();
    paused = false;
    tour.answers = new Map(ids.map((id) => [id, true]));
    log(`${c.name} начинает турнир заново`);
    beginTournament();
  },
  tourEnd(c) {
    if (!c.isHost) fail('Выйти из турнира может только админ');
    if (!tourOn()) return;
    endTournament();
  },
  // дилер открывает флоп, тёрн или ривер
  street(c) {
    if (!game.waitStreet) return;
    if (seatOf(c) !== game.button) fail('Карты открывает дилер');
    if (Date.now() < streetReadyAt - 150) fail('Сначала досмотрим карты');
    openStreetNow();
  },
  deal(c) {
    if (!waitDealer) return;
    if (seatOf(c) !== nextDealerSeat()) fail('Новую раздачу начинает дилер');
    waitDealer = false;
    // нажали чуть раньше, чем допечатался итог олл-ина, — раздача начнётся сразу после него
    const wait = runoutUntil - Date.now();
    if (wait > 0) { push(); setTimeout(tryStartHand, wait); return; }
    tryStartHand();
  },
  // Новая игра: стеки, докупки и настройки стола возвращаются к заводским, все снова отмечают готовность.
  restart(c) {
    if (!c.isHost) fail('Начать заново может только админ');
    clearTimeout(nextHandTimer);
    nextHandTimer = null;
    clearTimeout(turnTimer);
    turnTimer = null;
    turnKey = '';
    turnTotal = 0;
    cancelPauseReq();
    paused = false;
    pausedBy = '';
    for (const id of [...rebuyReqs.keys()]) cancelRebuy(id);
    clearTimeout(tour.finishTimer);
    tour = freshTour();
    ledger.clear();
    departed.clear();
    pendingCfg = null;
    Object.assign(game.cfg, FACTORY.cfg);
    Object.assign(look, FACTORY.look);
    Object.assign(rules, FACTORY.rules);
    for (let i = 0; i < SEATS; i++) {
      const s = game.seats[i];
      if (!s) continue;
      if (s.leaving || s.busted) { game.seats[i] = null; continue; }
      Object.assign(s, { stack: game.cfg.startStack, buyins: 1, bought: game.cfg.startStack, ready: false, sittingOut: false, cards: [], bet: 0, total: 0, inHand: false, folded: false, allIn: false, acted: false });
    }
    Object.assign(game, { phase: 'idle', board: [], handNo: 0, button: -1, toAct: -1, currentBet: 0, result: null });
    running = false;
    waitDealer = false;
    boardLogged = 0;
    history.length = 0;
    saveNow();
    broadcast('reset', {});
    log(`${c.name} начинает игру заново`);
    push();
  },
  standup(c, m) {
    if (!c.isHost) fail('Переводить в наблюдатели может только админ');
    const target = clientById(Number(m.id)) || fail('Игрок не найден');
    if (seatOf(target) < 0) return;
    log(`Админ перевёл игрока ${target.name} в наблюдатели`);
    commands.leave(target);
  },
  kick(c, m) {
    if (!c.isHost) fail('Удалять игроков может только админ');
    const target = clientById(Number(m.id)) || fail('Игрок не найден');
    if (target === c) fail('Себя удалить нельзя');
    removeClient(target, `Админ удалил игрока ${target.name}`, 'kicked');
  },
  quit(c) {
    removeClient(c, `${c.name} выходит из игры`, 'bye');
  },
  pauseRequest(c) {
    if (paused) return;
    if (c.isHost) {
      // админ ставит паузу сразу, без голосования
      cancelPauseReq();
      pausedBy = c.name;
      paused = true;
      turnLeftOnPause = turnTimer ? Math.max(1000, turnDeadline - Date.now()) : 0;
      clearTimeout(turnTimer);
      turnTimer = null;
      tourClock();
      log(`${c.name} ставит паузу`, { act: 'pause' });
      push();
      return;
    }
    if (seatOf(c) < 0) fail('Паузу может попросить только игрок за столом');
    if (pauseReq) return;
    pauseReq = { by: c.id, votes: new Set([c.id]), timer: setTimeout(() => { pauseReq = null; log('Пауза не подтверждена'); push(); }, PAUSE_REQUEST_MS) };
    log(`${c.name} просит паузу`, { act: 'pause' });
    checkPauseVotes();
    push();
  },
  pauseVote(c, m) {
    if (!pauseReq || seatOf(c) < 0) return;
    if (m.agree) {
      pauseReq.votes.add(c.id);
      checkPauseVotes();
    } else {
      cancelPauseReq();
      log(`${c.name} против паузы`);
    }
    push();
  },
  resume(c) {
    if (!paused || (seatOf(c) < 0 && !c.isHost)) return;
    resume();
    log(`${c.name} продолжает игру`);
    push();
    tryStartHand();
  },
  settings(c, m) {
    if (!c.isHost) fail('Настройки стола меняет только админ');
    if (m.theme !== undefined) { if (!THEMES.includes(m.theme)) fail('Нет такой темы'); look.theme = m.theme; }
    if (m.cards !== undefined) { if (!CARD_STYLES.includes(m.cards)) fail('Нет такого стиля карт'); look.cards = m.cards; }
    if (m.mode !== undefined) {
      if (!['cash', 'tour'].includes(m.mode)) fail('Нет такого режима');
      if (tour.phase !== 'off') fail('Сначала завершите турнир');
      rules.mode = m.mode;
    }
    if (m.tourMin !== undefined) {
      if (!TOUR_MINS.includes(Number(m.tourMin))) fail('Нет такого интервала');
      rules.tourMin = Number(m.tourMin); // идущий турнир живёт по своим правилам; новые — со следующего старта
    }
    if (m.tourStack !== undefined) {
      if (!TOUR_STACKS.includes(Number(m.tourStack))) fail('Нет такого стека');
      rules.tourStack = Number(m.tourStack);
    }
    if (m.tourRebuy !== undefined) {
      if (!TOUR_REBUYS.includes(Number(m.tourRebuy))) fail('Нет такого числа докупок');
      rules.tourRebuy = Number(m.tourRebuy);
    }
    if (m.tourAutoDeal !== undefined) {
      rules.tourAutoDeal = !!m.tourAutoDeal;
      log(rules.tourAutoDeal ? 'В турнире карты раздаются автоматически' : 'В турнире карты раздаёт дилер');
      if (tour.phase === 'play') { game.holdStreets = !autoDeal(); if (autoDeal() && waitDealer) { waitDealer = false; scheduleNextHand(1500); } autoStreet(); }
    }
    if (m.tourTurn !== undefined) {
      if (!TURN_OPTIONS.includes(Number(m.tourTurn))) fail('Нет такого времени на ход');
      rules.tourTurn = Number(m.tourTurn);
    }
    if (m.nextHand !== undefined) {
      if (!['dealer', 'auto'].includes(m.nextHand)) fail('Нет такого режима');
      rules.nextHand = m.nextHand;
      log(rules.nextHand === 'auto' ? 'Новая раздача начинается автоматически' : 'Новую раздачу начинает дилер');
      if (rules.nextHand === 'auto' && waitDealer) { waitDealer = false; scheduleNextHand(1500); }
      if (tour.phase !== 'play') { game.holdStreets = !autoDeal(); autoStreet(); }
    }
    if (m.turnMs !== undefined) {
      if (!TURN_OPTIONS.includes(Number(m.turnMs))) fail('Нет такого времени на ход');
      rules.turnMs = Number(m.turnMs);
      log(rules.turnMs ? `Время на ход: ${rules.turnMs / 1000} с` : 'Время на ход не ограничено');
    }
    // блайнды, стек и докупки обычной игры не трогают идущий турнир
    if (tourOn() && (m.rebuyLimit !== undefined || m.bb !== undefined || m.startStack !== undefined)) fail('Идёт турнир — это меняется после него');
    if (m.rebuyLimit !== undefined) {
      rules.rebuyLimit = int(m.rebuyLimit, -1, 9);
      log(rules.rebuyLimit < 0 ? 'Докупки: без лимита' : `Докупок на игрока: ${rules.rebuyLimit}`);
    }
    if (m.bb !== undefined || m.startStack !== undefined) {
      const bb = int(m.bb !== undefined ? m.bb : game.cfg.bb, 2, 100000);
      const startStack = int(m.startStack !== undefined ? m.startStack : game.cfg.startStack, bb * 10, 10000000);
      const next = { sb: Math.max(1, Math.floor(bb / 2)), bb, startStack };
      if (game.phase === 'idle' && !game.result) Object.assign(game.cfg, next);
      else pendingCfg = next;
      log(`Блайнды ${next.sb}/${next.bb}, стартовый стек ${next.startStack}`);
    }
    push();
  },
};

// ---------- HTTP ----------
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; if (data.length > 4096) { reject(new Error('Слишком длинный запрос')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(new Error('Неверный запрос')); } });
    req.on('error', reject);
  });
}
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
// Админ — тот, кто открыл игру на этом компьютере. Для проверки на одном компьютере (POKER_SINGLE_HOST=1)
// админом считается только первый вошедший, остальные вкладки ведут себя как обычные игроки.
const SINGLE_HOST = !!process.env.POKER_SINGLE_HOST;
const isLocal = (req, c) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) &&
  !(SINGLE_HOST && [...clients.values()].some((x) => x.isHost && x !== c));

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'POST' && url.pathname === '/api/join') {
      const m = await readBody(req);
      const name = String(m.name || '').trim().replace(/\s+/g, ' ').slice(0, 14);
      if (name.length < 2) fail('Ник — от 2 до 14 символов');
      const same = [...clients.values()].find((c) => c.name.toLowerCase() === name.toLowerCase());
      // Ник занят, пока его владелец в сети. Если владелец не в сети (браузер потерял ключ, зашли с другого
      // компьютера), под этим ником можно вернуться: место, фишки и аватарка сохраняются, старый ключ перестаёт работать.
      if (same && same.res) fail('Такой ник уже занят');
      if (same) {
        // Место админа можно вернуть только с компьютера, где запущена игра: иначе любой в сети,
        // зная ник, получил бы права админа, пока тот перезагружает вкладку.
        if (same.isHost && !isLocal(req, same)) fail('Этот ник принадлежит админу. Выберите другой');
        if (!m.reclaim) { json(res, 409, { error: `${same.name} сейчас не в сети. Если это вы — войдите снова, ваше место и фишки сохранятся.`, reclaim: true, avatar: same.avatar }); return; }
        const token = crypto.randomBytes(16).toString('hex');
        clients.delete(same.token);
        const saved = ledger.get(same.token);
        if (saved) { ledger.delete(same.token); ledger.set(token, saved); }
        if (tour.cash && tour.cash.people.has(same.token)) { tour.cash.people.set(token, tour.cash.people.get(same.token)); tour.cash.people.delete(same.token); }
        same.token = token;
        same.isHost = isLocal(req, same);
        clients.set(token, same);
        log(`${same.name} возвращается в игру`);
        json(res, 200, { token });
        scheduleSave();
        return;
      }
      if (!AVATARS.includes(m.avatar)) fail('Выберите аватарку');
      if ([...clients.values()].some((c) => c.avatar === m.avatar)) fail('Эту аватарку уже выбрал другой игрок');
      const token = crypto.randomBytes(16).toString('hex');
      const c = { id: nextId++, token, name, avatar: m.avatar, isHost: isLocal(req), res: null };
      clients.set(token, c);
      const back = departed.get(name.toLowerCase());
      if (back) { departed.delete(name.toLowerCase()); ledger.set(token, back); }
      if (!tourOn()) seatClient(c); // во время турнира новичок смотрит игру
      json(res, 200, { token });
      push();
      tryStartHand();
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/cmd') {
      const m = await readBody(req);
      const c = clients.get(m.token) || fail('Сессия не найдена, войдите заново');
      const fn = Object.prototype.hasOwnProperty.call(commands, m.type) ? commands[m.type] : fail('Неизвестная команда');
      fn(c, m);
      json(res, 200, { ok: true });
      return;
    }
    // Какие аватарки уже заняты: экран входа их не показывает.
    if (req.method === 'GET' && url.pathname === '/api/avatars') {
      json(res, 200, { taken: [...clients.values()].map((c) => c.avatar) });
      return;
    }
    // Вкладку закрывают — браузер успевает послать «ухожу», и игрок сразу становится офлайн.
    if (req.method === 'POST' && url.pathname === '/api/away') {
      const m = await readBody(req).catch(() => ({}));
      const c = clients.get(m.token);
      if (c && c.res) { const r = c.res; goOffline(c, r); r.end(); }
      res.writeHead(204); res.end();
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/events') {
      const c = clients.get(url.searchParams.get('token'));
      if (!c) { json(res, 401, { error: 'Сессия не найдена' }); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      if (c.res) c.res.end();
      c.res = res;
      c.isHost = c.isHost || isLocal(req, c);
      send(c, 'hello', { avatars: AVATARS, themes: THEMES, history, build: BUILD, runoutPause: RUNOUT_PAUSE });
      // Если компьютер игрока пропал из сети без закрытия соединения (сон, выдернутый кабель),
      // проверки TCP раз в 5 секунд замечают это примерно за полминуты, а не за несколько минут.
      try { req.socket.setKeepAlive(true, 5000); } catch (e) { /* не страшно */ }
      req.on('close', () => goOffline(c, res));
      push();
      return;
    }
    if (req.method === 'GET') {
      const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      if (sea) {
        let body = null;
        try { body = Buffer.from(sea.getAsset(rel)); } catch (e) { /* такого файла нет */ }
        if (!body) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(rel)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        res.end(body);
        return;
      }
      const file = path.join(PUBLIC, rel);
      if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      fs.createReadStream(file).pipe(res);
      return;
    }
    res.writeHead(405); res.end();
  } catch (e) {
    json(res, 400, { error: e.message });
  }
});

// Игрок ушёл из сети: на его ходу включается таймер, голосования пересчитываются, остальные видят «офлайн».
function goOffline(c, res) {
  if (c.res !== res) return;
  c.res = null;
  const acting = game.toAct >= 0 && game.seats[game.toAct] && game.seats[game.toAct].id === c.id;
  if (acting && !turnTimer && !paused) { turnTotal = OFFLINE_TURN_MS; armTurn(OFFLINE_TURN_MS); }
  checkPauseVotes();
  checkRebuyVotes();
  autoStreet(); // ушёл дилер — улицы открываются сами
  push();
}

setInterval(() => broadcast('ping', {}), 10000);

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && FROM_LAUNCHER && PORT < FIRST_PORT + 9) {
    PORT++; // порт занят другой программой: приложение пробует следующий
    server.listen(PORT, '0.0.0.0');
    return;
  }
  if (FROM_LAUNCHER) {
    console.log('@@ERROR ' + (e.code === 'EADDRINUSE' ? 'Все порты с ' + FIRST_PORT + ' по ' + PORT + ' заняты другими программами.' : e.message));
  } else if (e.code === 'EADDRINUSE') {
    console.log(`\n  Порт ${PORT} уже занят: похоже, покер уже запущен в другом окне.`);
    console.log('  Закройте то окно или просто откройте http://localhost:' + PORT + '\n');
  } else {
    console.log('\n  Не удалось запустить сервер: ' + e.message + '\n');
  }
  process.exit(1);
});

server.on('listening', () => {
  const addrs = lanAddresses();
  if (FROM_LAUNCHER) {
    console.log('@@READY ' + JSON.stringify({ port: PORT, addrs }));
    return;
  }
  console.log('\n  Покер Офис запущен.\n');
  console.log(`  Вы (админ):  http://localhost:${PORT}`);
  for (const a of addrs) console.log(`  Адрес для друзей:   http://${a.address}:${PORT}   (${a.name})`);
  if (!addrs.length) console.log('  Сеть не найдена: подключитесь к локальной сети и перезапустите.');
  console.log('\n  Не закрывайте это окно, пока идёт игра.\n');
});

// Окно приложения держит открытым наш stdin: если оно закрылось или упало, сервер тоже завершается.
if (FROM_LAUNCHER) {
  process.stdin.on('end', () => process.exit(0));
  process.stdin.on('error', () => process.exit(0));
  process.stdin.resume();
}
process.on('exit', () => { if (saveTimer) saveNow(true); });

const restored = restoreTable();
if (restored) log(`Восстановлена прошлая игра: участников ${restored}. Каждый вернётся на своё место, открыв игру в том же браузере.`);
server.listen(PORT, '0.0.0.0');
