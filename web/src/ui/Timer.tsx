import { useEffect, useRef, useState } from 'react';
import { watchDeadline } from '../game/deadlineTimer.ts';

interface TimerProps {
  deadlineMs: number;
  totalSeconds: number;
  onExpire: () => void;
}

/**
 * Owns the countdown's own state so that ticking (5x/second) re-renders ONLY this
 * small component, never the question panel or the answer field the user is typing in.
 */
export function Timer({ deadlineMs, totalSeconds, onExpire }: TimerProps) {
  const [remainingMs, setRemainingMs] = useState(() => Math.max(0, deadlineMs - performance.now()));

  // Keep the latest callback without restarting the timer when the parent re-renders.
  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onExpireRef.current = onExpire;
  });

  useEffect(() => {
    const watcher = watchDeadline({
      deadlineMs,
      now: () => performance.now(),
      onTick: setRemainingMs,
      onExpire: () => onExpireRef.current(),
    });
    // Browsers throttle timers in background tabs; re-sync from the real clock
    // the moment the player returns.
    const resync = () => watcher.check();
    document.addEventListener('visibilitychange', resync);
    window.addEventListener('focus', resync);
    return () => {
      document.removeEventListener('visibilitychange', resync);
      window.removeEventListener('focus', resync);
      watcher.stop();
    };
  }, [deadlineMs]);

  const seconds = Math.ceil(remainingMs / 1000);
  const fraction = Math.min(1, remainingMs / (totalSeconds * 1000));

  return (
    <div className={`timer${seconds <= 5 ? ' timer--low' : ''}`} role="timer" aria-live="off">
      <span className="timer__label">Time</span>
      <span className="timer__value">{seconds}s</span>
      <span className="timer__track" aria-hidden="true">
        <span className="timer__bar" style={{ transform: `scaleX(${fraction})` }} />
      </span>
    </div>
  );
}
