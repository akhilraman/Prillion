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
      <header className="home__sky">
        <h1 className="logo">Prillion</h1>
        <p className="home__subtitle">the rare-answer dive</p>
        <p className="home__tagline">
          {roundLength} prompts · {DEFAULT_SECONDS_PER_QUESTION} seconds each · the rarer your answer, the
          deeper you sink
        </p>
      </header>

      <section className="home__deep" aria-labelledby="dive-choice">
        <h2 id="dive-choice" className="home__choose">
          Choose your dive
        </h2>

        <button className="begin" type="button" onClick={() => onStart('mixed')}>
          <span className="begin__label">
            <span aria-hidden="true">▼ </span>
            {CATEGORY_LABELS.mixed} dive
            <span aria-hidden="true"> ▼</span>
          </span>
          <span className="begin__meta">All categories, {bank.length} questions</span>
        </button>

        <ul className="category-grid">
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

        <p className="home__footer">Any valid answer counts. Less common answers score more.</p>
      </section>
    </main>
  );
}
