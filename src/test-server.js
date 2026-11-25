'use strict';
// Регрессионные проверки через HTTP и события браузера: node --test test-server.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const avatars = require('./public/avatars/index.json');

async function until(predicate, message, ms = 5000) {
  const end = Date.now() + ms;
  while (!await predicate()) {
    assert.ok(Date.now() < end, message);
    await delay(25);
  }
}

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'poker-test-'));
  let child;
  const streams = new Set();
  async function stop() {
    for (const close of streams) close();
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.stdin.end();
    await exited;
  }
  t.after(async () => {
    await stop();
    await fs.rm(dir, { recursive: true, force: true });
  });
  let base;
  async function start() {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1');
    await once(probe, 'listening');
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
      env: { ...process.env, LOCALAPPDATA: dir, POKER_LAUNCHER: '1', POKER_SINGLE_HOST: '1', PORT: String(port) },
      windowsHide: true, stdio: ['pipe', 'pipe', 'inherit'],
    });
    const lines = readline.createInterface({ input: child.stdout });
    for await (const line of lines) {
      if (line.startsWith('@@READY ')) {
        base = 'http://127.0.0.1:' + JSON.parse(line.slice(8)).port;
        return;
      }
    }
    assert.fail('Сервер завершился до запуска');
  }
  async function post(route, body) {
    const response = await fetch(base + '/api/' + route, {
      method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
    });
    const data = await response.json();
    assert.ok(response.ok, JSON.stringify(data));
    return data;
  }
  async function connect(token) {
    const req = http.get(base + '/api/events?token=' + token);
    const [res] = await once(req, 'response');
    assert.equal(res.statusCode, 200);
    const lines = readline.createInterface({ input: res });
    function close() {
      lines.close();
      req.destroy();
      streams.delete(close);
    }
    streams.add(close);
    const player = { cmd: (type, fields) => post('cmd', { token, type, ...fields }), close };
    let event;
    lines.on('line', line => {
      if (line.startsWith('event: ')) event = line.slice(7);
      if (event === 'state' && line.startsWith('data: ')) player.state = JSON.parse(line.slice(6));
    });
    await until(() => player.state, 'Нет состояния стола');
    return player;
  }
  async function join(name, avatar) {
    const { token } = await post('join', { name, avatar });
    return connect(token);
  }
  return { dir, start, stop, join, connect };
}

for (const mode of ['ручная', 'автоматическая', 'турнирная']) {
  test('жеребьёвка: ' + mode + ' раздача', async t => {
    const f = await fixture(t);
    await f.start();
    const host = await f.join('Ведущий', avatars[0]);
    const guest = await f.join('Гость', avatars[1]);
    const observer = await f.join('Наблюдатель', avatars[2]);
    if (mode === 'турнирная') {
      await host.cmd('tourGather');
      await guest.cmd('tourAnswer', { agree: true });
      await host.cmd('tourStart');
    } else {
      if (mode === 'автоматическая') await host.cmd('settings', { nextHand: 'auto' });
      await guest.cmd('ready', { value: true });
      await host.cmd('start');
    }
    const players = [host, guest];
    for (const p of [...players, observer]) await until(() => p.state.buttonDraw, 'Не видно жеребьёвки', 8000);
    const { winner, cards } = host.state.buttonDraw;
    const participatingSeats = players.map(p => p.state.you.seat);
    assert.equal(cards.filter(Boolean).length, 2);
    assert.equal(new Set(cards.filter(Boolean)).size, 2);
    for (const seat of participatingSeats) assert.match(cards[seat], /^[2-9TJQKA][shdc]$/);
    for (const p of [...players, observer]) {
      assert.deepEqual(p.state.buttonDraw.cards, cards);
      assert.equal(p.state.buttonDraw.winner, winner);
      assert.equal(p.state.pot, 0);
      assert.equal(p.state.phase, 'idle');
      assert.ok(p.state.seats.every(s => !s || !s.hasCards));
    }
    const strength = c => '23456789TJQKA'.indexOf(c[0]) * 4 + 'cdhs'.indexOf(c[1]);
    assert.equal(strength(cards[winner]), Math.max(...cards.filter(Boolean).map(strength)));
    if (mode === 'автоматическая') {
      assert.ok(host.state.buttonDraw.remainingMs > 0 && host.state.buttonDraw.remainingMs <= 7000);
    } else {
      assert.equal(host.state.dealerSeat, winner);
      const dealer = players.find(p => p.state.you.seat === winner);
      const other = players.find(p => p !== dealer);
      await assert.rejects(other.cmd('deal'), /дилер/i);
      await dealer.cmd('deal');
    }
    await until(() => host.state.phase === 'preflop', 'Первая раздача не началась', 10000);
    assert.equal(host.state.button, winner);
    assert.ok(!host.state.buttonDraw);
    assert.ok(host.state.pot > 0);
    if (mode === 'ручная') {
      const dealer = players.find(p => p.state.you.seat === winner);
      const next = players.find(p => p !== dealer);
      await dealer.cmd('act', { action: 'fold' });
      await until(() => host.state.waitDealer, 'Игра не ждёт следующего дилера');
      assert.ok(!host.state.buttonDraw);
      assert.equal(host.state.dealerSeat, next.state.you.seat);
      await next.cmd('deal');
      await until(() => host.state.phase === 'preflop', 'Вторая раздача не началась');
      assert.equal(host.state.button, next.state.you.seat);
    }
  });
}

for (const move of ['fold', 'check']) {
  test('пауза и уход действующего игрока: автоматический ' + move, async t => {
    const f = await fixture(t);
    await f.start();
    const host = await f.join('Ведущий', avatars[0]);
    const guest = await f.join('Гость', avatars[1]);
    await guest.cmd('ready', { value: true });
    await host.cmd('start');
    await until(() => host.state.buttonDraw, 'Нет жеребьёвки');
    const button = [host, guest].find(p => p.state.you.seat === host.state.buttonDraw.winner);
    const blind = button === host ? guest : host;
    await button.cmd('deal');
    const actor = move === 'fold' ? button : blind;
    const remaining = actor === host ? guest : host;
    if (move === 'check') await button.cmd('act', { action: 'call' });
    await until(() => actor.state.toAct === actor.state.you.seat, 'Не наступил ход');
    assert.equal(actor.state.legal.canCheck, move === 'check');
    await host.cmd('pauseRequest');
    const seat = actor.state.you.seat;
    actor.close();
    await until(() => remaining.state.paused && !remaining.state.seats[seat].connected, 'Игрок не отключился');
    await remaining.cmd('resume');
    await until(() => !remaining.state.paused && remaining.state.turnLeft > 0, 'Нет резервного таймера');
    await until(() => remaining.state.seats[seat].sittingOut, 'Таймер не завершил ход', 35000);
    assert.equal(remaining.state.seats[seat].folded, move === 'fold');
  });
}

test('выход и перезапуск сохраняют нулевой стек и докупки из сохранения версии 2', async t => {
  const f = await fixture(t);
  const saveDir = path.join(f.dir, 'PokerLAN');
  await fs.mkdir(saveDir);
  const name = 'Игрок';
  const token = 'test-session';
  await fs.writeFile(path.join(saveDir, 'table.json'), JSON.stringify({
    version: 2, savedAt: Date.now(), people: [{ name, token, avatar: avatars[0], seat: 0,
      chips: { stack: 0, buyins: 2, bought: 40000 } }],
  }));
  await f.start();
  const player = await f.connect(token);
  await player.cmd('quit');
  await f.stop();
  await f.start();
  const returned = await f.join(name, avatars[0]);
  const seat = returned.state.seats[returned.state.you.seat];
  assert.equal(seat.stack, 0);
  assert.equal(seat.buyins, 2);
  assert.equal(seat.net, -40000);
});

test('ошибка записи видна ведущему и снимается после успешной записи', async t => {
  const f = await fixture(t);
  const saveDir = path.join(f.dir, 'PokerLAN');
  await fs.mkdir(saveDir);
  const obstacle = path.join(saveDir, 'table.json.tmp');
  await fs.mkdir(obstacle);
  await f.start();
  const host = await f.join('Ведущий', avatars[0]);
  const guest = await f.join('Гость', avatars[1]);
  await until(() => host.state.saveWarning, 'Нет предупреждения');
  assert.equal(host.state.saveWarning.lastSavedAt, null);
  assert.ok(!guest.state.saveWarning);
  await fs.rmdir(obstacle);
  await until(() => !host.state.saveWarning, 'Предупреждение не снято', 8000);
  const snapshot = JSON.parse(await fs.readFile(path.join(saveDir, 'table.json'), 'utf8'));
  await fs.mkdir(obstacle);
  await guest.cmd('ready', { value: true });
  await until(() => host.state.saveWarning, 'Повторная ошибка не показана');
  assert.ok(host.state.saveWarning.lastSavedAt >= snapshot.savedAt);
  assert.ok(host.state.saveWarning.lastSavedAt <= Date.now());
  assert.ok(!guest.state.saveWarning);
});
