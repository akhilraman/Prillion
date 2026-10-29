import type { QuestionResult } from '../domain/round.ts';
import type { Category, CategorySelection, RarityTier } from '../domain/types.ts';

export const CATEGORY_LABELS: Record<CategorySelection, string> = {
  mixed: 'Mixed',
  tollywood: 'Tollywood',
  space: 'Space',
  'us-pop': 'US Pop Culture',
};

export const CATEGORY_BLURBS: Record<Category, string> = {
  tollywood: 'Telugu cinema',
  space: 'Missions, planets & more',
  'us-pop': 'Music, TV, film & sports',
};

export const TIER_LABELS: Record<RarityTier, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  legendary: 'Legendary',
};

/** What a correct answer earns on the reveal screen: a creature name and a one-line quip. */
export interface Rank {
  name: string;
  flavor: string;
}

export const RANKS: Record<RarityTier, Rank> = {
  common: { name: 'Starfish', flavor: 'Easy catch. Washed up on every shore.' },
  uncommon: { name: 'Pufferfish', flavor: 'A little off the beaten current.' },
  rare: { name: 'Anglerfish', flavor: 'Few nets reach this deep.' },
  legendary: { name: 'Leviathan', flavor: 'Almost nobody finds this one.' },
};

/** The reveal when the clock runs out. */
export const NO_CATCH: Rank = { name: 'Empty Hook', flavor: 'The line came up empty.' };

/** Plain-language outcome for screen readers (the reveal screen is mostly art). */
export function headlineFor(result: QuestionResult, sinkMetres: number): string {
  if (result.outcome === 'correct' && result.score) {
    const rank = RANKS[result.score.tier];
    return `${rank.name}: ${TIER_LABELS[result.score.tier]} answer, ${result.points} points, sink ${sinkMetres} metres`;
  }
  return `${NO_CATCH.name}: time's up, no points`;
}
