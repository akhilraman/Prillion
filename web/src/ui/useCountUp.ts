import { useEffect, useRef, useState } from 'react';

interface CountUpOptions {
  durationMs?: number;
  /** Lets the scene start scrolling before the numbers move. */
  delayMs?: number;
}

function prefersReducedMotion(): boolean {
  // jsdom (tests) has no matchMedia: treat that as "no animation" so numbers are exact.
  return (
    typeof window.matchMedia !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * A number that glides to its target instead of jumping. Purely cosmetic: the real value is
 * always `target`, and with reduced motion (or no animation support) it is returned as-is.
 */
export function useCountUp(
  target: number,
  { durationMs = 1400, delayMs = 250 }: CountUpOptions = {},
): number {
  const [shown, setShown] = useState(target);
  const latest = useRef(target);
  const reduced = prefersReducedMotion();

  useEffect(() => {
    if (reduced || latest.current === target) return;

    const from = latest.current;
    let frame = 0;
    let startedAt: number | undefined;

    const step = (now: number) => {
      startedAt ??= now + delayMs;
      const t = Math.min(1, Math.max(0, (now - startedAt) / durationMs));
      const eased = 1 - (1 - t) ** 3; // ease-out: fast at first, settling gently
      latest.current = Math.round(from + (target - from) * eased);
      setShown(latest.current);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, reduced, durationMs, delayMs]);

  return reduced ? target : shown;
}
