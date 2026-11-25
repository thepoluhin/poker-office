'use strict';
// Движок безлимитного техасского холдема на 6 мест. Не знает ни о сети, ни о таймерах.
const crypto = require('crypto');

const RANKS = '23456789TJQKA';
const SUITS = 'shdc';
const SEATS = 6;
const CATEGORY_NAMES = ['старшая карта', 'пара', 'две пары', 'сет', 'стрит', 'флеш', 'фулл-хаус', 'каре', 'стрит-флеш'];

function newDeck() {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push(r + s);
  return d;
}

function shuffle(d) {
  for (let i = d.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

const rankOf = (c) => RANKS.indexOf(c[0]) + 2;

function straightHigh(ranks) {
  const set = new Set(ranks);
  if (set.has(14)) set.add(1);
  for (let h = 14; h >= 5; h--) {
    let ok = true;
    for (let k = 0; k < 5; k++) if (!set.has(h - k)) { ok = false; break; }
    if (ok) return h;
  }
  return 0;
}

// Лучшая комбинация из 5–7 карт. Возвращает массив чисел, который сравнивается по порядку.
function evaluate(cards) {
  const ranks = cards.map(rankOf).sort((a, b) => b - a);
  const bySuit = {};
  for (const c of cards) (bySuit[c[1]] = bySuit[c[1]] || []).push(rankOf(c));
  let flush = null;
  for (const s in bySuit) if (bySuit[s].length >= 5) flush = bySuit[s].sort((a, b) => b - a);
  if (flush) {
    const sf = straightHigh(flush);
    if (sf) return [8, sf];
  }
  const count = {};
  for (const r of ranks) count[r] = (count[r] || 0) + 1;
  const groups = Object.keys(count).map(Number).sort((a, b) => count[b] - count[a] || b - a);
  const kickers = (exclude, n) => [...new Set(ranks)].filter((r) => !exclude.includes(r)).slice(0, n);
  if (count[groups[0]] === 4) return [7, groups[0], ...kickers([groups[0]], 1)];
  if (count[groups[0]] === 3 && groups.length > 1 && count[groups[1]] >= 2) return [6, groups[0], groups[1]];
  if (flush) return [5, ...flush.slice(0, 5)];
  const st = straightHigh(ranks);
  if (st) return [4, st];
  if (count[groups[0]] === 3) return [3, groups[0], ...kickers([groups[0]], 2)];
  if (count[groups[0]] === 2 && groups.length > 1 && count[groups[1]] === 2) {
    return [2, groups[0], groups[1], ...kickers([groups[0], groups[1]], 1)];
  }
  if (count[groups[0]] === 2) return [1, groups[0], ...kickers([groups[0]], 3)];
  return [0, ...[...new Set(ranks)].slice(0, 5)];
}

// Какие пять карт из доступных дают лучшую комбинацию и какие из них её образуют
// (core): у пары это две карты, у каре четыре, у стрита, флеша и фулл-хауса все пять.
function bestFive(cards) {
  let five = cards.slice(0, 5);
  let score = evaluate(five);
  const n = cards.length;
  for (let a = 0; a < n - 4; a++) for (let b = a + 1; b < n - 3; b++) for (let c = b + 1; c < n - 2; c++) {
    for (let d = c + 1; d < n - 1; d++) for (let e = d + 1; e < n; e++) {
      const pick = [cards[a], cards[b], cards[c], cards[d], cards[e]];
      const s = evaluate(pick);
      if (compareScores(s, score) > 0) { five = pick; score = s; }
    }
  }
  const groupRanks = { 7: [score[1]], 3: [score[1]], 2: [score[1], score[2]], 1: [score[1]], 0: [score[1]] }[score[0]];
  const core = groupRanks ? five.filter((c) => groupRanks.includes(rankOf(c))) : five.slice();
  return { five, core, score };
}

// Подсказка игроку: что уже собрано из его карт и карт стола и сколько карт не хватает до каждой
// комбинации. need[k] — число недостающих карт для категории k (0–8, как в evaluate; 9 — роял-флеш).
// Если не хватает больше, чем ещё выйдет карт (toCome), комбинация уже недостижима.
function outlook(cards, toCome) {
  const best = bestFive(cards);
  const count = {};
  const suits = {};
  for (const c of cards) {
    const r = rankOf(c);
    count[r] = (count[r] || 0) + 1;
    (suits[c[1]] = suits[c[1]] || new Set()).add(r);
  }
  const groups = Object.values(count).sort((a, b) => b - a);
  const c1 = groups[0] || 0;
  const c2 = groups[1] || 0;
  const lack = (n, have) => Math.max(0, n - have);
  // стрит: пять подряд, туз считается и старшим, и единицей
  const window = (set, high) => { let have = 0; for (let k = 0; k < 5; k++) { const r = high - k; if (set.has(r === 1 ? 14 : r)) have++; } return 5 - have; };
  const all = new Set(Object.keys(count).map(Number));
  let straight = 5;
  for (let h = 5; h <= 14; h++) straight = Math.min(straight, window(all, h));
  let flush = 5;
  let straightFlush = 5;
  let royal = 5;
  for (const s in suits) {
    flush = Math.min(flush, 5 - Math.min(5, suits[s].size));
    for (let h = 5; h <= 14; h++) straightFlush = Math.min(straightFlush, window(suits[s], h));
    royal = Math.min(royal, window(suits[s], 14));
  }
  const need = [0, lack(2, c1), lack(2, c1) + lack(2, c2), lack(3, c1), straight, flush, lack(3, c1) + lack(2, c2), lack(4, c1), straightFlush, royal];
  const made = best.score[0] === 8 && best.score[1] === 14 ? 9 : best.score[0];
  for (let k = 0; k <= made; k++) need[k] = 0;
  return { made, five: best.five, core: best.core, need, toCome };
}

// Шансы на победу (в процентах) для известных карт игроков и стола. Ничьи делятся.
// До флопа — 4000 случайных досдач (точный перебор слишком долгий), на флопе и тёрне — точный перебор.
function equities(holes, board, samples) {
  const ids = Object.keys(holes);
  const known = new Set(board.concat(...ids.map((i) => holes[i])));
  const deck = newDeck().filter((c) => !known.has(c));
  const need = 5 - board.length;
  const win = {};
  for (const i of ids) win[i] = 0;
  let total = 0;
  const run = (extra) => {
    const full = board.concat(extra);
    let best = null;
    let winners = [];
    for (const i of ids) {
      const s = evaluate(holes[i].concat(full));
      const c = best ? compareScores(s, best) : 1;
      if (c > 0) { best = s; winners = [i]; } else if (c === 0) winners.push(i);
    }
    for (const w of winners) win[w] += 1 / winners.length;
    total++;
  };
  if (need === 0) run([]);
  else if (need === 1) for (const a of deck) run([a]);
  else if (need === 2) for (let a = 0; a < deck.length; a++) for (let b = a + 1; b < deck.length; b++) run([deck[a], deck[b]]);
  else {
    const pool = deck.slice();
    for (let n = 0; n < (samples || 4000); n++) {
      for (let k = 0; k < need; k++) { const j = k + Math.floor(Math.random() * (pool.length - k)); [pool[k], pool[j]] = [pool[j], pool[k]]; }
      run(pool.slice(0, need));
    }
  }
  const out = {};
  for (const i of ids) out[i] = Math.round((win[i] / total) * 100);
  return out;
}

// Ауты: какие следующие карты выводят вперёд (или в ничью) того, кто сейчас проигрывает по собранной комбинации,
// — для подписи «аутов: N» при олл-ине. Считаются только до тёрна и до ривера; у того, кто сейчас впереди, аутов нет.
function outsOf(holes, board) {
  if (board.length !== 3 && board.length !== 4) return null;
  const ids = Object.keys(holes);
  const beats = (i, full) => {
    const mine = evaluate(holes[i].concat(full));
    return ids.every((j) => j === i || compareScores(mine, evaluate(holes[j].concat(full))) >= 0);
  };
  const known = new Set(board.concat(...ids.map((i) => holes[i])));
  const deck = newDeck().filter((c) => !known.has(c));
  const outs = {};
  for (const i of ids) {
    if (beats(i, board)) continue; // уже впереди или делит
    outs[i] = deck.filter((x) => beats(i, board.concat(x)));
  }
  return outs;
}

// Обычная раздача (карты соперников закрыты): какие следующие карты усилят вашу руку — переведут её
// в комбинацию старше нынешней, причём с участием ваших карт (то, что просто спарит стол, не считается).
// Ответ — { категория: [карты] }, каждая карта в одной, лучшей категории. Только на флопе и тёрне.
function improveOuts(hole, board) {
  if (board.length !== 3 && board.length !== 4) return null;
  const cat = (s) => (s[0] === 8 && s[1] === 14 ? 9 : s[0]); // роял-флеш — своя строка
  const made = cat(evaluate(hole.concat(board)));
  const known = new Set(hole.concat(board));
  const out = {};
  for (const x of newDeck()) {
    if (known.has(x)) continue;
    const c = cat(evaluate(hole.concat(board, x)));
    if (c <= made) continue;
    if (cat(evaluate(board.concat(x))) >= c) continue; // это рука стола, а не ваша
    (out[c] = out[c] || []).push(x);
  }
  return out;
}

function compareScores(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d;
  }
  return 0;
}

function handName(score) {
  if (score[0] === 8 && score[1] === 14) return 'роял-флеш';
  return CATEGORY_NAMES[score[0]];
}

class Game {
  constructor(cfg) {
    this.cfg = Object.assign({ sb: 10, bb: 20, startStack: 2000 }, cfg);
    this.seats = Array(SEATS).fill(null);
    this.button = -1;
    this.phase = 'idle';
    this.board = [];
    this.handNo = 0;
    this.toAct = -1;
    this.currentBet = 0;
    this.minRaise = this.cfg.bb;
    this.result = null;
  }

  sit(i, player) {
    if (this.seats[i]) throw new Error('Место занято');
    this.seats[i] = Object.assign({
      stack: this.cfg.startStack, cards: [], bet: 0, total: 0,
      inHand: false, folded: false, allIn: false, acted: false, sittingOut: false,
    }, player);
    return this.seats[i];
  }

  // Убрать игрока можно только между раздачами или если он не в раздаче.
  unseat(i) {
    const s = this.seats[i];
    if (!s) return;
    if (this.phase !== 'idle' && s.inHand) throw new Error('Игрок в раздаче');
    this.seats[i] = null;
  }

  eligible(i) {
    const s = this.seats[i];
    return !!s && !s.sittingOut && s.stack > 0;
  }

  canAct(i) {
    const s = this.seats[i];
    return !!s && s.inHand && !s.folded && !s.allIn;
  }

  nextSeat(from, pred) {
    for (let k = 1; k <= SEATS; k++) {
      const i = (((from + k) % SEATS) + SEATS) % SEATS;
      if (pred(i)) return i;
    }
    return -1;
  }

  eligibleCount() {
    let n = 0;
    for (let i = 0; i < SEATS; i++) if (this.eligible(i)) n++;
    return n;
  }

  canStart() {
    return this.phase === 'idle' && this.eligibleCount() >= 2;
  }

  pot() {
    return this.seats.reduce((sum, s) => sum + (s ? s.total : 0), 0);
  }

  _post(i, amount) {
    const s = this.seats[i];
    const pay = Math.min(amount, s.stack);
    s.stack -= pay;
    s.bet += pay;
    s.total += pay;
    if (s.stack === 0) s.allIn = true;
    return pay;
  }

  startHand(deck) {
    if (!this.canStart()) return false;
    for (let i = 0; i < SEATS; i++) {
      const s = this.seats[i];
      if (!s) continue;
      Object.assign(s, { cards: [], bet: 0, total: 0, folded: false, allIn: false, acted: false });
      s.inHand = this.eligible(i);
    }
    const inHand = (i) => !!this.seats[i] && this.seats[i].inHand;
    const players = this.seats.filter((s) => s && s.inHand).length;
    this.button = this.nextSeat(this.button, inHand);
    this.deck = deck ? deck.slice() : shuffle(newDeck());
    this.board = [];
    this.result = null;
    this.handNo++;
    this.runoutFrom = null; // с какой улицы карты докладывались без торговли (все в олл-ине)
    this.waitStreet = false; // улица закрыта и ждёт дилера (при holdStreets)
    const sbSeat = players === 2 ? this.button : this.nextSeat(this.button, inHand);
    const bbSeat = this.nextSeat(sbSeat, inHand);
    this.sbSeat = sbSeat;
    this.bbSeat = bbSeat;
    this._post(sbSeat, this.cfg.sb);
    this._post(bbSeat, this.cfg.bb);
    this.currentBet = this.cfg.bb;
    this.minRaise = this.cfg.bb;
    for (let round = 0; round < 2; round++) {
      let i = this.button;
      for (let k = 0; k < players; k++) {
        i = this.nextSeat(i, inHand);
        this.seats[i].cards.push(this.deck.pop());
      }
    }
    this.phase = 'preflop';
    this._advance(bbSeat);
    return true;
  }

  _othersCanAct(i) {
    let n = 0;
    for (let k = 0; k < SEATS; k++) if (k !== i && this.canAct(k)) n++;
    return n;
  }

  _needsAction(i) {
    if (!this.canAct(i)) return false;
    const s = this.seats[i];
    if (s.bet < this.currentBet) return true;
    return !s.acted && this._othersCanAct(i) > 0;
  }

  legal(i) {
    const s = this.seats[i];
    if (!s || this.toAct !== i) return null;
    const toCall = Math.min(this.currentBet - s.bet, s.stack);
    const maxTo = s.bet + s.stack;
    // После своего действия игрок может повысить, если суммарный рост достиг полного рейза.
    const reopened = !s.acted || this.currentBet - s.bet >= this.minRaise;
    const canRaise = reopened && maxTo > this.currentBet && this._othersCanAct(i) > 0;
    return {
      toCall,
      canCheck: toCall === 0,
      canRaise,
      minTo: Math.min(this.currentBet + this.minRaise, maxTo),
      maxTo,
    };
  }

  act(i, type, amount) {
    if (this.phase === 'idle' || this.toAct !== i) throw new Error('Сейчас не ваш ход');
    const s = this.seats[i];
    const L = this.legal(i);
    if (type === 'fold') {
      s.folded = true;
    } else if (type === 'check') {
      if (!L.canCheck) throw new Error('Чек невозможен: есть ставка');
    } else if (type === 'call') {
      if (L.toCall <= 0) throw new Error('Нечего уравнивать');
      this._post(i, L.toCall);
    } else if (type === 'raise') {
      const to = Math.floor(Number(amount));
      if (!L.canRaise) throw new Error('Повышение невозможно');
      if (!Number.isFinite(to) || to < L.minTo || to > L.maxTo || to <= this.currentBet) {
        throw new Error('Неверный размер ставки');
      }
      const raiseBy = to - this.currentBet;
      const full = raiseBy >= this.minRaise;
      this._post(i, to - s.bet);
      if (full) this.minRaise = raiseBy;
      this.currentBet = to;
    } else {
      throw new Error('Неизвестное действие');
    }
    s.acted = true;
    this._advance(i);
  }

  // Сброс карт вне очереди: игрок вышел из-за стола.
  forceFold(i) {
    const s = this.seats[i];
    if (!s || this.phase === 'idle' || !s.inHand || s.folded) return;
    if (this.toAct === i) return this.act(i, 'fold');
    s.folded = true;
    const alive = this.seats.filter((p) => p && p.inHand && !p.folded);
    if (alive.length === 1) return this._finish(false);
    // Улица уже закрыта и ждёт дилера: торговлю на ней заново не открываем.
    if (this.waitStreet || this.toAct < 0) return;
    if (!this._needsAction(this.toAct)) this._advance(this.toAct);
  }

  _advance(from) {
    const alive = this.seats.filter((s) => s && s.inHand && !s.folded);
    if (alive.length === 1) return this._finish(false);
    const next = this.nextSeat(from, (i) => this._needsAction(i));
    if (next !== -1) { this.toAct = next; return; }
    this._nextStreet();
  }

  _nextStreet() {
    // Ставки закрыты, а ходить больше некому (все или все кроме одного в олл-ине): дальше карты
    // докладываются сами. Запоминаем, с какой улицы это началось, — для показа шансов по улицам.
    if (this.runoutFrom == null && this.board.length < 5) {
      const alive = this.seats.filter((s) => s && s.inHand && !s.folded).length;
      const canAct = this.seats.filter((s, i) => this.canAct(i)).length;
      if (alive > 1 && canAct < 2) this.runoutFrom = this.board.length;
    }
    for (const s of this.seats) if (s) { s.bet = 0; s.acted = false; }
    this.currentBet = 0;
    this.minRaise = this.cfg.bb;
    if (this.phase === 'river') return this._finish(true);
    // Карты раздаёт дилер: круг торговли закончился — следующая улица ждёт его команды (openStreet).
    if (this.holdStreets) { this.waitStreet = true; this.toAct = -1; return; }
    this._dealStreet();
  }

  // Дилер открывает следующую улицу. false — если открывать нечего.
  openStreet() {
    if (!this.waitStreet || this.phase === 'idle') return false;
    this.waitStreet = false;
    this._dealStreet();
    return true;
  }

  _dealStreet() {
    if (this.phase === 'preflop') {
      this.phase = 'flop';
      this.board.push(this.deck.pop(), this.deck.pop(), this.deck.pop());
    } else {
      this.phase = this.phase === 'flop' ? 'turn' : 'river';
      this.board.push(this.deck.pop());
    }
    const next = this.nextSeat(this.button, (i) => this._needsAction(i));
    if (next !== -1) { this.toAct = next; return; }
    this._nextStreet(); // все в олл-ине: докладываем карты до конца
  }

  _finish(showdown) {
    this.toAct = -1;
    const idx = [];
    for (let i = 0; i < SEATS; i++) if (this.seats[i] && this.seats[i].inHand) idx.push(i);
    const alive = idx.filter((i) => !this.seats[i].folded);
    const total = this.pot();
    const payouts = {};
    const pots = [];
    const hands = {};
    const pay = (i, n) => { payouts[i] = (payouts[i] || 0) + n; };

    if (!showdown) {
      pots.push({ amount: total, winners: [alive[0]], refund: false });
      pay(alive[0], total);
    } else {
      for (const i of alive) hands[i] = evaluate(this.seats[i].cards.concat(this.board));
      const levels = [...new Set(alive.map((i) => this.seats[i].total))].sort((a, b) => a - b);
      let prev = 0;
      let distributed = 0;
      for (const level of levels) {
        let amount = 0;
        for (const i of idx) {
          const t = this.seats[i].total;
          amount += Math.min(t, level) - Math.min(t, prev);
        }
        prev = level;
        if (amount <= 0) continue;
        distributed += amount;
        const elig = alive.filter((i) => this.seats[i].total >= level);
        pots.push({ amount, elig });
      }
      if (distributed < total && pots.length) pots[pots.length - 1].amount += total - distributed;
      for (const p of pots) {
        let best = null;
        let winners = [];
        for (const i of p.elig) {
          const c = best ? compareScores(hands[i], best) : 1;
          if (c > 0) { best = hands[i]; winners = [i]; } else if (c === 0) winners.push(i);
        }
        // Неделимый остаток получают первые победители слева от баттона.
        winners.sort((a, b) => ((a - this.button - 1 + SEATS) % SEATS) - ((b - this.button - 1 + SEATS) % SEATS));
        const share = Math.floor(p.amount / winners.length);
        let rest = p.amount - share * winners.length;
        for (const w of winners) { pay(w, share + (rest > 0 ? 1 : 0)); rest--; }
        p.winners = winners;
        p.refund = p.elig.length === 1; // неуравненная часть ставки возвращается
        delete p.elig;
      }
    }
    for (const i in payouts) this.seats[i].stack += payouts[i];
    for (const s of this.seats) if (s) s.bet = 0;
    const handInfo = {};
    for (const i in hands) {
      const best = bestFive(this.seats[i].cards.concat(this.board));
      handInfo[i] = { score: hands[i], name: handName(hands[i]), five: best.five, core: best.core };
    }
    // Олл-ин: шансы каждого игрока перед каждой выложенной сами картами улицей.
    let runout = null;
    if (showdown && this.runoutFrom != null) {
      const holes = {};
      for (const i of alive) holes[i] = this.seats[i].cards;
      const stages = [0, 3, 4].filter((n) => n >= this.runoutFrom).map((n) => {
        const board = this.board.slice(0, n);
        const eq = equities(holes, board);
        return { board: n, eq, outs: outsOf(holes, board) };
      });
      runout = { from: this.runoutFrom, stages, live: !!this.holdStreets }; // live — улицы уже открывал дилер, повторять не нужно
    }
    // Все сбросили до ривера: какие карты стола пришли бы дальше (по порядку колоды).
    let rest = null;
    if (!showdown && this.board.length < 5 && this.deck) {
      rest = [];
      for (let k = 0; k < 5 - this.board.length; k++) rest.push(this.deck[this.deck.length - 1 - k]);
    }
    this.result = { showdown, pots, payouts, hands: handInfo, total, runout, rest };
    this.phase = 'idle';
  }
}

module.exports = { Game, outsOf, improveOuts, evaluate, bestFive, outlook, equities, compareScores, handName, newDeck, shuffle, SEATS };
