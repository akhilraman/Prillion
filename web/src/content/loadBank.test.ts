import { describe, expect, it, vi } from 'vitest';
import { makeQuestion } from '../domain/testFixtures.ts';
import { CATEGORIES } from '../domain/types.ts';
import seedBank from './seed-bank.json';
import { indexFromQuestions, loadBank, loadCategories, loadIndex } from './loadBank.ts';

describe('loadBank', () => {
  it('returns an error result (does not throw) for malformed data', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = loadBank({ schemaVersion: 1, questions: [{ id: 'x' }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/invalid/i);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('treats an empty bank as an error', () => {
    const r = loadBank({ schemaVersion: 1, questions: [] });
    expect(r).toEqual({ ok: false, message: 'The question bank is empty.' });
  });

  it('accepts a valid custom bank', () => {
    expect(loadBank({ schemaVersion: 1, questions: [makeQuestion('a')] }).ok).toBe(true);
  });
});

describe('loadIndex', () => {
  it('loads the generated index, matching the seed bank', () => {
    const r = loadIndex();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const questions = (seedBank as { questions: { id: string; category: string }[] }).questions;
    expect(r.index.ids).toHaveLength(questions.length);
    expect(r.index.ids).toEqual(questions.map((q) => q.id));
    for (const category of CATEGORIES) {
      expect(r.index.counts[category]).toBe(questions.filter((q) => q.category === category).length);
    }
  });

  it('builds an index from an injected bank', () => {
    const questions = [makeQuestion('a', { category: 'space' }), makeQuestion('b', { category: 'space' })];
    expect(indexFromQuestions(questions)).toEqual({
      schemaVersion: 1,
      counts: { tollywood: 0, space: 2, 'us-pop': 0 },
      ids: ['a', 'b'],
    });
  });
});

describe('loadCategories', () => {
  it('loads only the chosen category', async () => {
    const r = await loadCategories('space');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.questions.length).toBeGreaterThan(0);
    expect(r.questions.every((q) => q.category === 'space')).toBe(true);
  });

  it('loads every category for a mixed dive', async () => {
    const r = await loadCategories('mixed');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const index = loadIndex();
    expect(index.ok).toBe(true);
    if (!index.ok) return;
    expect(r.questions).toHaveLength(index.index.ids.length);
  });
});
