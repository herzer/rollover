import { it, expect, vi } from 'vitest';
import { Host } from '../src/net/host';

// The turn time limit (2026-10-02, "we can also make it harder by adding turn time outs"): the host ends a person's
// turn with a drawn tile when the time runs out — and only then.
it('ends a turn that runs out of time, and only that one', () => {
  vi.useFakeTimers();
  try {
    const h = new Host('me', 'Me', null);
    h.addComputer(['Robin']);
    h.setRules({ turnSeconds: 30 });
    h.start();
    const s0 = h.state!;
    expect(s0.players[s0.turn].kind).toBe('human');
    const rack0 = s0.players[s0.turn].rack.length;
    vi.advanceTimersByTime(29000);
    expect(h.state!.seq).toBe(s0.seq);                              // still thinking: nothing happens
    vi.advanceTimersByTime(2600);                                   // 30 s plus the network grace
    const s1 = h.state!;
    expect(s1.seq).not.toBe(s0.seq);
    expect(s1.players[0].rack.length).toBe(rack0 + 3);             // the turn ended with 3 penalty tiles
    expect(s1.log[s1.log.length - 1]).toMatchObject({ k: 'draw', p: 0, n: 3, timeout: true });
  } finally { vi.useRealTimers(); }
});

it('never times out a turn that already ended', () => {
  vi.useFakeTimers();
  try {
    const h = new Host('me', 'Me', null);
    h.addComputer(['Robin']);
    h.setRules({ turnSeconds: 30 });
    h.start();
    const seq = h.state!.seq;
    h.receive('me', { t: 'draw', seq });                            // the person draws in time
    const after = h.state!.log.length;
    vi.advanceTimersByTime(31000);                                  // the old turn's timer would have fired by now
    expect(h.state!.log.slice(after).some((e) => 'timeout' in e && e.timeout && e.p === 0)).toBe(false);
    // the computer has played and it is the person's turn again, with a fresh 30 seconds
    expect(h.state!.turn).toBe(0);
    expect(Date.now() - h.state!.turnStartedAt).toBeLessThan(30000);
  } finally { vi.useRealTimers(); }
});

it('the penalty takes what the pool still has, and passes when it is empty', async () => {
  const { newGame, drawTile } = await import('../src/engine/game');
  const s = newGame([{ id: 'a', name: 'A', kind: 'human' }, { id: 'b', name: 'B', kind: 'ai', level: 2 }], { rollover: true, stars: false, openingMin: 30 }, 7);
  const low = { ...s, pool: s.pool.slice(0, 2) };
  const r = drawTile(low, low.turn, 3);
  expect(r.ok && r.state.players[low.turn].rack.length).toBe(low.players[low.turn].rack.length + 2);
  expect(r.ok && r.state.log[r.state.log.length - 1]).toMatchObject({ k: 'draw', n: 2 });
  const empty = drawTile({ ...s, pool: [] }, s.turn, 3);
  expect(empty.ok && empty.state.log[empty.state.log.length - 1]).toMatchObject({ k: 'pass' });
});
