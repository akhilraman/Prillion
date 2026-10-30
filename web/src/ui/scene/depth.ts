import type { RoundState } from '../../domain/round.ts';
import { TIER_RULES } from '../../domain/scoring.ts';
import type { RarityTier } from '../../domain/types.ts';

/**
 * How far one correct answer sinks the diver, by rarity tier.
 * Depth is derived from the answer's tier, never stored.
 */
export const TIER_METRES: Record<RarityTier, number> = {
  common: 800,
  uncommon: 1500,
  rare: 2500,
  legendary: 4000,
};

const METRES_BY_POINTS: Readonly<Record<number, number>> = Object.fromEntries(
  TIER_RULES.map((rule) => [rule.points, TIER_METRES[rule.tier]]),
);

/** How long the dive takes on screen. Keep in step with `transition: --metres` in index.css. */
export const SINK_MS = 3000;

/** Metres for one answer's points (0 on a miss). */
export function sinkMetres(points: number): number {
  return METRES_BY_POINTS[points] ?? 0;
}

/** Total depth so far; includes the answer on screen once it is revealed. */
export function diveMetres(state: RoundState): number {
  if (state.phase === 'idle') return 0;
  return state.results.reduce((sum, result) => sum + sinkMetres(result.points), 0);
}
