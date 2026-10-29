import { CATEGORIES } from '../domain/types.ts';
import type { CategorySelection, Question } from '../domain/types.ts';
import { DEFAULT_SECONDS_PER_QUESTION } from '../domain/round.ts';
import { CATEGORY_BLURBS, CATEGORY_LABELS } from './labels.ts';

interface HomeScreenProps {
  bank: readonly Question[];
  roundLength: number;
  onStart: (selection: CategorySelection) => void;
}

export function HomeScreen({ bank, roundLength, onStart }: HomeScreenProps) {
  const counts = Object.fromEntries(
    CATEGORIES.map((c) => [c, bank.filter((q) => q.category === c).length]),
  ) as Record<(typeof CATEGORIES)[number], number>;

  return (
    <main className="screen screen--home">
      <h1 className="title">Prillion</h1>
      <p className="tagline">
        Dive deep. Answer in your own words. The rarer your answer, the more you score.
      </p>

      <p className="rules">
        {roundLength} questions per round, {DEFAULT_SECONDS_PER_QUESTION} seconds each. Every valid answer is
        accepted, and less common answers earn more points.
      </p>

      <h2 className="section-title">Choose a dive</h2>
      <ul className="category-grid">
        <li>
          <button className="category-card" type="button" onClick={() => onStart('mixed')}>
            <span className="category-card__name">{CATEGORY_LABELS.mixed}</span>
            <span className="category-card__meta">All categories, {bank.length} questions</span>
          </button>
        </li>
        {CATEGORIES.map((category) => (
          <li key={category}>
            <button
              className="category-card"
              type="button"
              onClick={() => onStart(category)}
              disabled={counts[category] === 0}
            >
              <span className="category-card__name">{CATEGORY_LABELS[category]}</span>
              <span className="category-card__meta">
                {CATEGORY_BLURBS[category]}, {counts[category]} question{counts[category] === 1 ? '' : 's'}
                {counts[category] > 0 && counts[category] < roundLength && ' (short round)'}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
