import { describe, expect, it } from 'vitest';
import type { QuestionResult } from '../domain/round.ts';
import type { RarityTier, ScoreBreakdown } from '../domain/types.ts';
import { NO_CATCH, RANKS, TIER_LABELS, headlineFor } from './labels.ts';

const TIERS: RarityTier[] = ['common', 'uncommon', 'rare', 'legendary'];

function correct(tier: RarityTier, points: number): QuestionResult {
  return {
    questionId: 'q',
    input: 'x',
    outcome: 'correct',
    answerId: 'a',
    matchedVia: 'exact',
    score: { tier } as ScoreBreakdown,
    points,
    misses: [],
    needsReview: false,
  };
}

describe('reveal labels', () => {
  it('names the rarity level the answer reached, never a creature', () => {
    for (const tier of TIERS) {
      expect(RANKS[tier].name).toBe(TIER_LABELS[tier]);
    }
    expect(TIERS.map((t) => RANKS[t].name)).toEqual(['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4']);
  });

  it('announces the level, points and depth to screen readers', () => {
    expect(headlineFor(correct('legendary', 500), 1000)).toBe('Tier 4 answer, 500 points, sink 1000 metres');
  });

  it('keeps the empty-hook wording for a timeout', () => {
    const timeout = { ...correct('common', 0), outcome: 'timeout', score: null } as QuestionResult;
    expect(headlineFor(timeout, 0)).toContain(NO_CATCH.name);
  });
});
