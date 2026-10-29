/**
 * Gate for a WHOLE question bank (what ships to players).
 *
 * Same two checks the game and CI already rely on: the structural validator the app
 * runs at load time, and the editorial quality gate applied to every question. The
 * pipeline's `promote` command asks this before it lets a modified bank replace the
 * live one, so a bad promotion can never be saved.
 */

import { checkQuestionQuality } from './quality.ts';
import type { QualityIssue } from './quality.ts';
import { validateQuestionBank } from './validateBank.ts';
import type { ValidationIssue } from './validateBank.ts';

export interface BankQualityIssue extends QualityIssue {
  questionId: string;
}

export interface BankReport {
  ok: boolean;
  structural: ValidationIssue[];
  quality: BankQualityIssue[];
}

export function checkBank(data: unknown): BankReport {
  const result = validateQuestionBank(data);
  if (!result.ok) return { ok: false, structural: result.issues, quality: [] };

  const quality = result.bank.questions.flatMap((question) =>
    checkQuestionQuality(question).map((issue) => ({ ...issue, questionId: question.id })),
  );
  return { ok: quality.length === 0, structural: [], quality };
}
