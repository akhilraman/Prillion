/**
 * Usage: node scripts/split-bank.ts
 *
 * Reads the pipeline's single source of truth (`src/content/seed-bank.json`) and
 * writes one JSON file per category plus a tiny index. The app lazy-loads a
 * category when the player picks a dive, so the initial JS bundle does not
 * contain every answer list.
 *
 * Generated files are gitignored. `npm run dev`, `typecheck`, `test` and `build`
 * all run this first so the files exist before Vite or tsc look for them.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exit } from 'node:process';

const CATEGORIES = ['tollywood', 'space', 'us-pop'] as const;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bankPath = join(root, 'src/content/seed-bank.json');
const outDir = join(root, 'src/content/banks');
const indexPath = join(root, 'src/content/bank-index.json');

interface Question {
  id: unknown;
  category: unknown;
}

let bank: { schemaVersion?: unknown; questions?: unknown };
try {
  bank = JSON.parse(readFileSync(bankPath, 'utf8')) as typeof bank;
} catch (error) {
  console.error(
    `split-bank: cannot read ${bankPath} (${error instanceof Error ? error.message : String(error)})`,
  );
  exit(2);
}

if (!Array.isArray(bank.questions)) {
  console.error('split-bank: seed-bank.json is not a question bank (expected a `questions` array)');
  exit(2);
}

const grouped: Record<(typeof CATEGORIES)[number], Question[]> = {
  tollywood: [],
  space: [],
  'us-pop': [],
};
const unknown: string[] = [];
const ids: string[] = [];

for (const question of bank.questions as Question[]) {
  const category = question.category;
  if (category === 'tollywood' || category === 'space' || category === 'us-pop') {
    grouped[category].push(question);
    if (typeof question.id === 'string') ids.push(question.id);
  } else {
    unknown.push(typeof question.id === 'string' ? question.id : '?');
  }
}

if (unknown.length > 0) {
  console.error(`split-bank: questions with an unknown category: ${unknown.join(', ')}`);
  exit(2);
}

mkdirSync(outDir, { recursive: true });
const counts = { tollywood: 0, space: 0, 'us-pop': 0 };

for (const category of CATEGORIES) {
  const questions = grouped[category];
  counts[category] = questions.length;
  writeFileSync(
    join(outDir, `${category}.json`),
    JSON.stringify({ schemaVersion: bank.schemaVersion ?? 1, questions }, null, 2) + '\n',
    'utf8',
  );
}

writeFileSync(
  indexPath,
  JSON.stringify({ schemaVersion: bank.schemaVersion ?? 1, counts, ids }, null, 2) + '\n',
  'utf8',
);

console.log(
  `split-bank: ${ids.length} questions -> ${CATEGORIES.map((c) => `${c} ${counts[c]}`).join(', ')}`,
);
