/** Builders for small, explicit test data. Not imported by app code. */
import type { Answer, Category, Question } from './types.ts';

export function makeAnswer(id: string, overrides: Partial<Answer> = {}): Answer {
  return {
    id,
    canonical: id,
    aliases: [],
    familiarity: 0.25,
    familiarityBasis: 'curated-estimate',
    evidence: 'test evidence',
    sourceIds: ['s1'],
    ...overrides,
  };
}

export function makeQuestion(id: string, overrides: Partial<Question> = {}): Question {
  return {
    id,
    category: 'space',
    prompt: `Prompt for ${id}`,
    answerSet: 'closed',
    answers: [makeAnswer('alpha'), makeAnswer('beta'), makeAnswer('gamma'), makeAnswer('delta')],
    explanation: 'test explanation',
    sources: [
      { id: 's1', title: 'T', publisher: 'P', url: 'https://example.com', retrievedOn: '2026-01-01' },
    ],
    approvedOn: '2026-01-01',
    ...overrides,
  };
}

export function makeBank(perCategory: Record<Category, number>): Question[] {
  const out: Question[] = [];
  for (const category of Object.keys(perCategory) as Category[]) {
    for (let i = 0; i < perCategory[category]; i++) {
      out.push(makeQuestion(`${category}-${i}`, { category }));
    }
  }
  return out;
}
