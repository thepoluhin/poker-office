'use strict';
// Автотесты движка: node test.js
const assert = require('assert');
const crypto = require('crypto');
const { Game, evaluate, bestFive, outlook, equities, compareScores, handName, newDeck } = require('./engine');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.log('FAIL  ' + name + '\n      ' + e.message); process.exitCode = 1; }
}
const ev = (s) => evaluate(s.split(' '));
// Колода, из которой карты выйдут в заданном порядке (движок берёт с конца).
function stacked(order) {
  const used = order.split(' ');
  const rest = newDeck().filter((c) => !used.includes(c));
  return rest.concat(used.slice().reverse());
}
function table(stacks, cfg) {
  const g = new Game(Object.assign({ sb: 10, bb: 20, startStack: 1000 }, cfg));
  stacks.forEach((st, i) => { if (st != null) g.sit(i, { name: 'P' + i, stack: st }); });
  return g;
}
const chips = (g) => g.seats.reduce((n, s) => n + (s ? s.stack + s.total * (g.phase === 'idle' ? 0 : 1) : 0), 0);

console.log('Комбинации');
test('категории определяются верно', () => {
  assert.strictEqual(handName(ev('As Ks Qs Js Ts 2d 3c')), 'роял-флеш');
  assert.strictEqual(handName(ev('9s 8s 7s 6s 5s Ad Ac')), 'стрит-флеш');
  assert.strictEqual(handName(ev('9s 9h 9d 9c 5s Ad Ac')), 'каре');
  assert.strictEqual(handName(ev('9s 9h 9d 5c 5s Ad 2c')), 'фулл-хаус');
  assert.strictEqual(handName(ev('As 9s 7s 6s 2s Ad Ac')), 'флеш');
  assert.strictEqual(handName(ev('9s 8h 7d 6c 5s Ad Ac')), 'стрит');
  assert.strictEqual(handName(ev('9s 9h 9d 6c 5s Ad 2c')), 'сет');
  assert.strictEqual(handName(ev('9s 9h 6d 6c 5s Ad 2c')), 'две пары');
  assert.strictEqual(handName(ev('9s 9h 7d 6c 4s Ad 2c')), 'пара');
  assert.strictEqual(handName(ev('9s Jh 7d 6c 4s Ad 2c')), 'старшая карта');
});
test('колесо A-2-3-4-5 — младший стрит', () => {
  assert.deepStrictEqual(ev('As 2h 3d 4c 5s Kd Qc'), [4, 5]);
  assert.ok(compareScores(ev('2h 3d 4c 5s 6d Kc Qc'), ev('As 2h 3d 4c 5s Kd Qc')) > 0);
});
test('два сета дают фулл-хаус со старшим сетом', () => {
  assert.deepStrictEqual(ev('9s 9h 9d 5c 5s 5d 2c'), [6, 9, 5]);
});
test('три пары: берутся две старшие и лучший кикер', () => {
  assert.deepStrictEqual(ev('Ks Kh 9d 9c 5s 5d Ac'), [2, 13, 9, 14]);
});
test('кикер решает при равных парах', () => {
  assert.ok(compareScores(ev('As Ah Kd 7c 4s 3d 2c'), ev('Ad Ac Qd 7c 4s 3d 2c')) > 0);
  assert.strictEqual(compareScores(ev('As Kh 9d 9c 5s 5d 2c'), ev('Ad Kc 9d 9c 5s 5d 2c')), 0);
});
test('флеш из шести карт берёт пять старших', () => {
  assert.deepStrictEqual(ev('As Ks 9s 7s 4s 2s Qd'), [5, 14, 13, 9, 7, 4]);
});

test('сыгравшие карты: пять лучших и те, что образуют комбинацию', () => {
  const sorted = (a) => a.slice().sort().join(' ');
  let b = bestFive('As Ah Kd 7c 4s 3d 2c'.split(' '));
  assert.strictEqual(sorted(b.core), 'Ah As');
  assert.strictEqual(sorted(b.five), sorted(['As', 'Ah', 'Kd', '7c', '4s']));
  b = bestFive('Ks Kh 9d 9c 5s 5d Ac'.split(' '));
  assert.strictEqual(sorted(b.core), sorted(['Ks', 'Kh', '9d', '9c']));
  assert.ok(b.five.includes('Ac'));
  b = bestFive('9s 8s 7s 6s 5s Ad Ac'.split(' '));
  assert.strictEqual(sorted(b.core), sorted(['9s', '8s', '7s', '6s', '5s']));
  b = bestFive('As 2h 3d 4c 5s Kd Qc'.split(' '));
  assert.strictEqual(sorted(b.core), sorted(['As', '2h', '3d', '4c', '5s']), 'колесо');
  b = bestFive('Qs Qh Qd Qc 7s 2d 3c'.split(' '));
  assert.strictEqual(b.core.length, 4);
  assert.deepStrictEqual(b.score, evaluate('Qs Qh Qd Qc 7s 2d 3c'.split(' ')));
});

test('подсказка: что собрано и скольких карт не хватает', () => {
  // пара тузов на флопе с двумя червами: до флеша три карты, до сета одна
  let o = outlook('Ah Ad Kh 7c 2s'.split(' '), 2);
  assert.strictEqual(o.made, 1);
  assert.strictEqual(o.need[1], 0);
  assert.strictEqual(o.need[3], 1, 'сет');
  assert.strictEqual(o.need[2], 1, 'две пары');
  assert.strictEqual(o.need[6], 2, 'фулл-хаус');
  assert.strictEqual(o.need[7], 2, 'каре');
  assert.strictEqual(o.need[5], 3, 'флеш');
  // флеш-дро и двусторонний стрит-дро
  o = outlook('9h 8h 7h 6c 2h'.split(' '), 2);
  assert.strictEqual(o.made, 0);
  assert.strictEqual(o.need[5], 1, 'флеш');
  assert.strictEqual(o.need[4], 1, 'стрит');
  assert.strictEqual(o.need[8], 2, 'стрит-флеш');
  // колесо: туз работает как единица
  o = outlook('As 2d 3c 4h Kd'.split(' '), 1);
  assert.strictEqual(o.need[4], 1);
  // готовая комбинация обнуляет всё, что ниже неё
  o = outlook('Ks Kh Kd 8c 8s 2d 3c'.split(' '), 0);
  assert.strictEqual(o.made, 6);
  assert.deepStrictEqual(o.need.slice(0, 7), [0, 0, 0, 0, 0, 0, 0]);
  assert.strictEqual(o.need[7], 1);
  // роял-флеш — отдельная строка
  o = outlook('As Ks Qs Js Ts 2d 3c'.split(' '), 0);
  assert.strictEqual(o.made, 9);
  // до раздачи общих карт: две карты одной масти
  o = outlook('Qs Js'.split(' '), 5);
  assert.strictEqual(o.need[9], 3);
  assert.strictEqual(o.need[1], 1);
});

test('шансы: точные значения на тёрне и флопе, приблизительные до флопа', () => {
  // AA против KK на тёрне без помощи королям: короли выигрывают только с одним из двух оставшихся королей
  let e = equities({ 0: ['As', 'Ah'], 1: ['Ks', 'Kh'] }, ['2c', '7d', '9s', 'Jc']);
  assert.strictEqual(e[1], Math.round(2 / 44 * 100));
  assert.strictEqual(e[0] + e[1], 100);
  // одинаковые руки на флопе делят банк пополам
  e = equities({ 0: ['As', 'Kd'], 1: ['Ac', 'Kh'] }, ['2c', '7d', '9s']);
  assert.ok(Math.abs(e[0] - e[1]) <= 6 && e[0] >= 45, JSON.stringify(e));
  // AA против KK до флопа — около 82 на 18
  e = equities({ 0: ['As', 'Ah'], 1: ['Ks', 'Kh'] }, [], 4000);
  assert.ok(e[0] >= 77 && e[0] <= 87, JSON.stringify(e));
  // всё открыто: победитель 100
  e = equities({ 0: ['As', 'Ah'], 1: ['Ks', 'Kh'] }, ['2c', '7d', '9s', 'Jc', '3h']);
  assert.deepStrictEqual(e, { 0: 100, 1: 0 });
});
test('олл-ин до флопа: шансы по трём улицам; все сбросили — видно, что пришло бы', () => {
  const g = table([1000, 1000, 1000]);
  g.startHand();
  g.act(0, 'raise', 1000);
  g.act(1, 'call');
  g.act(2, 'fold');
  assert.strictEqual(g.phase, 'idle');
  const ro = g.result.runout;
  assert.ok(ro && ro.from === 0 && ro.stages.map((s) => s.board).join() === '0,3,4', JSON.stringify(ro && ro.stages.map((s) => s.board)));
  assert.ok(ro.stages.every((s) => Object.keys(s.eq).join() === '0,1'));
  assert.strictEqual(g.result.rest, null);
  // обычная раздача, все сбросили на префлопе — пять карт «что бы пришло», и они не совпадают с картами игроков
  const h = table([1000, 1000, 1000]);
  h.startHand();
  h.act(0, 'fold');
  h.act(1, 'fold');
  assert.strictEqual(h.result.rest.length, 5);
  const holes = h.seats.filter(Boolean).flatMap((s) => s.cards);
  assert.ok(h.result.rest.every((c) => !holes.includes(c)));
  assert.strictEqual(h.result.runout, null);
});
test('олл-ин, но у второго игрока остались фишки — тоже докладка с шансами', () => {
  const g = table([1000, 300]);
  g.startHand();
  g.act(g.toAct, 'raise', Math.min(300, g.legal(g.toAct).maxTo));
  if (g.phase !== 'idle') g.act(g.toAct, 'call');
  assert.strictEqual(g.phase, 'idle');
  assert.ok(g.result.runout && g.result.runout.from === 0);
});

console.log('Раздача');
test('блайнды и очередь хода на троих', () => {
  const g = table([1000, 1000, 1000]);
  g.startHand();
  assert.strictEqual(g.button, 0);
  assert.strictEqual(g.seats[1].bet, 10);
  assert.strictEqual(g.seats[2].bet, 20);
  assert.strictEqual(g.toAct, 0);
});
test('один на один: баттон ставит малый блайнд и ходит первым, после флопа — вторым', () => {
  const g = table([1000, 1000]);
  g.startHand();
  assert.strictEqual(g.seats[g.button].bet, 10);
  assert.strictEqual(g.toAct, g.button);
  g.act(g.button, 'call');
  const bb = 1 - g.button;
  assert.strictEqual(g.toAct, bb, 'большой блайнд получает слово');
  g.act(bb, 'check');
  assert.strictEqual(g.phase, 'flop');
  assert.strictEqual(g.toAct, bb);
});
test('все сбросили — банк забирает оставшийся, карты не вскрываются', () => {
  const g = table([1000, 1000, 1000]);
  g.startHand();
  g.act(0, 'raise', 60);
  g.act(1, 'fold');
  g.act(2, 'fold');
  assert.strictEqual(g.phase, 'idle');
  assert.strictEqual(g.result.showdown, false);
  assert.strictEqual(g.seats[0].stack, 1030);
  assert.strictEqual(chips(g), 3000);
});
test('минимальный рейз равен предыдущему повышению', () => {
  const g = table([1000, 1000, 1000]);
  g.startHand();
  g.act(0, 'raise', 60); // повышение на 40
  assert.strictEqual(g.legal(1).minTo, 100);
  assert.throws(() => g.act(1, 'raise', 90));
  g.act(1, 'raise', 100);
});
test('нельзя ходить вне очереди и чекать при ставке', () => {
  const g = table([1000, 1000, 1000]);
  g.startHand();
  assert.throws(() => g.act(1, 'call'));
  assert.throws(() => g.act(0, 'check'));
});
test('неполный олл-ин не даёт уже ходившим повысить снова', () => {
  const g = table([1000, 130, 1000]);
  g.startHand(); // баттон 0, МБ 1, ББ 2
  g.act(0, 'raise', 100);
  g.act(1, 'raise', 130); // олл-ин, повышение всего на 30
  g.act(2, 'call');
  const L = g.legal(0);
  assert.strictEqual(L.toCall, 30);
  assert.strictEqual(L.canRaise, false);
  g.act(0, 'call');
  assert.strictEqual(g.phase, 'flop');
});
test('побочные банки: короткий стек выигрывает только основной банк', () => {
  const g = table([1000, 100, 1000]);
  // раздача идёт с места 1: P1, P2, P0, потом второй круг; борд K 7 2 9 3
  g.startHand(stacked('As Qd 8c Ah Qc 8d Ks 7h 2d 9c 3s'));
  g.act(0, 'raise', 300);
  g.act(1, 'call'); // олл-ин на 100 с тузами
  g.act(2, 'call');
  g.act(2, 'check'); g.act(0, 'check');
  g.act(2, 'check'); g.act(0, 'check');
  g.act(2, 'check'); g.act(0, 'check');
  assert.strictEqual(g.result.showdown, true);
  assert.strictEqual(g.seats[1].stack, 300, 'основной банк 3×100');
  assert.strictEqual(g.seats[2].stack, 1000 - 300 + 400, 'побочный банк 2×200 у пары дам');
  assert.strictEqual(g.seats[0].stack, 700);
  assert.strictEqual(chips(g), 2100);
});
test('неуравненная часть ставки возвращается', () => {
  const g = table([1000, 200]);
  g.startHand(stacked('2c As 7d Ah 9s 8s 4h Kd Qc'));
  const btn = g.button; // место 0: получает вторую и четвёртую карты — тузы
  g.act(btn, 'raise', 1000);
  g.act(1 - btn, 'call');
  assert.strictEqual(g.phase, 'idle');
  assert.strictEqual(g.seats[0].stack + g.seats[1].stack, 1200);
  assert.strictEqual(g.seats[0].stack, 1200);
  assert.ok(g.result.pots.some((p) => p.refund && p.amount === 800));
});
test('равные руки делят банк', () => {
  const g = table([1000, 1000]);
  g.startHand(stacked('2c 2d 3c 3d As Ks Qs Js Ts'));
  g.act(g.toAct, 'call'); g.act(g.toAct, 'check');
  for (let i = 0; i < 6; i++) g.act(g.toAct, 'check');
  assert.strictEqual(g.seats[0].stack, 1000);
  assert.strictEqual(g.seats[1].stack, 1000);
});
test('игрок без фишек и «отошедший» не получают карты', () => {
  const g = table([1000, 0, 1000, 1000]);
  g.seats[3].sittingOut = true;
  g.startHand();
  assert.strictEqual(g.seats[1].inHand, false);
  assert.strictEqual(g.seats[3].inHand, false);
  assert.strictEqual(g.seats[0].cards.length, 2);
});
test('выход из-за стола вне очереди сбрасывает карты', () => {
  const g = table([1000, 1000, 1000]);
  g.startHand();
  g.forceFold(2);
  assert.strictEqual(g.toAct, 0);
  g.act(0, 'fold');
  assert.strictEqual(g.phase, 'idle');
  assert.strictEqual(g.seats[1].stack, 1020);
});

console.log('Случайные раздачи');
test('5000 случайных раздач: фишки не теряются, игра не зависает', () => {
  const rnd = (n) => crypto.randomInt(n);
  for (let t = 0; t < 250; t++) {
    const n = 2 + rnd(5);
    const g = new Game({ sb: 10, bb: 20, startStack: 1000 });
    let total = 0;
    for (let i = 0; i < n; i++) { const st = 20 + rnd(3000); total += st; g.sit(i, { name: 'P' + i, stack: st }); }
    for (let h = 0; h < 20 && g.canStart(); h++) {
      g.startHand();
      let steps = 0;
      while (g.phase !== 'idle') {
        assert.ok(++steps < 500, 'раздача не заканчивается');
        const i = g.toAct;
        const L = g.legal(i);
        assert.ok(L, 'нет игрока для хода');
        const r = rnd(10);
        if (L.canRaise && r < 3) g.act(i, 'raise', L.minTo + rnd(L.maxTo - L.minTo + 1));
        else if (L.canCheck) g.act(i, 'check');
        else if (r < 8) g.act(i, 'call');
        else g.act(i, 'fold');
      }
      const now = g.seats.reduce((s, p) => s + (p ? p.stack : 0), 0);
      assert.strictEqual(now, total, 'сумма фишек изменилась');
      assert.ok(g.seats.every((p) => !p || p.stack >= 0));
      const paid = Object.values(g.result.payouts).reduce((a, b) => a + b, 0);
      assert.strictEqual(paid, g.result.total);
    }
  }
});

console.log(process.exitCode ? '\nЕсть ошибки' : `\nВсе тесты пройдены: ${passed}`);
