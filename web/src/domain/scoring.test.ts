import { describe, expect, it } from 'vitest';
import {
  effectiveShare,
  MIN_OBSERVED_TOTAL,
  MIN_SHARE_FLOOR,
  PRIOR_STRENGTH,
  scoreAnswer,
  scoreQuestionAnswers,
  tierForRelativeShare,
} from './scoring.ts';
import { makeAnswer, makeQuestion } from './testFixtures.ts';

/** A question whose answers have the given familiarity values (ids a0, a1, ...). */
function questionWith(familiarities: number[]) {
  return makeQuestion('q', {
    answers: familiarities.map((familiarity, i) => makeAnswer(`a${i}`, { familiarity })),
  });
}

describe('tierForRelativeShare', () => {
  it('maps relative-share boundaries to tiers (lower bound inclusive)', () => {
    expect(tierForRelativeShare(1)).toEqual({ tier: 'common', points: 100 });
    expect(tierForRelativeShare(0.5)).toEqual({ tier: 'common', points: 100 });
    expect(tierForRelativeShare(0.4999)).toEqual({ tier: 'uncommon', points: 200 });
    expect(tierForRelativeShare(0.2)).toEqual({ tier: 'uncommon', points: 200 });
    expect(tierForRelativeShare(0.1999)).toEqual({ tier: 'rare', points: 350 });
    expect(tierForRelativeShare(0.05)).toEqual({ tier: 'rare', points: 350 });
    expect(tierForRelativeShare(0.0499)).toEqual({ tier: 'legendary', points: 500 });
    expect(tierForRelativeShare(0)).toEqual({ tier: 'legendary', points: 500 });
  });

  it('awards more points to rarer tiers (monotonic)', () => {
    const points = [1, 0.3, 0.1, 0.01].map((r) => tierForRelativeShare(r).points);
    expect(points).toEqual([...points].sort((a, b) => a - b));
  });
});

describe('effectiveShare', () => {
  const answer = { familiarity: 0.4 };

  it('uses the curated prior when there is no data', () => {
    expect(effectiveShare(answer)).toEqual({ share: 0.4, usedObservations: false });
  });

  it('ignores observations below the minimum sample size', () => {
    const r = effectiveShare(answer, { count: 0, total: MIN_OBSERVED_TOTAL - 1 });
    expect(r).toEqual({ share: 0.4, usedObservations: false });
  });

  it('blends prior and observations once the sample is large enough', () => {
    const total = MIN_OBSERVED_TOTAL;
    const r = effectiveShare(answer, { count: 0, total });
    const expected = (0 + 0.4 * PRIOR_STRENGTH) / (total + PRIOR_STRENGTH);
    expect(r.usedObservations).toBe(true);
    expect(r.share).toBeCloseTo(expected, 10);
  });

  it('moves gradually toward observed frequency as data grows', () => {
    const prior = { familiarity: 0.5 };
    const small = effectiveShare(prior, { count: 5, total: 50 }).share; // observed 10%
    const large = effectiveShare(prior, { count: 500, total: 5000 }).share; // observed 10%
    expect(small).toBeGreaterThan(large);
    expect(large).toBeGreaterThan(0.1);
    expect(large).toBeLessThan(0.2);
  });

  it('is not thrown by one extra submission (bounded sensitivity)', () => {
    const before = effectiveShare(answer, { count: 20, total: 100 }).share;
    const after = effectiveShare(answer, { count: 21, total: 101 }).share;
    expect(Math.abs(after - before)).toBeLessThan(0.01);
  });

  it('never goes below the floor, even with a tiny prior and zero count', () => {
    const r = effectiveShare({ familiarity: 0.0001 }, { count: 0, total: 100000 });
    expect(r.share).toBeGreaterThanOrEqual(MIN_SHARE_FLOOR);
  });

  it('ignores corrupt observations (count > total)', () => {
    expect(effectiveShare(answer, { count: 80, total: 60 }).usedObservations).toBe(false);
  });

  it('treats NaN familiarity as the floor rather than propagating NaN', () => {
    expect(effectiveShare({ familiarity: Number.NaN }).share).toBe(MIN_SHARE_FLOOR);
  });
});

describe('scoreAnswer (relative to the question)', () => {
  it('is deterministic', () => {
    const q = questionWith([0.3, 0.1, 0.02]);
    const lookup = () => ({ count: 3, total: 100 });
    expect(scoreAnswer(q, 'a2', lookup)).toEqual(scoreAnswer(q, 'a2', lookup));
  });

  it('explains itself: share, top share, relative share, tier', () => {
    const q = questionWith([0.4, 0.1]);
    expect(scoreAnswer(q, 'a1')).toEqual({
      tier: 'uncommon',
      points: 200,
      effectiveShare: 0.1,
      topShare: 0.4,
      relativeShare: 0.1 / 0.4,
      usedObservations: false,
    });
  });

  it('gives the most popular answer the common tier whatever the set size', () => {
    for (const n of [2, 10, 40]) {
      const q = questionWith(Array.from({ length: n }, (_, i) => 0.3 * 0.9 ** i));
      expect(scoreAnswer(q, 'a0')?.tier).toBe('common');
    }
  });

  it('is scale-free: halving every share changes no tier', () => {
    const full = questionWith([0.6, 0.3, 0.12, 0.03]);
    const halved = questionWith([0.3, 0.15, 0.06, 0.015]);
    for (const id of ['a0', 'a1', 'a2', 'a3']) {
      expect(scoreAnswer(halved, id)?.tier).toBe(scoreAnswer(full, id)?.tier);
    }
  });

  it('is what makes large sets work: a 15% answer can still be the common one', () => {
    // Under the old absolute rule (>= 25% common) every answer here would be non-common.
    const q = questionWith([0.15, 0.12, 0.05, 0.02, 0.005]);
    expect(scoreAnswer(q, 'a0')?.tier).toBe('common');
    expect(scoreAnswer(q, 'a1')?.tier).toBe('common');
    expect(scoreAnswer(q, 'a2')?.tier).toBe('uncommon');
    expect(scoreAnswer(q, 'a3')?.tier).toBe('rare');
    expect(scoreAnswer(q, 'a4')?.tier).toBe('legendary');
  });

  it('returns undefined for an answer that is not part of the question', () => {
    expect(scoreAnswer(questionWith([0.5, 0.5]), 'nope')).toBeUndefined();
  });

  it('lets observed play re-tier an answer the prior mis-estimated', () => {
    // Prior says a1 is 1% vs a0 at 50% (legendary), but 30% of 1000 players pick a1.
    const q = questionWith([0.5, 0.01]);
    expect(scoreAnswer(q, 'a1')?.tier).toBe('legendary');
    const lookup = (_q: string, answerId: string) =>
      answerId === 'a1' ? { count: 300, total: 1000 } : { count: 400, total: 1000 };
    const r = scoreAnswer(q, 'a1', lookup);
    expect(r?.usedObservations).toBe(true);
    expect(r?.tier).toBe('common');
  });

  it('scoreQuestionAnswers covers every answer exactly once', () => {
    const q = questionWith([0.3, 0.2, 0.1]);
    expect([...scoreQuestionAnswers(q).keys()]).toEqual(['a0', 'a1', 'a2']);
  });
});
