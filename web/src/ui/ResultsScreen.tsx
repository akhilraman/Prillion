import { useEffect, useRef } from 'react';
import type { RoundState } from '../domain/round.ts';
import { tierCounts, totalPoints } from '../domain/round.ts';
import { RARITY_TIERS } from '../domain/types.ts';
import { play } from '../game/sound.ts';
import { TIER_LABELS } from './labels.ts';
import { MuteToggle } from './MuteToggle.tsx';

interface ResultsScreenProps {
  state: Extract<RoundState, { phase: 'finished' }>;
  onPlayAgain: () => void;
}

const OUTCOME_LABEL = { correct: 'Correct', timeout: 'Timed out' } as const;

export function ResultsScreen({ state, onPlayAgain }: ResultsScreenProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
    play('finish', { onceKey: 'finish' });
  }, []);

  const counts = tierCounts(state.results);
  const correct = state.results.filter((r) => r.outcome === 'correct').length;
  const byId = new Map(state.questions.map((q) => [q.id, q]));

  return (
    <main className="screen screen--results">
      <MuteToggle className="mute--home" />
      <h1 ref={headingRef} tabIndex={-1} className="title title--small">
        Round complete
      </h1>
      <p className="results__score">
        <span className="results__points">{totalPoints(state)}</span> points
      </p>
      <p className="results__summary">
        {correct} of {state.questions.length} answered correctly
      </p>

      <ul className="tier-summary">
        {RARITY_TIERS.map((tier) => (
          <li key={tier} className="tier-summary__item">
            <span className={`badge badge--${tier}`}>{TIER_LABELS[tier]}</span>
            <span className="tier-summary__count">{counts[tier]}</span>
          </li>
        ))}
      </ul>

      <h2 className="section-title">Your answers</h2>
      <ol className="review-list">
        {state.results.map((result) => {
          const question = byId.get(result.questionId);
          const matched = question?.answers.find((a) => a.id === result.answerId);
          return (
            <li key={result.questionId} className={`review-list__item review-list__item--${result.outcome}`}>
              <p className="review-list__prompt">{question?.prompt}</p>
              <p className="review-list__answer">
                {OUTCOME_LABEL[result.outcome]}
                {result.input !== '' && <>: {result.input}</>}
                {matched && result.input !== matched.canonical && <> ({matched.canonical})</>}
                {result.score && (
                  <>
                    {' '}
                    <span className={`badge badge--${result.score.tier}`}>
                      {TIER_LABELS[result.score.tier]}
                    </span>
                  </>
                )}
                <span className="review-list__points"> +{result.points}</span>
              </p>
            </li>
          );
        })}
      </ol>

      <button className="button button--primary" type="button" onClick={onPlayAgain}>
        Play again
      </button>
    </main>
  );
}
