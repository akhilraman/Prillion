/**
 * Usage: node scripts/check-bank.ts <bank.json>
 *
 * Runs the structural validator and the editorial quality gate over a whole question
 * bank. Exit code 0 = publishable, 1 = problems found, 2 = file could not be read.
 * Used by the pipeline's `promote` command before it replaces the live bank.
 */

import { readFileSync } from 'node:fs';
import { argv, exit } from 'node:process';

import { checkBank } from '../src/domain/checkBank.ts';

const file = argv[2];
if (file === undefined) {
  console.error('usage: node scripts/check-bank.ts <bank.json>');
  exit(2);
}

let data: unknown;
try {
  data = JSON.parse(readFileSync(file, 'utf8'));
} catch (error) {
  console.error(`${file}: cannot read as JSON (${error instanceof Error ? error.message : String(error)})`);
  exit(2);
}

const report = checkBank(data);
if (report.ok) {
  console.log(`PASS ${file}`);
  exit(0);
}

console.log(`FAIL ${file}`);
for (const issue of report.structural) console.log(`  structure ${issue.path}: ${issue.message}`);
for (const issue of report.quality)
  console.log(`  quality   ${issue.questionId} ${issue.code}: ${issue.message}`);
exit(1);
