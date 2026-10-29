/**
 * Rarity-based scoring.
 *
 * Design constraints (from the product brief):
 *  - Deterministic: same inputs -> same score. No randomness, no clocks.
 *  - Explainable: we can always say "you got X points because this answer's
 *    share was Y% of the most popular answer's share, which is the Z tier".
 *  - Robust: one odd submission must not swing scores, and sparse data must
 *    not be trusted.
 *  - Not exploitable by absence: unknown answers score 0 here. They go to a
 *    review queue instead of earning a "maximum rarity" bonus.
 *
 * Why tiers are RELATIVE to the question's top answer
 * ---------------------------------------------------
 * The first version used absolute thresholds ("a 3% share is rare"). That
 * works for 4 answers (shares of 25% each) and breaks for 40: with 37 NBA
 * MVPs even LeBron James is only ~15% of responses, so every answer would be
 * "rare" or "legendary" and the tiers would carry no information.
 *
 * Comparing each answer to the MOST POPULAR answer to the same question is
 * scale-free: "this answer is a tenth as popular as the obvious one" means
 * the same thing for 10 answers or 100.
 */

import type {
  Answer,
  AnswerObservation,
  ObservationLookup,
  Question,
  RarityTier,
  ScoreBreakdown,
} from './types.ts';

/**
 * Tier thresholds on the RELATIVE share: effectiveShare / (top answer's share).
 * Rules are ordered from most to least popular; the first match wins.
 */
export const TIER_RULES: ReadonlyArray<{ tier: RarityTier; minRelative: number; points: number }> = [
  { tier: 'common', minRelative: 0.5, points: 100 },
  { tier: 'uncommon', minRelative: 0.2, points: 200 },
  { tier: 'rare', minRelative: 0.05, points: 350 },
  { tier: 'legendary', minRelative: 0, points: 500 },
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

/**
 * No answer may be treated as rarer than this, however few people pick it.
 *
 * It must stay below the smallest share a large closed set can legitimately hold.
 * A closed set sums to ~1, so a 100-answer set averages 1% and its rarest tier sits
 * well under 0.5%. At 0.005 those answers were clamped up and the rarest tiers
 * collapsed into one (Best Picture, 98 winners, scored as only 2 tiers).
 */
export const MIN_SHARE_FLOOR = 0.001;

/** The part of a Question the scorer needs. */
export type ScorableQuestion = Pick<Question, 'id' | 'answers'>;

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

/** Maps a relative share (0..1, 1 = the most popular answer) to a tier. */
export function tierForRelativeShare(relative: number): { tier: RarityTier; points: number } {
  for (const rule of TIER_RULES) {
    if (relative >= rule.minRelative) return { tier: rule.tier, points: rule.points };
  }
  // Unreachable because the last rule has minRelative 0, but keeps the types honest.
  const last = TIER_RULES[TIER_RULES.length - 1]!;
  return { tier: last.tier, points: last.points };
}

/** Scores every answer of a question at once (one pass to find the top share). */
export function scoreQuestionAnswers(
  question: ScorableQuestion,
  observations: ObservationLookup = () => undefined,
): Map<string, ScoreBreakdown> {
  const shares = question.answers.map((answer) => ({
    answer,
    ...effectiveShare(answer, observations(question.id, answer.id)),
  }));
  const topShare = shares.reduce((max, s) => Math.max(max, s.share), MIN_SHARE_FLOOR);

  const scores = new Map<string, ScoreBreakdown>();
  for (const { answer, share, usedObservations } of shares) {
    const relativeShare = Math.min(1, share / topShare);
    const { tier, points } = tierForRelativeShare(relativeShare);
    scores.set(answer.id, { tier, points, effectiveShare: share, topShare, relativeShare, usedObservations });
  }
  return scores;
}

/**
 * Scores one answer in the context of its question. An answer's rarity is only
 * meaningful relative to the other answers to the SAME question.
 * Returns undefined if the answer does not belong to the question.
 */
export function scoreAnswer(
  question: ScorableQuestion,
  answerId: string,
  observations: ObservationLookup = () => undefined,
): ScoreBreakdown | undefined {
  return scoreQuestionAnswers(question, observations).get(answerId);
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}
