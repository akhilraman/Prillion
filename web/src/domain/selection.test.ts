import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUND_LENGTH, selectQuestions, seededRng, shuffle } from './selection.ts';
import { makeBank } from './testFixtures.ts';

const bank = makeBank({ tollywood: 6, space: 10, 'us-pop': 8 });

describe('seededRng / shuffle', () => {
  it('produces the same sequence for the same seed', () => {
    const a = seededRng(42);
    const b = seededRng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('shuffle returns a permutation and does not mutate its input', () => {
    const input = [1, 2, 3, 4, 5, 6];
    const out = shuffle(input, seededRng(1));
    expect(input).toEqual([1, 2, 3, 4, 5, 6]);
    expect([...out].sort()).toEqual(input);
  });
});

describe('selectQuestions', () => {
  it('returns the requested count with no duplicates', () => {
    const r = selectQuestions({ bank, selection: 'mixed', count: 15, rng: seededRng(7) });
    expect(r.questions).toHaveLength(15);
    expect(new Set(r.questions.map((q) => q.id)).size).toBe(15);
    expect(r.shortfall).toBe(false);
  });

  it('filters to a single category', () => {
    const r = selectQuestions({ bank, selection: 'space', count: 5, rng: seededRng(3) });
    expect(r.questions.every((q) => q.category === 'space')).toBe(true);
  });

  it('balances a mixed round across categories', () => {
    const r = selectQuestions({ bank, selection: 'mixed', count: 15, rng: seededRng(11) });
    const counts = { tollywood: 0, space: 0, 'us-pop': 0 };
    for (const q of r.questions) counts[q.category] += 1;
    // 15 over three categories with enough supply => exactly 5 each.
    expect(counts).toEqual({ tollywood: 5, space: 5, 'us-pop': 5 });
  });

  it('spreads a default-length dive 3/2/2 and rotates which category gets the extra prompt', () => {
    const extraGoesTo = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      const r = selectQuestions({ bank, selection: 'mixed', rng: seededRng(seed) });
      expect(r.questions).toHaveLength(DEFAULT_ROUND_LENGTH);
      const counts = { tollywood: 0, space: 0, 'us-pop': 0 };
      for (const q of r.questions) counts[q.category] += 1;
      expect(Object.values(counts).sort()).toEqual([2, 2, 3]);
      extraGoesTo.add(Object.entries(counts).find(([, n]) => n === 3)![0]);
    }
    // Over many dives every category gets its turn at the extra prompt (no built-in favourite).
    expect(extraGoesTo.size).toBe(3);
  });

  it('keeps going when one category runs out in a mixed round', () => {
    const small = makeBank({ tollywood: 2, space: 10, 'us-pop': 10 });
    const r = selectQuestions({ bank: small, selection: 'mixed', count: 15, rng: seededRng(5) });
    expect(r.questions).toHaveLength(15);
    expect(r.questions.filter((q) => q.category === 'tollywood')).toHaveLength(2);
  });

  it('reports a shortfall instead of inventing or repeating questions', () => {
    const r = selectQuestions({ bank, selection: 'tollywood', count: 15, rng: seededRng(2) });
    expect(r.questions).toHaveLength(6);
    expect(r.shortfall).toBe(true);
  });

  it('prefers never-played questions over played ones', () => {
    const history = Object.fromEntries(
      bank
        .filter((q) => q.category === 'space')
        .slice(0, 7)
        .map((q) => [q.id, 1000]),
    );
    const r = selectQuestions({ bank, selection: 'space', count: 3, history, rng: seededRng(9) });
    expect(r.repeats).toBe(0);
    expect(r.questions.every((q) => history[q.id] === undefined)).toBe(true);
  });

  it('replays the least-recently played questions first when fresh ones run out', () => {
    const space = bank.filter((q) => q.category === 'space');
    const history = Object.fromEntries(space.map((q, i) => [q.id, 1000 + i])); // space-0 oldest
    const r = selectQuestions({ bank, selection: 'space', count: 3, history, rng: seededRng(4) });
    expect(r.repeats).toBe(3);
    expect(r.questions.map((q) => q.id).sort()).toEqual(['space-0', 'space-1', 'space-2']);
  });

  it('is reproducible under a fixed seed', () => {
    const a = selectQuestions({ bank, selection: 'mixed', rng: seededRng(99) }).questions.map((q) => q.id);
    const b = selectQuestions({ bank, selection: 'mixed', rng: seededRng(99) }).questions.map((q) => q.id);
    expect(a).toEqual(b);
  });

  it('handles an empty bank', () => {
    const r = selectQuestions({ bank: [], selection: 'mixed' });
    expect(r.questions).toEqual([]);
    expect(r.shortfall).toBe(true);
  });

  it('gives a second consecutive round mostly different questions', () => {
    const rng = seededRng(21);
    const first = selectQuestions({ bank, selection: 'mixed', count: 10, rng });
    const history = Object.fromEntries(first.questions.map((q) => [q.id, 5000]));
    const second = selectQuestions({ bank, selection: 'mixed', count: 10, history, rng });
    const overlap = second.questions.filter((q) => history[q.id] !== undefined).length;
    // 24 total, 10 played => at least 10 never-played left; there should be no repeats.
    expect(overlap).toBe(0);
  });
});
