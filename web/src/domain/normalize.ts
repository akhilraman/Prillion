/**
 * Answer normalisation.
 *
 * Goal: collapse HARMLESS differences (case, spacing, punctuation, accents,
 * a leading article) while never merging answers that are genuinely different.
 *
 * Deliberately NOT done here: spelling correction. That is a separate,
 * more dangerous step (see matcher.ts) and is kept out of normalisation so
 * that normalisation stays a pure, predictable, idempotent function.
 */

const LEADING_ARTICLES = /^(the|a|an)\s+/;

export function normalizeAnswer(input: string): string {
  return (
    input
      // Compatibility-decompose so "é" -> "e" + combining mark, full-width -> ASCII, etc.
      .normalize('NFKD')
      // Drop combining marks (accents).
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      // "Dolce & Gabbana" and "Dolce and Gabbana" should match.
      .replace(/&/g, ' and ')
      // Apostrophes vanish rather than becoming spaces: "don't" -> "dont".
      .replace(/['\u2019\u2018`]/g, '')
      // Every other non-letter/digit becomes a space: "Dr. Dre" / "Dr-Dre" -> "dr dre".
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .replace(/\s+/g, ' ')
      .replace(LEADING_ARTICLES, '')
  );
}

/** The sequence of digit-runs in a string, e.g. "apollo 11" -> ["11"]. */
export function digitRuns(normalized: string): string[] {
  return normalized.match(/\p{N}+/gu) ?? [];
}
