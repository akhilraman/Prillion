/**
 * Gate for pipeline output: a candidate file is `{ question, provenance }`.
 *
 * This reuses the SAME structural validator the game runs at load time and the
 * SAME editorial quality gate as the seed-bank contract test, so there is one
 * definition of "publishable" in the whole system. The Python pipeline never
 * re-implements these rules; it asks this function (via scripts/check-candidate.ts).
 */

import { checkQuestionQuality } from './quality.ts';
import type { QualityIssue } from './quality.ts';
import { validateQuestionBank } from './validateBank.ts';
import type { ValidationIssue } from './validateBank.ts';

export interface CandidateReport {
  ok: boolean;
  structural: ValidationIssue[];
  quality: QualityIssue[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function checkCandidate(candidate: unknown): CandidateReport {
  if (!isRecord(candidate) || !isRecord(candidate['question'])) {
    return {
      ok: false,
      structural: [{ path: '$.question', message: 'candidate must be an object with a `question` object' }],
      quality: [],
    };
  }

  const result = validateQuestionBank({ schemaVersion: 1, questions: [candidate['question']] });
  if (!result.ok) return { ok: false, structural: result.issues, quality: [] };

  const [question] = result.bank.questions;
  const quality = question ? checkQuestionQuality(question) : [];
  return { ok: quality.length === 0, structural: [], quality };
}
