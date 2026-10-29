import { describe, expect, it, vi } from 'vitest';
import { makeQuestion } from '../domain/testFixtures.ts';
import { loadBank } from './loadBank.ts';

describe('loadBank', () => {
  it('loads the bundled seed bank', () => {
    const r = loadBank();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.questions.length).toBeGreaterThanOrEqual(15);
  });

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
