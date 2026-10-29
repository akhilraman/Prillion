import { describe, expect, it } from 'vitest';
import { checkQuestionQuality, MAX_TOP_SHARE, MIN_ANSWERS } from './quality.ts';
import { makeAiQuestion, makeAnswer, makeQuestion } from './testFixtures.ts';

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

  describe('ai-knowledge questions', () => {
    it('accepts a well-formed one', () => {
      expect(checkQuestionQuality(makeAiQuestion('meme'))).toEqual([]);
    });

    it('must be an open set: no source means no claim of completeness', () => {
      expect(codes(makeAiQuestion('meme', { answerSet: 'closed' }))).toContain('ai-closed-set');
    });

    it('is not checked for the closed-set rule when it is a sourced question', () => {
      expect(codes(wideQuestion(14, { answerSet: 'closed' }))).not.toContain('ai-closed-set');
    });

    it.each([
      ['the prompt', { prompt: 'Name a celebrity who was allegedly arrested at a party.' }],
      ['the explanation', { explanation: 'He was accused of cheating.' }],
      ['the criteria', { criteria: 'Anyone involved in a leaked photo scandal.' }],
    ])('rejects a sensitive term in %s', (_where, overrides) => {
      expect(codes(makeAiQuestion('rumour', overrides))).toContain('sensitive-term');
    });

    it('rejects a sensitive term hidden in an alias or evidence', () => {
      const q = makeAiQuestion('rumour');
      q.answers[3]!.aliases = ['the sex tape one'];
      expect(codes(q)).toContain('sensitive-term');

      const r = makeAiQuestion('rumour');
      r.answers[2]!.evidence = 'Fans accused him of lip-syncing.';
      expect(codes(r)).toContain('sensitive-term');
    });

    it('does not apply the term scan to sourced questions (a document backs those)', () => {
      const q = wideQuestion(14, { prompt: 'Name someone who was convicted at the Nuremberg trials.' });
      expect(codes(q)).not.toContain('sensitive-term');
    });

    it('does not trip on innocent words that merely contain a term', () => {
      const q = makeAiQuestion('memes', {
        prompt: 'Name a meme about the Grapevine or a drape of rapeseed.',
      });
      expect(codes(q)).not.toContain('sensitive-term');
    });
  });
});
