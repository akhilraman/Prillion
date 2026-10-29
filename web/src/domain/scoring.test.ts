import { describe, expect, it } from 'vitest';
import {
  effectiveShare,
  MIN_OBSERVED_TOTAL,
  MIN_SHARE_FLOOR,
  PRIOR_STRENGTH,
  scoreAnswer,
  tierForShare,
} from './scoring.ts';

describe('tierForShare', () => {
  it('maps share boundaries to tiers (lower bound inclusive)', () => {
    expect(tierForShare(0.9)).toEqual({ tier: 'common', points: 100 });
    expect(tierForShare(0.25)).toEqual({ tier: 'common', points: 100 });
    expect(tierForShare(0.2499)).toEqual({ tier: 'uncommon', points: 200 });
    expect(tierForShare(0.1)).toEqual({ tier: 'uncommon', points: 200 });
    expect(tierForShare(0.0999)).toEqual({ tier: 'rare', points: 350 });
    expect(tierForShare(0.03)).toEqual({ tier: 'rare', points: 350 });
    expect(tierForShare(0.0299)).toEqual({ tier: 'legendary', points: 500 });
    expect(tierForShare(0)).toEqual({ tier: 'legendary', points: 500 });
  });

  it('awards more points to rarer tiers (monotonic)', () => {
    const shares = [0.9, 0.2, 0.05, 0.01];
    const points = shares.map((s) => tierForShare(s).points);
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
    const count = 0; // nobody picked it
    const r = effectiveShare(answer, { count, total });
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

describe('scoreAnswer', () => {
  it('is deterministic', () => {
    const a = scoreAnswer({ familiarity: 0.05 }, { count: 3, total: 100 });
    const b = scoreAnswer({ familiarity: 0.05 }, { count: 3, total: 100 });
    expect(a).toEqual(b);
  });

  it('explains itself: returns the share and tier behind the points', () => {
    expect(scoreAnswer({ familiarity: 0.7 })).toEqual({
      tier: 'common',
      points: 100,
      effectiveShare: 0.7,
      usedObservations: false,
    });
  });

  it('lets observed play re-tier an answer the prior mis-estimated', () => {
    // Curated prior says legendary (1%) but 30% of 1000 players pick it.
    const r = scoreAnswer({ familiarity: 0.01 }, { count: 300, total: 1000 });
    expect(r.tier).toBe('common');
  });
});
