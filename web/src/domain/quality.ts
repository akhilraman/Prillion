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
import { isAiKnowledge, RARITY_TIERS } from './types.ts';
import type { Question, RarityTier } from './types.ts';

/** A question needs at least this many valid answers to be worth asking. */
export const MIN_ANSWERS = 10;

/** At least this many different tiers must be reachable (prior-only scoring). */
export const MIN_DISTINCT_TIERS = 3;

/** If one answer is more than this share of all responses, it is a one-answer question. */
export const MAX_TOP_SHARE = 0.4;

/**
 * Topics an ai-knowledge question must not touch. Sourced questions are checked against a document;
 * these are written from memory, so the gate is stricter: no allegations, crimes, sexual content,
 * health or private-life rumours. Each entry is a whole-word regex fragment (so "rapeseed" is fine).
 * It is deliberately blunt: a false alarm costs a reviewer a rewrite, a miss could put a damaging
 * claim about a real person in front of players.
 */
const SENSITIVE_TERMS = [
  'rap(?:e|ed|es|ist)',
  'sexual assault',
  'molest\\w*',
  'p(?:a)?edophil\\w*',
  'sex tape',
  'nudes?',
  'leaked',
  'overdos\\w*',
  'suicid\\w*',
  'self-harm',
  'alleged(?:ly)?',
  'accused',
  'arrest(?:ed|s)?',
  'convicted',
  'indicted',
  'affairs?',
  'cheating',
  'pregnan\\w*',
  'rehab',
] as const;
const SENSITIVE_PATTERN = new RegExp(`\\b(?:${SENSITIVE_TERMS.join('|')})\\b`, 'i');

export interface QualityIssue {
  code:
    | 'too-few-answers'
    | 'too-few-tiers'
    | 'dominant-answer'
    | 'missing-criteria'
    | 'ai-closed-set'
    | 'sensitive-term';
  message: string;
}

/** Every piece of player-visible text, so a sensitive term cannot hide in an alias or the explanation. */
function visibleText(question: Question): string[] {
  return [
    question.prompt,
    question.criteria ?? '',
    question.explanation,
    ...question.answers.flatMap((a) => [a.canonical, ...a.aliases, a.evidence]),
  ];
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

  if (isAiKnowledge(question)) {
    if (question.answerSet !== 'open') {
      issues.push({
        code: 'ai-closed-set',
        message:
          'an ai-knowledge question must be an open set: without a source we cannot claim the list is complete',
      });
    }
    for (const text of visibleText(question)) {
      const hit = SENSITIVE_PATTERN.exec(text);
      if (hit) {
        issues.push({
          code: 'sensitive-term',
          message: `ai-knowledge content must avoid allegations and private-life topics; found "${hit[0]}" in: ${text.slice(0, 80)}`,
        });
        break; // one is enough to send it back; listing every hit adds noise
      }
    }
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
