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
    expect(s1.players[0].rack.length).toBe(rack0 + 1);             // the turn ended with a drawn tile
    expect(s1.log[s1.log.length - 1]).toMatchObject({ k: 'draw', p: 0, timeout: true });
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
