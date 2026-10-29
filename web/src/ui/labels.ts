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

/** Metres of depth per question answered; purely cosmetic for now. */
export const METRES_PER_QUESTION = 40;

export function headlineFor(result: QuestionResult): string {
  switch (result.outcome) {
    case 'correct':
      return `Correct! ${result.score ? TIER_LABELS[result.score.tier] : ''} answer, +${result.points}`;
    case 'timeout':
      return "Time's up";
    case 'incorrect':
      return 'Not quite';
  }
}
