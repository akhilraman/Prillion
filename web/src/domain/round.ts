/**
 * Round state machine.
 *
 *            START        SUBMIT (a match) / TIMEOUT            NEXT (more questions)
 *   idle ───────────▶ answering ───────────────────▶ revealed ───────────────┐
 *                      ▲  │ SUBMIT (no match): stay,    │                    │
 *                      │  ┘ remember the miss           │                    │
 *                      └────────────────────────────────┼────────────────────┘
 *                                                       │ NEXT (last question)
 *                                                       ▼
 *                                                   finished
 *
 * An unrecognised answer does NOT end the question: the player may keep trying until
 * the clock runs out. That is kinder to typos and to valid answers missing from an
 * open list, and every miss is kept so it can reach the review queue.
 *
 * Why a reducer and not scattered useState calls?
 *  - Every legal transition lives in one place, so illegal ones (answering a
 *    question twice, advancing before reveal) are impossible by construction.
 *  - It is pure: (state, action) -> state. No timers, no DOM, no Date.now().
 *    Time is an INPUT (`nowMs`), so tests are exact and a server could run
 *    the very same function to be authoritative.
 */

import { matchAnswer } from './matcher.ts';
import type { MatchResult } from './matcher.ts';
import { scoreAnswer } from './scoring.ts';
import type { ObservationLookup, Question, RarityTier, ScoreBreakdown } from './types.ts';

export type { ObservationLookup } from './types.ts';

export const DEFAULT_SECONDS_PER_QUESTION = 25;

export type Outcome = 'correct' | 'timeout';

export interface QuestionResult {
  questionId: string;
  /**
   * What the player typed (trimmed to a sane length): the matching answer when correct,
   * the last unrecognised attempt on a timeout, or '' if they never typed anything.
   */
  input: string;
  outcome: Outcome;
  answerId: string | null;
  matchedVia: 'exact' | 'fuzzy' | null;
  score: ScoreBreakdown | null;
  points: number;
  /** Every unrecognised attempt on this question, in order (also kept for correct results). */
  misses: readonly string[];
  /**
   * True when an open-set question saw any unrecognised attempt. Those may be valid
   * answers missing from our list, so they are candidates for the human review queue.
   */
  needsReview: boolean;
}

export type RoundState =
  | { phase: 'idle' }
  | {
      phase: 'answering';
      questions: readonly Question[];
      index: number;
      deadlineMs: number;
      secondsPerQuestion: number;
      results: readonly QuestionResult[];
      /** Unrecognised attempts on the current question. */
      misses: readonly string[];
    }
  | {
      phase: 'revealed';
      questions: readonly Question[];
      index: number;
      secondsPerQuestion: number;
      results: readonly QuestionResult[];
    }
  | {
      phase: 'finished';
      questions: readonly Question[];
      results: readonly QuestionResult[];
    };

export type RoundAction =
  | { type: 'START'; questions: readonly Question[]; nowMs: number; secondsPerQuestion?: number }
  | { type: 'SUBMIT'; text: string; nowMs: number }
  | { type: 'TIMEOUT'; nowMs: number }
  | { type: 'NEXT'; nowMs: number }
  /** Abandon the round (or leave the results screen) and return to idle. */
  | { type: 'RESET' };

export const initialRoundState: RoundState = { phase: 'idle' };

/** Hard cap so a pasted novel can't bloat storage or matching work. */
export const MAX_INPUT_LENGTH = 120;

export function roundReducer(
  state: RoundState,
  action: RoundAction,
  observations: ObservationLookup = () => undefined,
): RoundState {
  switch (action.type) {
    case 'START': {
      if (action.questions.length === 0) return state;
      const seconds = action.secondsPerQuestion ?? DEFAULT_SECONDS_PER_QUESTION;
      return {
        phase: 'answering',
        questions: action.questions,
        index: 0,
        deadlineMs: action.nowMs + seconds * 1000,
        secondsPerQuestion: seconds,
        results: [],
        misses: [],
      };
    }

    case 'SUBMIT': {
      if (state.phase !== 'answering') return state; // duplicate / late events are ignored
      const question = state.questions[state.index]!;
      const input = action.text.slice(0, MAX_INPUT_LENGTH);
      if (input.trim() === '') return state; // a stray Enter must not cost an attempt

      // A submission that arrives after the deadline is a timeout. The deadline
      // is authoritative, not the UI's countdown, so a throttled background
      // tab cannot buy extra time.
      if (action.nowMs >= state.deadlineMs) {
        return reveal(state, timeoutResult(question, [...state.misses, input]));
      }

      const match = matchAnswer(question, input);
      if (match.kind === 'match') {
        return reveal(state, correctResult(question, input, match, state.misses, observations));
      }
      return { ...state, misses: [...state.misses, input] };
    }

    case 'TIMEOUT': {
      if (state.phase !== 'answering') return state;
      // Ignore a premature TIMEOUT (e.g. a stale timer callback).
      if (action.nowMs < state.deadlineMs) return state;
      return reveal(state, timeoutResult(state.questions[state.index]!, state.misses));
    }

    case 'RESET':
      return initialRoundState;

    case 'NEXT': {
      if (state.phase !== 'revealed') return state;
      const nextIndex = state.index + 1;
      if (nextIndex >= state.questions.length) {
        return { phase: 'finished', questions: state.questions, results: state.results };
      }
      return {
        phase: 'answering',
        questions: state.questions,
        index: nextIndex,
        deadlineMs: action.nowMs + state.secondsPerQuestion * 1000,
        secondsPerQuestion: state.secondsPerQuestion,
        results: state.results,
        misses: [],
      };
    }
  }
}

function reveal(state: Extract<RoundState, { phase: 'answering' }>, result: QuestionResult): RoundState {
  return {
    phase: 'revealed',
    questions: state.questions,
    index: state.index,
    secondsPerQuestion: state.secondsPerQuestion,
    results: [...state.results, result],
  };
}

function needsReview(question: Question, misses: readonly string[]): boolean {
  return question.answerSet === 'open' && misses.length > 0;
}

function timeoutResult(question: Question, misses: readonly string[]): QuestionResult {
  return {
    questionId: question.id,
    input: misses[misses.length - 1] ?? '',
    outcome: 'timeout',
    answerId: null,
    matchedVia: null,
    score: null,
    points: 0,
    misses,
    needsReview: needsReview(question, misses),
  };
}

function correctResult(
  question: Question,
  input: string,
  match: Extract<MatchResult, { kind: 'match' }>,
  misses: readonly string[],
  observations: ObservationLookup,
): QuestionResult {
  // The matcher only returns answers of this question, so a score always exists.
  const score = scoreAnswer(question, match.answer.id, observations)!;
  return {
    questionId: question.id,
    input,
    outcome: 'correct',
    answerId: match.answer.id,
    matchedVia: match.via,
    score,
    points: score.points,
    misses,
    needsReview: needsReview(question, misses),
  };
}

// ---- Selectors (derive; never store derived data in state) -----------------

export function remainingMs(state: RoundState, nowMs: number): number {
  return state.phase === 'answering' ? Math.max(0, state.deadlineMs - nowMs) : 0;
}

export function totalPoints(state: RoundState): number {
  return state.phase === 'idle' ? 0 : state.results.reduce((sum, r) => sum + r.points, 0);
}

export function currentQuestion(state: RoundState): Question | undefined {
  return state.phase === 'answering' || state.phase === 'revealed' ? state.questions[state.index] : undefined;
}

export function tierCounts(results: readonly QuestionResult[]): Record<RarityTier, number> {
  const counts: Record<RarityTier, number> = { common: 0, uncommon: 0, rare: 0, legendary: 0 };
  for (const r of results) if (r.score) counts[r.score.tier] += 1;
  return counts;
}
