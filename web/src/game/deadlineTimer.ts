/**
 * Deadline watcher: the framework-free core of the countdown.
 *
 * Browser timers (setInterval/setTimeout) are NOT reliable clocks. Background
 * tabs throttle them to ~1/second or worse and may freeze them entirely. So we
 * never count ticks. Every check recomputes remaining time from an absolute
 * deadline and a monotonic clock:
 *
 *     remaining = deadline - now()
 *
 * Ticks are just "wake-ups to re-render"; a late wake-up shows the right number.
 * `check()` is exposed so the UI can force a re-check the instant the tab
 * becomes visible again.
 *
 * The clock and callbacks are injected, so this is testable in plain Node.
 */

export interface DeadlineWatcherOptions {
  deadlineMs: number;
  /** Monotonic clock, e.g. `() => performance.now()`. Must be the same clock `deadlineMs` uses. */
  now: () => number;
  onTick: (remainingMs: number) => void;
  /** Called at most once, when remaining reaches 0. */
  onExpire: () => void;
  tickMs?: number;
}

export interface DeadlineWatcher {
  /** Re-evaluate immediately (e.g. on `visibilitychange`). Safe to call any time. */
  check(): void;
  /** Stop all timers. Idempotent. After stop(), neither callback fires. */
  stop(): void;
}

export function watchDeadline(options: DeadlineWatcherOptions): DeadlineWatcher {
  const { deadlineMs, now, onTick, onExpire, tickMs = 200 } = options;
  let finished = false;
  let intervalId: ReturnType<typeof setInterval> | undefined;

  function stop(): void {
    finished = true;
    if (intervalId !== undefined) clearInterval(intervalId);
  }

  function check(): void {
    if (finished) return;
    const remaining = Math.max(0, deadlineMs - now());
    onTick(remaining);
    if (remaining === 0) {
      stop();
      onExpire();
    }
  }

  intervalId = setInterval(check, tickMs);
  check();
  return { check, stop };
}
