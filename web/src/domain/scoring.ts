/**
 * Rarity-based scoring.
 *
 * Design constraints (from the product brief):
 *  - Deterministic: same inputs -> same score. No randomness, no clocks.
 *  - Explainable: we can always say "you got X points because the answer's
 *    effective share was Y, which is the Z tier".
 *  - Robust: one odd submission must not swing scores, and sparse data must
 *    not be trusted.
 *  - Not exploitable by absence: unknown answers score 0 here. They go to a
 *    review queue instead of earning a "maximum rarity" bonus.
 */

import type { Answer, AnswerObservation, RarityTier, ScoreBreakdown } from './types.ts';

/** Tier thresholds on the effective share (fraction of correct responses). */
export const TIER_RULES: ReadonlyArray<{ tier: RarityTier; minShare: number; points: number }> = [
  { tier: 'common', minShare: 0.25, points: 100 },
  { tier: 'uncommon', minShare: 0.1, points: 200 },
  { tier: 'rare', minShare: 0.03, points: 350 },
  { tier: 'legendary', minShare: 0, points: 500 },
];

/**
 * Observed data is ignored until the question has at least this many accepted
 * submissions. Below it, proportions are noise (3 of 5 players is not "60%").
 */
export const MIN_OBSERVED_TOTAL = 50;

/**
 * Strength of the curated prior, in "pseudo-observations". The blended share is
 *   (count + prior * K) / (total + K)
 * which behaves like the editor having already seen K players answer
 * according to the prior. A burst of unusual submissions moves the estimate
 * gradually instead of replacing it.
 */
export const PRIOR_STRENGTH = 100;

/** No answer may be treated as rarer than this, however few people pick it. */
export const MIN_SHARE_FLOOR = 0.005;

export function effectiveShare(
  answer: Pick<Answer, 'familiarity'>,
  observation?: AnswerObservation,
): { share: number; usedObservations: boolean } {
  const prior = clamp(answer.familiarity, MIN_SHARE_FLOOR, 1);

  if (!observation || observation.total < MIN_OBSERVED_TOTAL || observation.count > observation.total) {
    return { share: prior, usedObservations: false };
  }

  const blended = (observation.count + prior * PRIOR_STRENGTH) / (observation.total + PRIOR_STRENGTH);
  return { share: clamp(blended, MIN_SHARE_FLOOR, 1), usedObservations: true };
}

export function tierForShare(share: number): { tier: RarityTier; points: number } {
  for (const rule of TIER_RULES) {
    if (share >= rule.minShare) return { tier: rule.tier, points: rule.points };
  }
  // Unreachable because the last rule has minShare 0, but keeps the types honest.
  const last = TIER_RULES[TIER_RULES.length - 1]!;
  return { tier: last.tier, points: last.points };
}

export function scoreAnswer(
  answer: Pick<Answer, 'familiarity'>,
  observation?: AnswerObservation,
): ScoreBreakdown {
  const { share, usedObservations } = effectiveShare(answer, observation);
  const { tier, points } = tierForShare(share);
  return { tier, points, effectiveShare: share, usedObservations };
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}
