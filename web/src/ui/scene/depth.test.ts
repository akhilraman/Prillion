import { describe, expect, it } from 'vitest';
import type { RoundState } from '../../domain/round.ts';
import { makeBank } from '../../domain/testFixtures.ts';
import { diveMetres, sinkMetres, TIER_METRES } from './depth.ts';

const questions = makeBank({ tollywood: 0, space: 2, 'us-pop': 0 });

const result = (points: number) => ({
  questionId: 'q',
  input: 'x',
  outcome: points > 0 ? ('correct' as const) : ('timeout' as const),
  answerId: null,
  matchedVia: null,
  score: null,
  points,
  misses: [],
  needsReview: false,
});

describe('dive depth', () => {
  it('is at the surface before the round starts', () => {
    expect(diveMetres({ phase: 'idle' })).toBe(0);
  });

  it('gives each tier its own drop, not a multiple of points', () => {
    expect(sinkMetres(100)).toBe(TIER_METRES.common);
    expect(sinkMetres(200)).toBe(TIER_METRES.uncommon);
    expect(sinkMetres(350)).toBe(TIER_METRES.rare);
    expect(sinkMetres(500)).toBe(TIER_METRES.legendary);
    expect(sinkMetres(0)).toBe(0);
  });

  it('only sinks once an answer has scored: a timeout leaves you where you were', () => {
    const revealed = (results: ReturnType<typeof result>[]): RoundState => ({
      phase: 'revealed',
      questions,
      index: results.length - 1,
      secondsPerQuestion: 25,
      results,
    });
    expect(diveMetres(revealed([result(100)]))).toBe(800);
    expect(diveMetres(revealed([result(100), result(0)]))).toBe(800);
    expect(diveMetres(revealed([result(100), result(350)]))).toBe(800 + 2500);
  });

  it('keeps the final depth on the results screen', () => {
    expect(diveMetres({ phase: 'finished', questions, results: [result(500), result(100)] })).toBe(
      4000 + 800,
    );
  });
});
