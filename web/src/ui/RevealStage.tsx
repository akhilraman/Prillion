import { useMemo } from 'react';
import type { QuestionResult } from '../domain/round.ts';
import { scoreQuestionAnswers } from '../domain/scoring.ts';
import { isAiKnowledge } from '../domain/types.ts';
import type { Question } from '../domain/types.ts';
import { NO_CATCH, RANKS, TIER_LABELS } from './labels.ts';
import { CREATURES, EMPTY_HOOK } from './scene/creatures.ts';
import { PixelSprite } from './scene/PixelSprite.tsx';
import { sinkMetres } from './scene/depth.ts';

interface RevealStageProps {
  question: Question;
  result: QuestionResult;
}

/**
 * What the player sees after answering: a glowing creature for the rarity of their answer
 * (or nothing, on a time-out), what they earned, and the full answer list tucked away
 * in a collapsible so it never crowds the moment.
 */
export function RevealStage({ question, result }: RevealStageProps) {
  // Tiers are relative to the question's most popular answer, so score them together.
  const scores = useMemo(() => scoreQuestionAnswers(question), [question]);
  // Most popular first: the list doubles as a "how obvious was your answer?" ranking.
  const ranked = useMemo(
    () => [...question.answers].sort((a, b) => b.familiarity - a.familiarity),
    [question],
  );

  const matched = question.answers.find((a) => a.id === result.answerId);
  const tier = result.outcome === 'correct' && result.score ? result.score.tier : null;
  const rank = tier ? RANKS[tier] : NO_CATCH;

  return (
    <section className={`stage stage--${tier ?? 'miss'}`} aria-label="Answer reveal">
      <div className="stage__creature" aria-hidden="true">
        <PixelSprite sprite={tier ? CREATURES[tier] : EMPTY_HOOK} scale={tier === 'legendary' ? 6 : 8} />
        {tier && (
          <>
            <span className="stage__bubble stage__bubble--1" />
            <span className="stage__bubble stage__bubble--2" />
            <span className="stage__bubble stage__bubble--3" />
          </>
        )}
      </div>

      <h2 className="stage__rank">{rank.name}</h2>

      <p className="stage__answer">
        {matched ? (
          <q>{matched.canonical}</q>
        ) : result.input !== '' ? (
          <q>{result.input}</q>
        ) : (
          <span aria-label="no answer">-</span>
        )}
      </p>
      {matched && result.matchedVia === 'fuzzy' && result.input !== matched.canonical && (
        <p className="stage__note">
          you typed <q>{result.input}</q>
        </p>
      )}

      <p className="stage__points">
        +{result.points} PTS
        {result.points > 0 && <> · sink {sinkMetres(result.points)}m</>}
      </p>
      <p className="stage__flavor">{rank.flavor}</p>

      {result.needsReview && (
        <p className="stage__note">
          We don&apos;t recognise {result.misses.map((m) => `“${m}”`).join(', ')} yet. It might be valid but
          missing from our list.
        </p>
      )}

      <details className="stage__more">
        <summary>
          {question.answerSet === 'closed' ? 'All accepted answers' : 'Some accepted answers'}
        </summary>
        <p className="stage__prompt">{question.prompt}</p>
        <ul className="answer-list">
          {ranked.map((answer) => {
            const answerTier = scores.get(answer.id)!.tier;
            const isYours = answer.id === result.answerId;
            return (
              <li
                key={answer.id}
                className={`answer-list__item${isYours ? ' answer-list__item--yours' : ''}`}
              >
                <span className="answer-list__name">
                  {answer.canonical}
                  {isYours && <span className="visually-hidden"> (your answer)</span>}
                </span>
                <span className={`badge badge--${answerTier}`}>{TIER_LABELS[answerTier]}</span>
              </li>
            );
          })}
        </ul>
        <p className="stage__explanation">{question.explanation}</p>
        {isAiKnowledge(question) ? (
          <p className="stage__sources">
            These answers come from AI knowledge, not a cited source, so a few may be wrong or missing.
          </p>
        ) : (
          <p className="stage__sources">
            Sources:{' '}
            {question.sources.map((source, i) => (
              <span key={source.id}>
                {i > 0 && ', '}
                <a href={source.url} target="_blank" rel="noopener noreferrer">
                  {source.publisher}
                </a>
              </span>
            ))}
          </p>
        )}
      </details>
    </section>
  );
}
