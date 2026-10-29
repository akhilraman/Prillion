import { describe, expect, it } from 'vitest';
import { editDistance, matchAnswer, maxEdits } from './matcher.ts';
import { makeAnswer, makeQuestion } from './testFixtures.ts';

const moons = makeQuestion('moons', {
  answers: [
    makeAnswer('europa', { canonical: 'Europa' }),
    makeAnswer('io', { canonical: 'Io' }),
    makeAnswer('ganymede', { canonical: 'Ganymede' }),
    makeAnswer('callisto', { canonical: 'Callisto' }),
  ],
});

const apollo = makeQuestion('apollo', {
  answers: [
    makeAnswer('a11', { canonical: 'Apollo 11' }),
    makeAnswer('a12', { canonical: 'Apollo 12' }),
    makeAnswer('a17', { canonical: 'Apollo 17' }),
  ],
});

const dre = makeQuestion('nwa', {
  answers: [
    makeAnswer('dre', { canonical: 'Dr. Dre', aliases: ['Dre', 'Andre Young'] }),
    makeAnswer('eazy', { canonical: 'Eazy-E', aliases: ['Eric Wright'] }),
  ],
});

describe('editDistance', () => {
  it('computes substitutions, insertions, deletions', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('same', 'same')).toBe(0);
  });

  it('counts an adjacent transposition as a single edit', () => {
    expect(editDistance('europa', 'euorpa')).toBe(1);
  });
});

describe('maxEdits', () => {
  it('allows no typos in short strings', () => {
    expect(maxEdits(2)).toBe(0);
    expect(maxEdits(4)).toBe(0);
  });
  it('scales with length', () => {
    expect(maxEdits(5)).toBe(1);
    expect(maxEdits(8)).toBe(1);
    expect(maxEdits(9)).toBe(2);
  });
});

describe('matchAnswer: exact', () => {
  it('ignores case, spacing and punctuation', () => {
    const r = matchAnswer(dre, '  dr   DRE!! ');
    expect(r).toMatchObject({ kind: 'match', via: 'exact', distance: 0 });
    if (r.kind === 'match') expect(r.answer.id).toBe('dre');
  });

  it('accepts aliases', () => {
    const r = matchAnswer(dre, 'andre young');
    expect(r.kind === 'match' && r.answer.id).toBe('dre');
  });

  it('accepts punctuation variants of a hyphenated name', () => {
    expect(matchAnswer(dre, 'eazy e').kind).toBe('match');
    expect(matchAnswer(dre, 'Eazy-E').kind).toBe('match');
  });
});

describe('matchAnswer: typo tolerance', () => {
  it('accepts a single typo in a long-enough word', () => {
    const r = matchAnswer(moons, 'Ganymeade');
    expect(r).toMatchObject({ kind: 'match', via: 'fuzzy', distance: 1 });
    if (r.kind === 'match') expect(r.answer.id).toBe('ganymede');
  });

  it('accepts a transposition', () => {
    expect(matchAnswer(moons, 'Euorpa').kind).toBe('match');
  });

  it('enforces the edit limit for an 8-character name (limit is 1)', () => {
    expect(matchAnswer(moons, 'Calliszo').kind).toBe('match'); // 1 substitution
    expect(matchAnswer(moons, 'Gonymeda').kind).toBe('no-match'); // 2 substitutions
  });

  it('allows two edits for names of 9+ characters', () => {
    const q = makeQuestion('long', {
      answers: [makeAnswer('c', { canonical: 'Compton Gamma Ray Observatory' }), makeAnswer('d')],
    });
    expect(matchAnswer(q, 'Compton Gama Ray Observatry').kind).toBe('match'); // 2 deletions
  });

  it('never fuzzy-matches very short answers', () => {
    // "Io" must not match "Ia", "Ix", etc.
    expect(matchAnswer(moons, 'Ia')).toEqual({ kind: 'no-match', reason: 'unknown' });
  });

  it('refuses to fuzzy-match when digits differ (Apollo 11 vs 12 vs 13)', () => {
    expect(matchAnswer(apollo, 'Apollo 13')).toEqual({ kind: 'no-match', reason: 'unknown' });
    expect(matchAnswer(apollo, 'Apollo 1')).toEqual({ kind: 'no-match', reason: 'unknown' });
  });

  it('still fuzzy-matches the word part when digits are identical', () => {
    const r = matchAnswer(apollo, 'Appolo 11');
    expect(r.kind === 'match' && r.answer.id).toBe('a11');
  });

  it('refuses to guess when two different answers are equally close', () => {
    const q = makeQuestion('tie', {
      answers: [makeAnswer('x', { canonical: 'Marcus' }), makeAnswer('y', { canonical: 'Marcos' })],
    });
    // "Marcas" is one edit from both.
    expect(matchAnswer(q, 'Marcas')).toEqual({ kind: 'no-match', reason: 'ambiguous' });
  });

  it('prefers the strictly closer answer when distances differ', () => {
    const q = makeQuestion('closer', {
      answers: [makeAnswer('x', { canonical: 'Marcus' }), makeAnswer('y', { canonical: 'Marcello' })],
    });
    const r = matchAnswer(q, 'Marcuss');
    expect(r.kind === 'match' && r.answer.id).toBe('x');
  });
});

describe('matchAnswer: rejections', () => {
  it('rejects empty and punctuation-only input', () => {
    expect(matchAnswer(moons, '')).toEqual({ kind: 'no-match', reason: 'empty' });
    expect(matchAnswer(moons, ' ?!. ')).toEqual({ kind: 'no-match', reason: 'empty' });
  });

  it('rejects unrelated text', () => {
    expect(matchAnswer(moons, 'Titan')).toEqual({ kind: 'no-match', reason: 'unknown' });
  });

  it('does not match a partial name that is not an alias', () => {
    const q = makeQuestion('partial', {
      answers: [makeAnswer('a', { canonical: 'Baahubali: The Beginning' }), makeAnswer('b')],
    });
    expect(matchAnswer(q, 'Baahubali').kind).toBe('no-match');
  });
});
