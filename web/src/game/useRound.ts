import { useCallback, useEffect, useReducer, useState } from 'react';
import { initialRoundState, roundReducer } from '../domain/round.ts';
import type { RoundAction, RoundState } from '../domain/round.ts';
import { DEFAULT_ROUND_LENGTH, selectQuestions } from '../domain/selection.ts';
import type { CategorySelection, Question } from '../domain/types.ts';
import { createHistoryStore, getBrowserStorage } from '../storage/playHistory.ts';

/** `useReducer` wants (state, action); the domain reducer has an optional 3rd parameter. */
const reduce = (state: RoundState, action: RoundAction): RoundState => roundReducer(state, action);

/** Monotonic clock for the round. Unlike Date.now() it never jumps when the system clock changes. */
const clock = (): number => performance.now();

export interface RoundNotice {
  /** The bank had fewer questions than a full round. */
  shortfall: boolean;
  requested: number;
  actual: number;
  /** Questions in this round that the player has played before. */
  repeats: number;
}

/**
 * The glue between the pure domain and React:
 *   - owns the reducer
 *   - supplies the clock and randomness (the impure inputs)
 *   - records play history as a side effect
 * Components receive plain callbacks and never touch time, storage or selection.
 */
export function useRound(validIds: ReadonlySet<string>, roundLength: number = DEFAULT_ROUND_LENGTH) {
  const [state, dispatch] = useReducer(reduce, initialRoundState);
  const [notice, setNotice] = useState<RoundNotice | null>(null);
  const [history] = useState(() => createHistoryStore(getBrowserStorage(), validIds));

  const start = useCallback(
    (selection: CategorySelection, bank: readonly Question[]) => {
      const result = selectQuestions({ bank, selection, count: roundLength, history: history.get() });
      setNotice({
        shortfall: result.shortfall,
        requested: roundLength,
        actual: result.questions.length,
        repeats: result.repeats,
      });
      dispatch({ type: 'START', questions: result.questions, nowMs: clock() });
    },
    [roundLength, history],
  );

  const submit = useCallback((text: string) => dispatch({ type: 'SUBMIT', text, nowMs: clock() }), []);
  const timeout = useCallback(() => dispatch({ type: 'TIMEOUT', nowMs: clock() }), []);
  const next = useCallback(() => dispatch({ type: 'NEXT', nowMs: clock() }), []);
  const reset = useCallback(() => dispatch({ type: 'RESET' }), []);

  // Record each question as played the moment its answer is revealed, so even an
  // abandoned round counts what the player actually saw. Idempotent, so safe under StrictMode.
  const revealedId =
    state.phase === 'revealed' ? state.results[state.results.length - 1]?.questionId : undefined;
  useEffect(() => {
    if (revealedId) history.record(revealedId, Date.now());
  }, [revealedId, history]);

  return { state, notice, start, submit, timeout, next, reset };
}
