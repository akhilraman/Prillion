/**
 * Editorial quality gate.
 *
 * `validateQuestionBank` answers "is this well-formed data?" (structure).
 * This answers "is this a GOOD question?" (editorial). They are separate on
 * purpose:
 *  - The game loader only needs structure; a thin-but-valid question must not
 *    crash the app.
 *  - The content pipeline and the seed-bank contract test use this gate to
 *    refuse questions that cannot produce meaningful rarity.
 *
 * The rule of thumb behind it: rarity needs a spread. A question with three
 * valid answers cannot tell a popular answer from an obscure one.
 */

import { scoreQuestionAnswers } from './scoring.ts';
import { RARITY_TIERS } from './types.ts';
import type { Question, RarityTier } from './types.ts';

/** A question needs at least this many valid answers to be worth asking. */
export const MIN_ANSWERS = 10;

/** At least this many different tiers must be reachable (prior-only scoring). */
export const MIN_DISTINCT_TIERS = 3;

/** If one answer is more than this share of all responses, it is a one-answer question. */
export const MAX_TOP_SHARE = 0.4;

export interface QualityIssue {
  code: 'too-few-answers' | 'too-few-tiers' | 'dominant-answer' | 'missing-criteria';
  message: string;
}

export function checkQuestionQuality(question: Question): QualityIssue[] {
  const issues: QualityIssue[] = [];

  if (question.answers.length < MIN_ANSWERS) {
    issues.push({
      code: 'too-few-answers',
      message: `needs at least ${MIN_ANSWERS} valid answers (has ${question.answers.length})`,
    });
  }

  if (question.answerSet === 'open' && (question.criteria ?? '').trim() === '') {
    issues.push({
      code: 'missing-criteria',
      message: 'an open answer set needs `criteria` so players know what qualifies',
    });
  }

  const scores = scoreQuestionAnswers(question);
  const tiers = new Set<RarityTier>([...scores.values()].map((s) => s.tier));
  if (tiers.size < MIN_DISTINCT_TIERS) {
    const have = RARITY_TIERS.filter((t) => tiers.has(t)).join(', ') || 'none';
    issues.push({
      code: 'too-few-tiers',
      message: `needs at least ${MIN_DISTINCT_TIERS} distinct rarity tiers (has ${tiers.size}: ${have})`,
    });
  }

  const top = Math.max(0, ...question.answers.map((a) => a.familiarity));
  if (top > MAX_TOP_SHARE) {
    issues.push({
      code: 'dominant-answer',
      message: `the most popular answer is ${(top * 100).toFixed(0)}% of responses (max ${MAX_TOP_SHARE * 100}%)`,
    });
  }

  return issues;
}
