import { describe, expect, it } from 'vitest';
import seedBank from '../content/seed-bank.json';
import { matchAnswer } from './matcher.ts';
import { checkQuestionQuality } from './quality.ts';
import { parseQuestionBank, validateQuestionBank } from './validateBank.ts';
import { makeAnswer, makeQuestion } from './testFixtures.ts';
import { CATEGORIES } from './types.ts';

const bankOf = (...questions: unknown[]) => ({ schemaVersion: 1, questions });

function issuesFor(data: unknown): string[] {
  const r = validateQuestionBank(data);
  return r.ok ? [] : r.issues.map((i) => `${i.path}: ${i.message}`);
}

describe('seed question bank (contract test)', () => {
  it('passes validation with zero issues', () => {
    expect(issuesFor(seedBank)).toEqual([]);
  });

  it('has the expected number of questions and covers every category', () => {
    const bank = parseQuestionBank(seedBank);
    expect(bank.questions.length).toBeGreaterThanOrEqual(15);
    for (const c of CATEGORIES) {
      expect(bank.questions.some((q) => q.category === c)).toBe(true);
    }
  });

  it('every question passes the editorial quality gate (10+ answers, a rarity spread, criteria for open sets)', () => {
    const bank = parseQuestionBank(seedBank);
    for (const q of bank.questions) {
      const issues = checkQuestionQuality(q).map((i) => `${i.code}: ${i.message}`);
      expect(issues, q.id).toEqual([]);
    }
  });

  // A single-category dive is 7 prompts, so a category below 7 gives a "short round" (handled by
  // selection and shown on the home screen). 5 is the floor while the pipeline grows the bank to its
  // launch target of 40 per category; raise this to the dive length once content catches up.
  it('has at least 5 questions per category', () => {
    const bank = parseQuestionBank(seedBank);
    for (const c of CATEGORIES) {
      expect(bank.questions.filter((q) => q.category === c).length, c).toBeGreaterThanOrEqual(5);
    }
  });

  it('every canonical answer and every alias matches its own answer', () => {
    const bank = parseQuestionBank(seedBank);
    for (const q of bank.questions) {
      for (const a of q.answers) {
        for (const text of [a.canonical, ...a.aliases]) {
          const r = matchAnswer(q, text);
          expect(r.kind === 'match' && r.answer.id, `${q.id}: "${text}"`).toBe(a.id);
        }
      }
    }
  });

  it('canonical names and aliases always resolve by EXACT match, never by fuzzy luck', () => {
    // If this fails, an alias normalises to something that only matches via the typo path.
    const bank = parseQuestionBank(seedBank);
    for (const q of bank.questions) {
      for (const a of q.answers) {
        for (const text of [a.canonical, ...a.aliases]) {
          const r = matchAnswer(q, text);
          expect(r.kind === 'match' && r.via, `${q.id}: "${text}"`).toBe('exact');
        }
      }
    }
  });
});

describe('validateQuestionBank: malformed input', () => {
  it('rejects non-objects and wrong versions', () => {
    expect(issuesFor(null)).toEqual(['$: bank must be an object']);
    expect(issuesFor('x')).toEqual(['$: bank must be an object']);
    expect(issuesFor({ schemaVersion: 2, questions: [] })).toContain('$.schemaVersion: must be 1');
  });

  it('rejects a missing questions array', () => {
    expect(issuesFor({ schemaVersion: 1 })).toContain('$.questions: must be an array');
  });

  it('accepts a minimal valid fixture', () => {
    expect(issuesFor(bankOf(makeQuestion('ok')))).toEqual([]);
  });

  it('accepts an optional criteria string but rejects a blank one', () => {
    expect(issuesFor(bankOf(makeQuestion('c', { criteria: 'What counts.' })))).toEqual([]);
    expect(issuesFor(bankOf(makeQuestion('c', { criteria: '  ' })))).toContain(
      '$.questions[0].criteria: if present, must be a non-empty string',
    );
  });

  it('rejects duplicate question ids', () => {
    const issues = issuesFor(bankOf(makeQuestion('dup'), makeQuestion('dup')));
    expect(issues.some((i) => i.includes('duplicate question id "dup"'))).toBe(true);
  });

  it('rejects questions with fewer than two answers', () => {
    const issues = issuesFor(bankOf(makeQuestion('one', { answers: [makeAnswer('a', { familiarity: 1 })] })));
    expect(issues.some((i) => i.includes('at least two answers'))).toBe(true);
  });

  it('rejects an answer that references an unknown source', () => {
    const q = makeQuestion('src', {
      answers: [
        makeAnswer('a', { familiarity: 0.5, sourceIds: ['nope'] }),
        makeAnswer('b', { familiarity: 0.5 }),
      ],
    });
    expect(issuesFor(bankOf(q)).some((i) => i.includes('unknown source "nope"'))).toBe(true);
  });

  it('rejects an answer with no sources (no unsourced facts)', () => {
    const q = makeQuestion('nosrc', {
      answers: [makeAnswer('a', { familiarity: 0.5, sourceIds: [] }), makeAnswer('b', { familiarity: 0.5 })],
    });
    expect(issuesFor(bankOf(q)).some((i) => i.includes('at least one source id'))).toBe(true);
  });

  it('rejects non-https source URLs', () => {
    const q = makeQuestion('http', {
      sources: [
        { id: 's1', title: 'T', publisher: 'P', url: 'http://insecure.example', retrievedOn: '2026-01-01' },
      ],
    });
    expect(issuesFor(bankOf(q)).some((i) => i.includes('https://'))).toBe(true);
  });

  it('rejects out-of-range familiarity values', () => {
    for (const bad of [0, -0.1, 1.5, Number.NaN]) {
      const q = makeQuestion('fam', {
        answers: [makeAnswer('a', { familiarity: bad }), makeAnswer('b', { familiarity: 0.5 })],
      });
      expect(
        issuesFor(bankOf(q)).some((i) => i.includes('familiarity: must be a number')),
        String(bad),
      ).toBe(true);
    }
  });

  it('accepts every documented familiarityBasis and rejects anything else', () => {
    for (const basis of ['curated-estimate', 'llm-estimate', 'signal-model'] as const) {
      const q = makeQuestion('basis', {
        answers: [
          makeAnswer('a', { familiarity: 0.5, familiarityBasis: basis }),
          makeAnswer('b', { familiarity: 0.5 }),
        ],
      });
      expect(issuesFor(bankOf(q)), basis).toEqual([]);
    }

    const bad = makeQuestion('basis', {
      answers: [
        makeAnswer('a', { familiarity: 0.5, familiarityBasis: 'vibes' as never }),
        makeAnswer('b', { familiarity: 0.5 }),
      ],
    });
    expect(issuesFor(bankOf(bad)).some((i) => i.includes('familiarityBasis: must be one of'))).toBe(true);
  });

  it('rejects a closed set whose familiarity does not sum to ~1', () => {
    const q = makeQuestion('sum', {
      answers: [makeAnswer('a', { familiarity: 0.5 }), makeAnswer('b', { familiarity: 0.1 })],
    });
    expect(issuesFor(bankOf(q)).some((i) => i.includes('should sum to ~1'))).toBe(true);
  });

  it('allows an open set to sum to less than 1 (unknown answers may exist)', () => {
    const q = makeQuestion('open', {
      answerSet: 'open',
      answers: [makeAnswer('a', { familiarity: 0.3 }), makeAnswer('b', { familiarity: 0.2 })],
    });
    expect(issuesFor(bankOf(q))).toEqual([]);
  });

  it('rejects two different answers that collide after normalisation', () => {
    const q = makeQuestion('collide', {
      answers: [
        makeAnswer('a', { canonical: 'Eazy-E', familiarity: 0.5 }),
        makeAnswer('b', { canonical: 'Eazy E', familiarity: 0.5 }),
      ],
    });
    expect(issuesFor(bankOf(q)).some((i) => i.includes('collides'))).toBe(true);
  });

  it('reports every problem, not just the first', () => {
    const q = makeQuestion('multi', { prompt: '', explanation: '', approvedOn: 'yesterday' });
    expect(issuesFor(bankOf(q)).length).toBeGreaterThanOrEqual(3);
  });

  it('does not throw on wildly malformed nested data', () => {
    expect(() => validateQuestionBank(bankOf(null, 5, 'x', { answers: 'nope', sources: {} }))).not.toThrow();
  });

  it('parseQuestionBank throws with a readable list of problems', () => {
    expect(() => parseQuestionBank(bankOf(makeQuestion('d'), makeQuestion('d')))).toThrow(
      /Invalid question bank/,
    );
  });
});
