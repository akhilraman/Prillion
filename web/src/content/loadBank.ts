import { CATEGORIES } from '../domain/types.ts';
import type { Category, CategorySelection, Question } from '../domain/types.ts';
import { validateQuestionBank } from '../domain/validateBank.ts';
import bankIndex from './bank-index.json';

export type BankLoad = { ok: true; questions: readonly Question[] } | { ok: false; message: string };

export interface BankIndex {
  schemaVersion: number;
  counts: Record<Category, number>;
  ids: readonly string[];
}

/** Tiny: counts and ids only. Safe to ship in the initial bundle so the home screen can render. */
export function loadIndex(
  data: unknown = bankIndex,
): { ok: true; index: BankIndex } | { ok: false; message: string } {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, message: 'The question-bank index is invalid.' };
  }
  const record = data as Record<string, unknown>;
  if (record['schemaVersion'] !== 1 || typeof record['counts'] !== 'object' || record['counts'] === null) {
    return { ok: false, message: 'The question-bank index is invalid.' };
  }
  const rawCounts = record['counts'] as Record<string, unknown>;
  const counts = {} as Record<Category, number>;
  for (const category of CATEGORIES) {
    const n = rawCounts[category];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
      return { ok: false, message: 'The question-bank index is invalid.' };
    }
    counts[category] = n;
  }
  if (
    !Array.isArray(record['ids']) ||
    !record['ids'].every((id) => typeof id === 'string' && id.length > 0)
  ) {
    return { ok: false, message: 'The question-bank index is invalid.' };
  }
  return { ok: true, index: { schemaVersion: 1, counts, ids: record['ids'] as string[] } };
}

/** Counts and ids derived from an already-loaded bank (tests inject a fixture this way). */
export function indexFromQuestions(questions: readonly Question[]): BankIndex {
  const counts = { tollywood: 0, space: 0, 'us-pop': 0 };
  const ids: string[] = [];
  for (const question of questions) {
    counts[question.category] += 1;
    ids.push(question.id);
  }
  return { schemaVersion: 1, counts, ids };
}

/**
 * Validates untrusted content at the boundary and returns a result instead of
 * throwing, so the UI can show a friendly error screen rather than a blank page.
 */
export function loadBank(data: unknown): BankLoad {
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

const cache = new Map<Category, readonly Question[]>();

/** Vite turns each of these into its own hashed chunk, loaded only when that dive is chosen. */
const loaders: Record<Category, () => Promise<{ default: unknown }>> = {
  tollywood: () => import('./banks/tollywood.json'),
  space: () => import('./banks/space.json'),
  'us-pop': () => import('./banks/us-pop.json'),
};

async function loadOne(category: Category): Promise<BankLoad> {
  const hit = cache.get(category);
  if (hit) return { ok: true, questions: hit };

  let mod: { default: unknown };
  try {
    mod = await loaders[category]();
  } catch (error) {
    console.error(`Failed to load ${category} questions:`, error);
    return { ok: false, message: `Could not load the ${category} questions. Try reloading.` };
  }

  const loaded = loadBank(mod.default);
  if (!loaded.ok) return loaded;

  const mismatched = loaded.questions.filter((q) => q.category !== category);
  if (mismatched.length > 0) {
    console.error(
      `${category} bank contains questions from another category:`,
      mismatched.map((q) => q.id),
    );
    return { ok: false, message: `The ${category} question bank is invalid.` };
  }

  cache.set(category, loaded.questions);
  return loaded;
}

/** Loads the category files a dive needs. Mixed loads all three in parallel. */
export async function loadCategories(selection: CategorySelection): Promise<BankLoad> {
  const wanted: readonly Category[] = selection === 'mixed' ? CATEGORIES : [selection];
  const parts = await Promise.all(wanted.map(loadOne));
  const failed = parts.find((p) => !p.ok);
  if (failed && !failed.ok) return failed;
  const questions = parts.flatMap((p) => (p.ok ? p.questions : []));
  if (questions.length === 0) return { ok: false, message: 'The question bank is empty.' };
  return { ok: true, questions };
}
