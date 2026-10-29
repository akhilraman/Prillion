import { useEffect, useMemo, useRef } from 'react';
import type { QuestionResult } from '../domain/round.ts';
import { scoreQuestionAnswers } from '../domain/scoring.ts';
import type { Question } from '../domain/types.ts';
import { headlineFor, TIER_LABELS } from './labels.ts';

interface RevealPanelProps {
  question: Question;
  result: QuestionResult;
  isLast: boolean;
  onNext: () => void;
}

export function RevealPanel({ question, result, isLast, onNext }: RevealPanelProps) {
  const nextRef = useRef<HTMLButtonElement>(null);

  // Move focus to the continue button so keyboard users can just press Enter again.
  useEffect(() => {
    nextRef.current?.focus();
  }, []);

  const matched = question.answers.find((a) => a.id === result.answerId);
  // Tiers are relative to the question's most popular answer, so score them together.
  const scores = useMemo(() => scoreQuestionAnswers(question), [question]);
  // Most popular first: the list doubles as a "how obvious was your answer?" ranking.
  const ranked = useMemo(
    () => [...question.answers].sort((a, b) => b.familiarity - a.familiarity),
    [question],
  );

  return (
    <section className={`reveal reveal--${result.outcome}`} aria-label="Answer reveal">
      <h2 className="reveal__headline">{headlineFor(result)}</h2>

      {result.input !== '' && (
        <p className="reveal__yours">
          You answered: <q>{result.input}</q>
          {result.matchedVia === 'fuzzy' && matched && <> (counted as {matched.canonical})</>}
        </p>
      )}
      {result.needsReview && (
        <p className="reveal__note">
          We don&apos;t recognise that answer yet. It might be valid but missing from our list.
        </p>
      )}

      <h3 className="reveal__subhead">
        {question.answerSet === 'closed' ? 'All accepted answers' : 'Some accepted answers'}
      </h3>
      <ul className="answer-list">
        {ranked.map((answer) => {
          const tier = scores.get(answer.id)!.tier;
          const isYours = answer.id === result.answerId;
          return (
            <li key={answer.id} className={`answer-list__item${isYours ? ' answer-list__item--yours' : ''}`}>
              <span className="answer-list__name">
                {answer.canonical}
                {isYours && <span className="visually-hidden"> (your answer)</span>}
              </span>
              <span className={`badge badge--${tier}`}>{TIER_LABELS[tier]}</span>
            </li>
          );
        })}
      </ul>

      <p className="reveal__explanation">{question.explanation}</p>

      <p className="reveal__sources">
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

      <button ref={nextRef} className="button button--primary" type="button" onClick={onNext}>
        {isLast ? 'See results' : 'Next question'}
      </button>
    </section>
  );
}
