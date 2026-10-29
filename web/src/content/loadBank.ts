import { validateQuestionBank } from '../domain/validateBank.ts';
import type { Question } from '../domain/types.ts';
import seedBank from './seed-bank.json';

export type BankLoad = { ok: true; questions: readonly Question[] } | { ok: false; message: string };

/**
 * Validates untrusted content at the boundary and returns a result instead of
 * throwing, so the UI can show a friendly error screen rather than a blank page.
 */
export function loadBank(data: unknown = seedBank): BankLoad {
  const result = validateQuestionBank(data);
  if (!result.ok) {
    // Full detail goes to the console for developers; the user sees a short message.
    console.error('Question bank failed validation:', result.issues);
    const first = result.issues[0];
    return {
      ok: false,
      message: `The question bank is invalid (${result.issues.length} problem${result.issues.length === 1 ? '' : 's'}).${first ? ` First: ${first.path} ${first.message}` : ''}`,
    };
  }
  if (result.bank.questions.length === 0) {
    return { ok: false, message: 'The question bank is empty.' };
  }
  return { ok: true, questions: result.bank.questions };
}
