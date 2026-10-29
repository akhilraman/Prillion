/**
 * Round state machine.
 *
 *            START                SUBMIT / TIMEOUT              NEXT (more questions)
 *   idle ───────────▶ answering ───────────────────▶ revealed ───────────────┐
 *                        ▲                              │                    │
 *                        └──────────────────────────────┼────────────────────┘
 *                                                       │ NEXT (last question)
 *                                                       ▼
 *                                                   finished
 *
 * Why a reducer and not scattered useState calls?
 *  - Every legal transition lives in one place, so illegal ones (answering a
 *    question twice, advancing before reveal) are impossible by construction.
 *  - It is pure: (state, action) -> state. No timers, no DOM, no Date.now().
 *    Time is an INPUT (`nowMs`), so tests are exact and a server could run
 *    the very same function to be authoritative.
 */

import { matchAnswer } from './matcher.ts';
import { scoreAnswer } from './scoring.ts';
import type { AnswerObservation, Question, RarityTier, ScoreBreakdown } from './types.ts';

export const DEFAULT_SECONDS_PER_QUESTION = 25;

export type Outcome = 'correct' | 'incorrect' | 'timeout';

export interface QuestionResult {
  questionId: string;
  /** Exactly what the player typed (trimmed to a sane length). */
  input: string;
  outcome: Outcome;
  answerId: string | null;
  matchedVia: 'exact' | 'fuzzy' | null;
  score: ScoreBreakdown | null;
  points: number;
  /**
   * True when an open-set question received an unrecognised, non-empty answer.
   * It scores 0 now, but is a candidate for the human review queue.
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
  | { type: 'NEXT'; nowMs: number };

/** Looks up gameplay statistics for an answer; undefined = no data. */
export type ObservationLookup = (questionId: string, answerId: string) => AnswerObservation | undefined;

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
      };
    }

    case 'SUBMIT': {
      if (state.phase !== 'answering') return state; // duplicate / late events are ignored
      const question = state.questions[state.index]!;
      const input = action.text.slice(0, MAX_INPUT_LENGTH);

      // A submission that arrives after the deadline is a timeout. The deadline
      // is authoritative, not the UI's countdown, so a throttled background
      // tab cannot buy extra time.
      if (action.nowMs >= state.deadlineMs) {
        return reveal(state, timeoutResult(question, input));
      }
      return reveal(state, gradeSubmission(question, input, observations));
    }

    case 'TIMEOUT': {
      if (state.phase !== 'answering') return state;
      // Ignore a premature TIMEOUT (e.g. a stale timer callback).
      if (action.nowMs < state.deadlineMs) return state;
      return reveal(state, timeoutResult(state.questions[state.index]!, ''));
    }

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

function timeoutResult(question: Question, input: string): QuestionResult {
  return {
    questionId: question.id,
    input,
    outcome: 'timeout',
    answerId: null,
    matchedVia: null,
    score: null,
    points: 0,
    needsReview: false,
  };
}

export function gradeSubmission(
  question: Question,
  input: string,
  observations: ObservationLookup = () => undefined,
): QuestionResult {
  const match = matchAnswer(question, input);

  if (match.kind === 'match') {
    const score = scoreAnswer(match.answer, observations(question.id, match.answer.id));
    return {
      questionId: question.id,
      input,
      outcome: 'correct',
      answerId: match.answer.id,
      matchedVia: match.via,
      score,
      points: score.points,
      needsReview: false,
    };
  }

  return {
    questionId: question.id,
    input,
    outcome: 'incorrect',
    answerId: null,
    matchedVia: null,
    score: null,
    points: 0,
    needsReview: question.answerSet === 'open' && match.reason !== 'empty',
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
