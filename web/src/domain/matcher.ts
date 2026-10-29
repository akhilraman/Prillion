/**
 * Free-text answer matching.
 *
 * Pipeline (each step is stricter about what it accepts than the next is
 * permissive, and we stop at the first success):
 *   1. Exact match on normalised canonical name or alias.
 *   2. Controlled fuzzy match (typo tolerance), with guards.
 *
 * The matcher is a PURE function of (question, input). It never talks to a
 * network or a clock, so it can move to a server unchanged when scoring
 * becomes server-authoritative.
 */

import { digitRuns, normalizeAnswer } from './normalize.ts';
import type { Answer, Question } from './types.ts';

export type MatchResult =
  | { kind: 'match'; answer: Answer; via: 'exact' | 'fuzzy'; distance: number }
  | { kind: 'no-match'; reason: 'empty' | 'unknown' | 'ambiguous' };

/**
 * Edits allowed as a function of the target string length.
 *  - Short strings (<5): zero. One edit changes a large fraction of the word
 *    ("Io" vs "Ia"), so fuzzy matching would mostly create false positives.
 *  - 5-8 chars: one edit.  - 9+ chars: two edits.
 */
export function maxEdits(targetLength: number): number {
  if (targetLength < 5) return 0;
  if (targetLength < 9) return 1;
  return 2;
}

/**
 * Optimal-string-alignment distance (Levenshtein + adjacent transposition).
 * Transposition matters because "teh"/"the"-style swaps are the most common
 * real typing error. O(n*m) time, which is fine for strings this short.
 */
export function editDistance(a: string, b: string): number {
  const n = a.length;
  const m = b.length;
  if (n === 0) return m;
  if (m === 0) return n;

  const d: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 0; i <= n; i++) d[i]![0] = i;
  for (let j = 0; j <= m; j++) d[0]![j] = j;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(
        d[i - 1]![j]! + 1, // deletion
        d[i]![j - 1]! + 1, // insertion
        d[i - 1]![j - 1]! + cost, // substitution
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, d[i - 2]![j - 2]! + 1); // transposition
      }
      d[i]![j] = best;
    }
  }
  return d[n]![m]!;
}

interface Form {
  answer: Answer;
  normalized: string;
}

function formsOf(question: Question): Form[] {
  const forms: Form[] = [];
  for (const answer of question.answers) {
    for (const text of [answer.canonical, ...answer.aliases]) {
      const normalized = normalizeAnswer(text);
      if (normalized) forms.push({ answer, normalized });
    }
  }
  return forms;
}

function sameDigits(a: string, b: string): boolean {
  const da = digitRuns(a);
  const db = digitRuns(b);
  return da.length === db.length && da.every((run, i) => run === db[i]);
}

export function matchAnswer(question: Question, rawInput: string): MatchResult {
  const input = normalizeAnswer(rawInput);
  if (input === '') return { kind: 'no-match', reason: 'empty' };

  const forms = formsOf(question);

  // 1. Exact (post-normalisation) match.
  const exact = forms.find((f) => f.normalized === input);
  if (exact) return { kind: 'match', answer: exact.answer, via: 'exact', distance: 0 };

  // 2. Controlled fuzzy match.
  // Best (smallest) distance per answer, considering only forms that pass the guards.
  const bestByAnswer = new Map<string, { answer: Answer; distance: number }>();
  for (const form of forms) {
    // Guard A: digits must match exactly. "apollo 11" vs "apollo 12" is ONE edit
    // apart but a completely different mission.
    if (!sameDigits(input, form.normalized)) continue;

    const limit = maxEdits(form.normalized.length);
    if (limit === 0) continue;

    // Cheap pre-filter: lengths differing by more than the limit can't be within it.
    if (Math.abs(input.length - form.normalized.length) > limit) continue;

    const distance = editDistance(input, form.normalized);
    if (distance > limit) continue;

    const current = bestByAnswer.get(form.answer.id);
    if (!current || distance < current.distance) {
      bestByAnswer.set(form.answer.id, { answer: form.answer, distance });
    }
  }

  if (bestByAnswer.size === 0) return { kind: 'no-match', reason: 'unknown' };

  const ranked = [...bestByAnswer.values()].sort((x, y) => x.distance - y.distance);
  const [first, second] = ranked;
  // Guard B: if two DIFFERENT answers are equally close, refuse to guess.
  if (second && second.distance === first!.distance) {
    return { kind: 'no-match', reason: 'ambiguous' };
  }
  return { kind: 'match', answer: first!.answer, via: 'fuzzy', distance: first!.distance };
}
