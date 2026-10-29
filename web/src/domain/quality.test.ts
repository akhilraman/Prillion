import { describe, expect, it } from 'vitest';
import { checkQuestionQuality, MAX_TOP_SHARE, MIN_ANSWERS } from './quality.ts';
import { makeAnswer, makeQuestion } from './testFixtures.ts';

/** n answers with a geometric popularity decay, which spreads over all four tiers. */
function wideQuestion(n: number, overrides = {}) {
  const answers = Array.from({ length: n }, (_, i) =>
    makeAnswer(`a${i}`, { familiarity: Math.max(0.006, 0.2 * 0.7 ** i) }),
  );
  return makeQuestion('q', { answerSet: 'closed', answers, ...overrides });
}

const codes = (q: ReturnType<typeof makeQuestion>) => checkQuestionQuality(q).map((i) => i.code);

describe('checkQuestionQuality', () => {
  it('accepts a wide question with a spread of popularity', () => {
    expect(checkQuestionQuality(wideQuestion(14))).toEqual([]);
  });

  it('rejects a question with too few answers (the "3 leads in Eega" problem)', () => {
    expect(codes(wideQuestion(MIN_ANSWERS - 1))).toContain('too-few-answers');
    expect(codes(makeQuestion('eega'))).toContain('too-few-answers');
  });

  it('rejects answers that are all about equally popular (no rarity signal)', () => {
    const flat = makeQuestion('flat', {
      answers: Array.from({ length: 12 }, (_, i) => makeAnswer(`a${i}`, { familiarity: 1 / 12 })),
    });
    expect(codes(flat)).toContain('too-few-tiers');
  });

  it('rejects a question where one answer dominates', () => {
    const q = wideQuestion(12);
    q.answers[0]!.familiarity = MAX_TOP_SHARE + 0.1;
    expect(codes(q)).toContain('dominant-answer');
  });

  it('requires criteria for open sets, but not for closed ones', () => {
    expect(codes(wideQuestion(14, { answerSet: 'open' }))).toContain('missing-criteria');
    expect(codes(wideQuestion(14, { answerSet: 'open', criteria: '   ' }))).toContain('missing-criteria');
    expect(codes(wideQuestion(14, { answerSet: 'open', criteria: 'Hero liberates a village.' }))).toEqual([]);
    expect(codes(wideQuestion(14, { answerSet: 'closed' }))).not.toContain('missing-criteria');
  });

  it('reports every problem at once, not just the first', () => {
    const q = makeQuestion('bad', { answerSet: 'open' });
    expect(codes(q)).toEqual(
      expect.arrayContaining(['too-few-answers', 'missing-criteria', 'too-few-tiers']),
    );
  });
});
