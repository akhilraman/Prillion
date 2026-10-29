/**
 * Usage: node scripts/check-candidate.ts <candidate.json> [more.json ...]
 *
 * Runs the game's own structural validator and editorial quality gate on
 * pipeline output. Exit code 0 = every candidate is publishable, 1 = at least one
 * is not, 2 = a file could not be read. Used by the pipeline CLI and by CI.
 */

import { readFileSync } from 'node:fs';
import { argv, exit } from 'node:process';

import { checkCandidate } from '../src/domain/checkCandidate.ts';

const files = argv.slice(2);
if (files.length === 0) {
  console.error('usage: node scripts/check-candidate.ts <candidate.json> [...]');
  exit(2);
}

let failed = false;
for (const file of files) {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    console.error(`${file}: cannot read as JSON (${error instanceof Error ? error.message : String(error)})`);
    exit(2);
  }

  const report = checkCandidate(data);
  if (report.ok) {
    console.log(`PASS ${file}`);
    continue;
  }

  failed = true;
  console.log(`FAIL ${file}`);
  for (const issue of report.structural) console.log(`  structure ${issue.path}: ${issue.message}`);
  for (const issue of report.quality) console.log(`  quality   ${issue.code}: ${issue.message}`);
}

exit(failed ? 1 : 0);
