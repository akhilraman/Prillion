import { describe, expect, it } from 'vitest';

import { checkCandidate } from './checkCandidate.ts';
import { makeAnswer, makeQuestion } from './testFixtures.ts';

/** A question that passes both gates: 12 answers, a spread of familiarity, criteria for an open set. */
function goodQuestion() {
  const shares = [0.2, 0.12, 0.09, 0.07, 0.05, 0.04, 0.03, 0.02, 0.015, 0.01, 0.008, 0.006];
  return makeQuestion('good', {
    answerSet: 'open',
    criteria: 'Anything that counts.',
    answers: shares.map((familiarity, i) =>
      makeAnswer(`a${i}`, { familiarity, familiarityBasis: 'llm-estimate' }),
    ),
  });
}

describe('checkCandidate', () => {
  it('accepts a structurally valid, high-quality candidate (extra provenance is ignored)', () => {
    const report = checkCandidate({ question: goodQuestion(), provenance: { model: 'x' } });

    expect(report).toEqual({ ok: true, structural: [], quality: [] });
  });

  it('rejects non-objects and candidates without a question', () => {
    for (const bad of [null, 42, 'x', [], {}, { question: 'nope' }]) {
      const report = checkCandidate(bad);
      expect(report.ok, JSON.stringify(bad)).toBe(false);
      expect(report.structural[0]?.path).toBe('$.question');
    }
  });

  it('reports structural problems with a path and skips the quality gate', () => {
    const broken = { ...goodQuestion(), prompt: '' };
    const report = checkCandidate({ question: broken });

    expect(report.ok).toBe(false);
    expect(report.structural.some((i) => i.path.endsWith('.prompt'))).toBe(true);
    expect(report.quality).toEqual([]);
  });

  it('flags a well-formed but thin question as a quality failure', () => {
    const thin = makeQuestion('thin', {
      answers: [makeAnswer('a', { familiarity: 0.6 }), makeAnswer('b', { familiarity: 0.4 })],
    });
    const report = checkCandidate({ question: thin });

    expect(report.ok).toBe(false);
    expect(report.structural).toEqual([]);
    expect(report.quality.map((q) => q.code)).toContain('too-few-answers');
  });

  it('flags an open set that has no criteria', () => {
    const q = { ...goodQuestion(), criteria: undefined };
    const report = checkCandidate({ question: q });

    expect(report.quality.map((i) => i.code)).toContain('missing-criteria');
  });
});
