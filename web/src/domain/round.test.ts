import { describe, expect, it } from 'vitest';
import {
  currentQuestion,
  DEFAULT_SECONDS_PER_QUESTION,
  initialRoundState,
  MAX_INPUT_LENGTH,
  remainingMs,
  roundReducer,
  tierCounts,
  totalPoints,
} from './round.ts';
import type { RoundAction, RoundState } from './round.ts';
import { makeAnswer, makeQuestion } from './testFixtures.ts';

const common = makeAnswer('saturn', { canonical: 'Saturn', familiarity: 0.7 });
const rare = makeAnswer('neptune', { canonical: 'Neptune', familiarity: 0.02 });
const filler = makeAnswer('jupiter', { canonical: 'Jupiter', familiarity: 0.28 });

const q1 = makeQuestion('q1', { answers: [common, rare, filler] });
const q2 = makeQuestion('q2', { answerSet: 'open', answers: [common, rare, filler] });

const T0 = 1_000_000;
const SECOND = 1000;

function run(actions: RoundAction[], state: RoundState = initialRoundState): RoundState {
  return actions.reduce((s, a) => roundReducer(s, a), state);
}

const start = (questions = [q1, q2]): RoundAction => ({ type: 'START', questions, nowMs: T0 });

describe('round lifecycle', () => {
  it('starts in idle and ignores everything except START', () => {
    expect(run([{ type: 'SUBMIT', text: 'Saturn', nowMs: T0 }])).toEqual(initialRoundState);
    expect(run([{ type: 'NEXT', nowMs: T0 }])).toEqual(initialRoundState);
    expect(run([{ type: 'TIMEOUT', nowMs: T0 }])).toEqual(initialRoundState);
  });

  it('does not start with zero questions', () => {
    expect(run([{ type: 'START', questions: [], nowMs: T0 }])).toEqual(initialRoundState);
  });

  it('START opens question 0 with a deadline', () => {
    const s = run([start()]);
    expect(s).toMatchObject({
      phase: 'answering',
      index: 0,
      deadlineMs: T0 + DEFAULT_SECONDS_PER_QUESTION * SECOND,
    });
  });

  it('plays through to finished', () => {
    const s = run([
      start(),
      { type: 'SUBMIT', text: 'saturn', nowMs: T0 + 2 * SECOND },
      { type: 'NEXT', nowMs: T0 + 3 * SECOND },
      { type: 'SUBMIT', text: 'neptune', nowMs: T0 + 5 * SECOND },
      { type: 'NEXT', nowMs: T0 + 6 * SECOND },
    ]);
    expect(s.phase).toBe('finished');
    if (s.phase === 'finished') expect(s.results).toHaveLength(2);
  });

  it('resets the deadline for each new question', () => {
    const s = run([
      start(),
      { type: 'SUBMIT', text: 'saturn', nowMs: T0 + SECOND },
      { type: 'NEXT', nowMs: T0 + 10 * SECOND },
    ]);
    expect(s).toMatchObject({
      phase: 'answering',
      index: 1,
      misses: [],
      deadlineMs: T0 + 10 * SECOND + DEFAULT_SECONDS_PER_QUESTION * SECOND,
    });
  });

  it('honours a custom time limit', () => {
    const s = run([{ type: 'START', questions: [q1], nowMs: T0, secondsPerQuestion: 5 }]);
    expect(s).toMatchObject({ deadlineMs: T0 + 5 * SECOND });
  });
});

describe('grading and scoring in a round', () => {
  it('scores a common answer low and a rare answer high', () => {
    const s = run([start(), { type: 'SUBMIT', text: 'Saturn', nowMs: T0 + SECOND }]);
    expect(totalPoints(s)).toBe(100);

    const s2 = run([start(), { type: 'SUBMIT', text: 'Neptune', nowMs: T0 + SECOND }]);
    expect(totalPoints(s2)).toBe(500);
  });

  it('tiers by popularity relative to the question, so a 5% answer can be the common one', () => {
    // A wide question: the most popular answer holds only 5% of responses.
    const wide = makeQuestion('wide', {
      answers: [
        makeAnswer('top', { canonical: 'Top', familiarity: 0.05 }),
        makeAnswer('mid', { canonical: 'Mid', familiarity: 0.02 }),
        makeAnswer('low', { canonical: 'Low', familiarity: 0.008 }),
      ],
    });
    const submit = (text: string) => run([start([wide]), { type: 'SUBMIT', text, nowMs: T0 + SECOND }]);
    const scoreOf = (s: RoundState) => (s.phase === 'revealed' ? s.results[0]?.score : undefined);

    // Absolute thresholds would call all three rare or legendary. Relatively: 100%, 40%, 16% of the top.
    expect(scoreOf(submit('Top'))).toMatchObject({ tier: 'common', points: 100 });
    expect(scoreOf(submit('Mid'))).toMatchObject({ tier: 'uncommon', points: 200 });
    expect(scoreOf(submit('Low'))).toMatchObject({ tier: 'rare', points: 350 });
  });

  it('records the result with the matching details', () => {
    const s = run([start(), { type: 'SUBMIT', text: 'Saturnn', nowMs: T0 + SECOND }]);
    expect(s.phase).toBe('revealed');
    if (s.phase === 'revealed') {
      expect(s.results[0]).toMatchObject({
        outcome: 'correct',
        answerId: 'saturn',
        matchedVia: 'fuzzy',
        points: 100,
      });
    }
  });

  it('an unrecognised answer does not end the question: the player can try again', () => {
    const s = run([start(), { type: 'SUBMIT', text: 'Pluto', nowMs: T0 + SECOND }]);
    expect(s).toMatchObject({ phase: 'answering', index: 0, misses: ['Pluto'] });
    // ...and the deadline is untouched, so a miss buys no extra time.
    expect(s.phase === 'answering' && s.deadlineMs).toBe(T0 + DEFAULT_SECONDS_PER_QUESTION * SECOND);
  });

  it('a later correct answer scores normally and keeps the earlier misses', () => {
    const s = run([
      start(),
      { type: 'SUBMIT', text: 'Pluto', nowMs: T0 + SECOND },
      { type: 'SUBMIT', text: 'Saturn', nowMs: T0 + 2 * SECOND },
    ]);
    expect(s.phase === 'revealed' && s.results[0]).toMatchObject({
      outcome: 'correct',
      points: 100,
      misses: ['Pluto'],
      needsReview: false, // closed set: a miss is simply wrong
    });
  });

  it('misses on an OPEN question are flagged for review, even if the player later gets it right', () => {
    const missThenHit = run([
      start([q2]),
      { type: 'SUBMIT', text: 'Some Film Not In Bank', nowMs: T0 + SECOND },
      { type: 'SUBMIT', text: 'Saturn', nowMs: T0 + 2 * SECOND },
    ]);
    expect(missThenHit.phase === 'revealed' && missThenHit.results[0]).toMatchObject({
      outcome: 'correct',
      misses: ['Some Film Not In Bank'],
      needsReview: true,
    });

    const missThenTimeout = run([
      start([q2]),
      { type: 'SUBMIT', text: 'Some Film Not In Bank', nowMs: T0 + SECOND },
      { type: 'TIMEOUT', nowMs: T0 + DEFAULT_SECONDS_PER_QUESTION * SECOND },
    ]);
    expect(missThenTimeout.phase === 'revealed' && missThenTimeout.results[0]).toMatchObject({
      outcome: 'timeout',
      needsReview: true,
    });
  });

  it('a timeout reports the last thing the player tried, and every miss', () => {
    const s = run([
      start(),
      { type: 'SUBMIT', text: 'Pluto', nowMs: T0 + SECOND },
      { type: 'SUBMIT', text: 'Vulcan', nowMs: T0 + 2 * SECOND },
      { type: 'TIMEOUT', nowMs: T0 + DEFAULT_SECONDS_PER_QUESTION * SECOND },
    ]);
    expect(s.phase === 'revealed' && s.results[0]).toMatchObject({
      outcome: 'timeout',
      input: 'Vulcan',
      misses: ['Pluto', 'Vulcan'],
      points: 0,
      needsReview: false,
    });
  });

  it('ignores an empty submission entirely (it does not cost an attempt or flag review)', () => {
    const before = run([start([q2])]);
    expect(roundReducer(before, { type: 'SUBMIT', text: '   ', nowMs: T0 + SECOND })).toBe(before);
  });

  it('misses reset for each new question', () => {
    const s = run([
      start(),
      { type: 'SUBMIT', text: 'Pluto', nowMs: T0 + SECOND },
      { type: 'SUBMIT', text: 'Saturn', nowMs: T0 + 2 * SECOND },
      { type: 'NEXT', nowMs: T0 + 3 * SECOND },
    ]);
    expect(s).toMatchObject({ phase: 'answering', index: 1, misses: [] });
  });

  it('truncates absurdly long input before storing it', () => {
    const s = run([start(), { type: 'SUBMIT', text: 'a'.repeat(5000), nowMs: T0 + SECOND }]);
    expect(s.phase === 'answering' && s.misses[0]?.length).toBe(MAX_INPUT_LENGTH);
  });

  it('uses supplied observations when scoring', () => {
    const s = roundReducer(
      roundReducer(initialRoundState, start()),
      { type: 'SUBMIT', text: 'Neptune', nowMs: T0 + SECOND },
      (qid, aid) => (qid === 'q1' && aid === 'neptune' ? { count: 400, total: 1000 } : undefined),
    );
    // Prior says 2% (legendary) but 40% of 1000 players pick it.
    expect(s.phase === 'revealed' && s.results[0]?.score?.tier).toBe('common');
  });
});

describe('timing', () => {
  it('treats a submission exactly at the deadline as a timeout', () => {
    const s = run([
      start(),
      { type: 'SUBMIT', text: 'Saturn', nowMs: T0 + DEFAULT_SECONDS_PER_QUESTION * SECOND },
    ]);
    expect(s.phase === 'revealed' && s.results[0]).toMatchObject({
      outcome: 'timeout',
      points: 0,
      input: 'Saturn', // what they typed is kept, but it earns nothing
    });
  });

  it('accepts a submission one millisecond before the deadline', () => {
    const s = run([
      start(),
      { type: 'SUBMIT', text: 'Saturn', nowMs: T0 + DEFAULT_SECONDS_PER_QUESTION * SECOND - 1 },
    ]);
    expect(s.phase === 'revealed' && s.results[0]?.outcome).toBe('correct');
  });

  it('a throttled background tab cannot extend the deadline (late submit = timeout)', () => {
    // The tab was frozen: no ticks for 5 minutes, then the user submits.
    const s = run([start(), { type: 'SUBMIT', text: 'Saturn', nowMs: T0 + 5 * 60 * SECOND }]);
    expect(s.phase === 'revealed' && s.results[0]?.outcome).toBe('timeout');
  });

  it('TIMEOUT before the deadline is ignored (stale timer callback)', () => {
    const s0 = run([start()]);
    expect(roundReducer(s0, { type: 'TIMEOUT', nowMs: T0 + SECOND })).toBe(s0);
  });

  it('TIMEOUT at/after the deadline reveals with zero points', () => {
    const s = run([start(), { type: 'TIMEOUT', nowMs: T0 + DEFAULT_SECONDS_PER_QUESTION * SECOND }]);
    expect(s.phase === 'revealed' && s.results[0]).toMatchObject({
      outcome: 'timeout',
      points: 0,
      input: '',
    });
  });

  it('remainingMs counts down and bottoms out at zero', () => {
    const s = run([start()]);
    expect(remainingMs(s, T0)).toBe(DEFAULT_SECONDS_PER_QUESTION * SECOND);
    expect(remainingMs(s, T0 + 10 * SECOND)).toBe(15 * SECOND);
    expect(remainingMs(s, T0 + 999 * SECOND)).toBe(0);
    expect(remainingMs(initialRoundState, T0)).toBe(0);
  });
});

describe('illegal transitions are ignored', () => {
  it('ignores a second SUBMIT for the same question (no double scoring)', () => {
    const once = run([start(), { type: 'SUBMIT', text: 'Neptune', nowMs: T0 + SECOND }]);
    const twice = roundReducer(once, { type: 'SUBMIT', text: 'Saturn', nowMs: T0 + 2 * SECOND });
    expect(twice).toBe(once);
    expect(totalPoints(twice)).toBe(500);
  });

  it('ignores NEXT while still answering', () => {
    const s = run([start()]);
    expect(roundReducer(s, { type: 'NEXT', nowMs: T0 + SECOND })).toBe(s);
  });

  it('ignores SUBMIT/TIMEOUT after the round is finished', () => {
    const done = run([
      start([q1]),
      { type: 'SUBMIT', text: 'saturn', nowMs: T0 + SECOND },
      { type: 'NEXT', nowMs: T0 + 2 * SECOND },
    ]);
    expect(done.phase).toBe('finished');
    expect(roundReducer(done, { type: 'SUBMIT', text: 'Saturn', nowMs: T0 + 3 * SECOND })).toBe(done);
    expect(roundReducer(done, { type: 'TIMEOUT', nowMs: T0 + 99 * SECOND })).toBe(done);
  });

  it('a new START after finishing begins a fresh round', () => {
    const done = run([
      start([q1]),
      { type: 'TIMEOUT', nowMs: T0 + 99 * SECOND },
      { type: 'NEXT', nowMs: T0 + 100 * SECOND },
    ]);
    const fresh = roundReducer(done, { type: 'START', questions: [q2], nowMs: T0 + 200 * SECOND });
    expect(fresh).toMatchObject({ phase: 'answering', index: 0, results: [] });
  });
});

describe('RESET', () => {
  it('returns to idle from any phase', () => {
    const answering = run([start()]);
    const revealed = run([start(), { type: 'TIMEOUT', nowMs: T0 + 99 * SECOND }]);
    const finished = run([
      start([q1]),
      { type: 'TIMEOUT', nowMs: T0 + 99 * SECOND },
      { type: 'NEXT', nowMs: T0 },
    ]);
    for (const s of [initialRoundState, answering, revealed, finished]) {
      expect(roundReducer(s, { type: 'RESET' })).toEqual(initialRoundState);
    }
  });
});

describe('selectors', () => {
  it('currentQuestion follows the index', () => {
    expect(currentQuestion(run([start()]))?.id).toBe('q1');
    expect(currentQuestion(initialRoundState)).toBeUndefined();
  });

  it('tierCounts tallies correct answers by tier', () => {
    const s = run([
      start(),
      { type: 'SUBMIT', text: 'Saturn', nowMs: T0 + SECOND },
      { type: 'NEXT', nowMs: T0 + 2 * SECOND },
      { type: 'SUBMIT', text: 'Neptune', nowMs: T0 + 3 * SECOND },
    ]);
    if (s.phase !== 'revealed') throw new Error('expected revealed');
    expect(tierCounts(s.results)).toEqual({ common: 1, uncommon: 0, rare: 0, legendary: 1 });
  });
});
