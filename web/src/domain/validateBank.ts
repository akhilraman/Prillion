/**
 * Runtime validation of the question bank.
 *
 * TypeScript types vanish at runtime: `import bank from './x.json'` is only
 * *assumed* to match `QuestionBank`. Content will soon come from a pipeline we
 * don't fully control, so we validate at the boundary and report EVERY
 * problem with a path, instead of crashing mid-game on `undefined.canonical`.
 *
 * (A schema library such as zod would shorten this. We hand-write it for now to
 * avoid a dependency; revisit when the schema grows or is shared with the
 * pipeline via JSON Schema.)
 */

import { normalizeAnswer } from './normalize.ts';
import { CATEGORIES } from './types.ts';
import type { QuestionBank } from './types.ts';

export interface ValidationIssue {
  path: string;
  message: string;
}

export type ValidationResult =
  { ok: true; bank: QuestionBank; issues: [] } | { ok: false; issues: ValidationIssue[] };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Allowed gap between sum of familiarity priors and 1.0 for a closed set. */
const CLOSED_SET_SUM_TOLERANCE = 0.05;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export function validateQuestionBank(data: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });

  if (!isRecord(data)) return { ok: false, issues: [{ path: '$', message: 'bank must be an object' }] };
  if (data['schemaVersion'] !== 1) add('$.schemaVersion', 'must be 1');
  if (!Array.isArray(data['questions'])) {
    add('$.questions', 'must be an array');
    return { ok: false, issues };
  }

  const seenQuestionIds = new Set<string>();

  data['questions'].forEach((q: unknown, qi) => {
    const qp = `$.questions[${qi}]`;
    if (!isRecord(q)) return add(qp, 'must be an object');

    const qid = q['id'];
    if (!isNonEmptyString(qid)) add(`${qp}.id`, 'must be a non-empty string');
    else if (seenQuestionIds.has(qid)) add(`${qp}.id`, `duplicate question id "${qid}"`);
    else seenQuestionIds.add(qid);

    if (!isNonEmptyString(q['prompt'])) add(`${qp}.prompt`, 'must be a non-empty string');
    if (!isNonEmptyString(q['explanation'])) add(`${qp}.explanation`, 'must be a non-empty string');
    if (q['criteria'] !== undefined && !isNonEmptyString(q['criteria'])) {
      add(`${qp}.criteria`, 'if present, must be a non-empty string');
    }
    if (!(CATEGORIES as readonly unknown[]).includes(q['category'])) {
      add(`${qp}.category`, `must be one of ${CATEGORIES.join(', ')}`);
    }
    if (q['answerSet'] !== 'closed' && q['answerSet'] !== 'open') {
      add(`${qp}.answerSet`, 'must be "closed" or "open"');
    }
    if (typeof q['approvedOn'] !== 'string' || !ISO_DATE.test(q['approvedOn'])) {
      add(`${qp}.approvedOn`, 'must be an ISO date (YYYY-MM-DD)');
    }

    // ---- sources
    const sourceIds = new Set<string>();
    if (!Array.isArray(q['sources']) || q['sources'].length === 0) {
      add(`${qp}.sources`, 'at least one source is required');
    } else {
      q['sources'].forEach((s: unknown, si) => {
        const sp = `${qp}.sources[${si}]`;
        if (!isRecord(s)) return add(sp, 'must be an object');
        if (!isNonEmptyString(s['id'])) add(`${sp}.id`, 'must be a non-empty string');
        else if (sourceIds.has(s['id'])) add(`${sp}.id`, `duplicate source id "${s['id']}"`);
        else sourceIds.add(s['id']);
        for (const field of ['title', 'publisher'] as const) {
          if (!isNonEmptyString(s[field])) add(`${sp}.${field}`, 'must be a non-empty string');
        }
        if (typeof s['url'] !== 'string' || !s['url'].startsWith('https://')) {
          add(`${sp}.url`, 'must be an https:// URL');
        }
        if (typeof s['retrievedOn'] !== 'string' || !ISO_DATE.test(s['retrievedOn'])) {
          add(`${sp}.retrievedOn`, 'must be an ISO date (YYYY-MM-DD)');
        }
      });
    }

    // ---- answers
    if (!Array.isArray(q['answers']) || q['answers'].length < 2) {
      add(`${qp}.answers`, 'at least two answers are required');
      return;
    }

    const answerIds = new Set<string>();
    /** normalised form -> answer id that owns it, to detect alias collisions. */
    const formOwners = new Map<string, string>();
    let familiaritySum = 0;

    q['answers'].forEach((a: unknown, ai) => {
      const ap = `${qp}.answers[${ai}]`;
      if (!isRecord(a)) return add(ap, 'must be an object');

      const aid = a['id'];
      if (!isNonEmptyString(aid)) add(`${ap}.id`, 'must be a non-empty string');
      else if (answerIds.has(aid)) add(`${ap}.id`, `duplicate answer id "${aid}"`);
      else answerIds.add(aid);

      if (!isNonEmptyString(a['canonical'])) add(`${ap}.canonical`, 'must be a non-empty string');
      if (!isNonEmptyString(a['evidence'])) add(`${ap}.evidence`, 'must be a non-empty string');
      if (a['familiarityBasis'] !== 'curated-estimate' && a['familiarityBasis'] !== 'signal-model') {
        add(`${ap}.familiarityBasis`, 'must be "curated-estimate" or "signal-model"');
      }

      const fam = a['familiarity'];
      if (typeof fam !== 'number' || !(fam > 0 && fam <= 1)) {
        add(`${ap}.familiarity`, 'must be a number in (0, 1]');
      } else {
        familiaritySum += fam;
      }

      if (!Array.isArray(a['aliases']) || !a['aliases'].every((x) => typeof x === 'string')) {
        add(`${ap}.aliases`, 'must be an array of strings');
      }
      if (!Array.isArray(a['sourceIds']) || a['sourceIds'].length === 0) {
        add(`${ap}.sourceIds`, 'at least one source id is required');
      } else {
        for (const sid of a['sourceIds']) {
          if (typeof sid !== 'string' || !sourceIds.has(sid)) {
            add(`${ap}.sourceIds`, `references unknown source "${String(sid)}"`);
          }
        }
      }

      // Two different answers must never share a normalised name or alias,
      // otherwise a submission would be ambiguous.
      if (isNonEmptyString(a['canonical']) && Array.isArray(a['aliases']) && isNonEmptyString(aid)) {
        for (const text of [
          a['canonical'],
          ...(a['aliases'] as unknown[]).filter((x) => typeof x === 'string'),
        ]) {
          const form = normalizeAnswer(text as string);
          if (form === '') {
            add(`${ap}`, `"${String(text)}" normalises to an empty string`);
            continue;
          }
          const owner = formOwners.get(form);
          if (owner !== undefined && owner !== aid) {
            add(ap, `"${String(text)}" collides with answer "${owner}" after normalisation`);
          }
          formOwners.set(form, aid);
        }
      }
    });

    if (q['answerSet'] === 'closed' && Math.abs(familiaritySum - 1) > CLOSED_SET_SUM_TOLERANCE) {
      add(`${qp}.answers`, `familiarity of a closed set should sum to ~1 (got ${familiaritySum.toFixed(3)})`);
    }
    if (q['answerSet'] === 'open' && familiaritySum > 1 + CLOSED_SET_SUM_TOLERANCE) {
      add(`${qp}.answers`, `familiarity of an open set must not exceed 1 (got ${familiaritySum.toFixed(3)})`);
    }
  });

  return issues.length === 0
    ? { ok: true, bank: data as unknown as QuestionBank, issues: [] }
    : { ok: false, issues };
}

/** Throwing wrapper for startup code: bad content should fail loudly, once, with every problem listed. */
export function parseQuestionBank(data: unknown): QuestionBank {
  const result = validateQuestionBank(data);
  if (!result.ok) {
    const detail = result.issues.map((i) => `  ${i.path}: ${i.message}`).join('\n');
    throw new Error(`Invalid question bank (${result.issues.length} problems):\n${detail}`);
  }
  return result.bank;
}
