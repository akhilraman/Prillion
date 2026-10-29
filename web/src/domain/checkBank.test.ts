import { describe, expect, it } from 'vitest';
import seedBank from '../content/seed-bank.json';
import { checkBank } from './checkBank.ts';

type Bank = { schemaVersion: number; questions: Array<Record<string, unknown>> };
const clone = (): Bank => structuredClone(seedBank) as unknown as Bank;

describe('checkBank', () => {
  it('passes the shipped seed bank', () => {
    expect(checkBank(seedBank)).toEqual({ ok: true, structural: [], quality: [] });
  });

  it('reports structural problems (e.g. a duplicate question id) and no quality issues', () => {
    const bank = clone();
    bank.questions.push({ ...bank.questions[0]! });

    const report = checkBank(bank);

    expect(report.ok).toBe(false);
    expect(report.structural.some((i) => i.message.includes('duplicate question id'))).toBe(true);
    expect(report.quality).toEqual([]);
  });

  it('names the question whose quality is too low', () => {
    const bank = clone();
    const first = bank.questions[0] as { id: string; answers: unknown[] };
    first.answers = first.answers.slice(0, 3);

    const report = checkBank(bank);

    expect(report.ok).toBe(false);
    expect(report.quality.some((i) => i.questionId === first.id && i.code === 'too-few-answers')).toBe(true);
  });

  it('rejects something that is not a bank at all', () => {
    expect(checkBank(null).ok).toBe(false);
  });
});
