import { CATEGORIES } from '../domain/types.ts';
import type { Category, CategorySelection } from '../domain/types.ts';
import { DEFAULT_SECONDS_PER_QUESTION } from '../domain/round.ts';
import { play } from '../game/sound.ts';
import { CATEGORY_BLURBS, CATEGORY_LABELS } from './labels.ts';
import { MuteToggle } from './MuteToggle.tsx';

interface HomeScreenProps {
  counts: Record<Category, number>;
  total: number;
  roundLength: number;
  loading?: boolean;
  loadError?: string | null;
  onStart: (selection: CategorySelection) => void;
}

export function HomeScreen({
  counts,
  total,
  roundLength,
  loading = false,
  loadError = null,
  onStart,
}: HomeScreenProps) {
  function begin(selection: CategorySelection) {
    play('start');
    onStart(selection);
  }

  return (
    <main className="screen screen--home">
      <MuteToggle className="mute--home" />
      <header className="home__sky">
        <h1 className="logo">Prillion</h1>
        <p className="home__subtitle">the rare-answer dive</p>
        <p className="home__tagline">
          {roundLength} prompts · {DEFAULT_SECONDS_PER_QUESTION} seconds each · the rarer your answer, the
          deeper you sink
        </p>
      </header>

      <section className="home__deep" aria-labelledby="dive-choice" aria-busy={loading}>
        <h2 id="dive-choice" className="home__choose">
          Choose your dive
        </h2>

        <button
          className="begin"
          type="button"
          onClick={() => begin('mixed')}
          disabled={loading || total === 0}
        >
          <span className="begin__label">
            <span aria-hidden="true">▼ </span>
            {CATEGORY_LABELS.mixed} dive
            <span aria-hidden="true"> ▼</span>
          </span>
          <span className="begin__meta">
            {loading ? 'Loading questions…' : `All categories, ${total} questions`}
          </span>
        </button>

        <ul className="category-grid">
          {CATEGORIES.map((category) => (
            <li key={category}>
              <button
                className="category-card"
                type="button"
                onClick={() => begin(category)}
                disabled={loading || counts[category] === 0}
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

        {loadError && (
          <p className="home__status" role="alert">
            {loadError}
          </p>
        )}

        <p className="home__footer">Any valid answer counts. Less common answers score more.</p>
      </section>
    </main>
  );
}
