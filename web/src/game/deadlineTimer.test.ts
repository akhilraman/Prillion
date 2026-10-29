import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchDeadline } from './deadlineTimer.ts';

describe('watchDeadline', () => {
  let clock = 0;
  const now = () => clock;

  beforeEach(() => {
    vi.useFakeTimers();
    clock = 1000;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Advance both the injected clock and the fake timers together (a healthy foreground tab). */
  function advance(ms: number) {
    clock += ms;
    vi.advanceTimersByTime(ms);
  }

  it('ticks immediately with the full remaining time', () => {
    const onTick = vi.fn();
    watchDeadline({ deadlineMs: 6000, now, onTick, onExpire: vi.fn() });
    expect(onTick).toHaveBeenCalledWith(5000);
  });

  it('reports a decreasing remaining time', () => {
    const ticks: number[] = [];
    watchDeadline({ deadlineMs: 2000, now, onTick: (r) => ticks.push(r), onExpire: vi.fn(), tickMs: 250 });
    advance(500);
    expect(ticks[0]).toBe(1000);
    expect(ticks.at(-1)).toBe(500);
    expect(ticks).toEqual([...ticks].sort((a, b) => b - a));
  });

  it('expires exactly once and stops ticking', () => {
    const onExpire = vi.fn();
    const onTick = vi.fn();
    watchDeadline({ deadlineMs: 1500, now, onTick, onExpire, tickMs: 100 });
    advance(2000);
    expect(onExpire).toHaveBeenCalledTimes(1);
    const callsAtExpiry = onTick.mock.calls.length;
    advance(5000);
    expect(onTick.mock.calls.length).toBe(callsAtExpiry);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('never reports negative remaining time', () => {
    const ticks: number[] = [];
    watchDeadline({ deadlineMs: 1100, now, onTick: (r) => ticks.push(r), onExpire: vi.fn(), tickMs: 100 });
    advance(1000);
    expect(Math.min(...ticks)).toBe(0);
  });

  it('is correct after a throttled/frozen background tab: check() uses the clock, not tick counts', () => {
    const onExpire = vi.fn();
    const onTick = vi.fn();
    const w = watchDeadline({ deadlineMs: 11_000, now, onTick, onExpire });
    // The tab freezes: the clock moves 6s but NO timer callbacks run.
    clock += 6000;
    expect(onExpire).not.toHaveBeenCalled();
    w.check(); // what the visibilitychange handler does
    expect(onTick).toHaveBeenLastCalledWith(4000);
    // ...and freezes again past the deadline.
    clock += 60_000;
    w.check();
    expect(onTick).toHaveBeenLastCalledWith(0);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('stop() prevents any further callbacks', () => {
    const onExpire = vi.fn();
    const onTick = vi.fn();
    const w = watchDeadline({ deadlineMs: 3000, now, onTick, onExpire, tickMs: 100 });
    w.stop();
    const calls = onTick.mock.calls.length;
    advance(10_000);
    w.check();
    expect(onTick.mock.calls.length).toBe(calls);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('expires immediately if the deadline has already passed', () => {
    const onExpire = vi.fn();
    watchDeadline({ deadlineMs: 500, now, onTick: vi.fn(), onExpire });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});
