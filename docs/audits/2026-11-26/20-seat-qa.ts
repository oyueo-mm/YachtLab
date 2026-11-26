// One normal 20-seat match against the repository's local Wrangler service.
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Client, api, closeAllClients } from '../../../tests/helpers/online-client';

const server = 'http://127.0.0.1:8787';
const seats = 20;
const mode = process.argv.includes('--simultaneous') ? 'simultaneous' : 'turns';
const start = performance.now();
const clients: Client[] = [];
async function until(condition: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    assert(Date.now() < deadline, 'Expected match view did not arrive');
    await delay(15);
  }
}
try {
  const first = await api(server, '/api/rooms', { name: 'QA 01', maxPlayers: seats, settings: { mode, timeoutMs: mode === 'turns' ? null : 120_000 } });
  assert.equal(first.status, 201);
  const { code } = first.body;
  for (let seat = 0; seat < seats; seat++) {
    const joined = seat === 0 ? first : await api(server, '/api/rooms/' + code + '/join', { name: 'QA ' + String(seat + 1).padStart(2, '0') });
    assert.equal(joined.status, 201);
    const client = new Client(server, code);
    assert.equal((await client.hello(joined.body.token)).t, 'welcome');
    clients.push(client);
    if (seat > 0) client.ws.send(JSON.stringify({ t: 'ready', ready: true }));
  }
  const host = clients[0];
  await until(() => host.view?.players.length === seats &&
    host.messages.some(message => message.t === 'lobby' && Object.values(message.lobby.ready).filter(Boolean).length === seats - 1));
  assert((await host.cmd({ type: 'start' })).ok);
  async function playTurn(current: Client, round: number) {
    await until(() => current.view?.round === round && !!current.view?.legal?.canRoll);
    assert((await current.cmd({ type: 'roll', keep: [] })).ok);
    await until(() => !!current.view?.legal?.scores.length);
    const choices = current.view!.legal!.scores;
    const best = choices.reduce((winner, score) => score.points > winner.points ? score : winner);
    assert((await current.cmd({ type: 'score', category: best.category })).ok);
  }
  for (let round = 1; round <= 12; round++) {
    if (mode === 'simultaneous') {
      await Promise.all(clients.map(client => playTurn(client, round)));
    } else {
      for (const client of clients) await playTurn(client, round);
    }
  }
  await until(() => clients.every(client => client.view?.status === 'finished'));
  const view = host.view!;
  assert.equal(view.standings?.length, seats);
  assert(view.players.every(player => Object.keys(player.card).length === 12));
  assert(view.players.every(player => player.bonus === (player.upper >= 63 ? 35 : 0)));
  assert(clients.every(client => JSON.stringify(client.view?.standings) === JSON.stringify(view.standings)));
  console.log(JSON.stringify({
    mode, seats, rounds: 12, turns: seats * 12, completed: true, consistentStandings: true,
    elapsedSeconds: Math.round((performance.now() - start) / 100) / 10,
  }, null, 2));
} finally {
  closeAllClients();
}
