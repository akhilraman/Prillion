import { useEffect, useRef } from 'react';
import type { RoundState } from '../domain/round.ts';
import { totalPoints } from '../domain/round.ts';
import { isAiKnowledge } from '../domain/types.ts';
import { play, stopSink } from '../game/sound.ts';
import type { RoundNotice } from '../game/useRound.ts';
import { AnswerForm } from './AnswerForm.tsx';
import { CATEGORY_LABELS, headlineFor } from './labels.ts';
import { MuteToggle } from './MuteToggle.tsx';
import { RevealStage } from './RevealStage.tsx';
import { SINK_MS, diveMetres, sinkMetres } from './scene/depth.ts';
import { Timer } from './Timer.tsx';
import { useCountUp } from './useCountUp.ts';

interface RoundScreenProps {
  state: Extract<RoundState, { phase: 'answering' | 'revealed' }>;
  notice: RoundNotice | null;
  onSubmit: (text: string) => void;
  onTimeout: () => void;
  onNext: () => void;
  onQuit: () => void;
}

export function RoundScreen({ state, notice, onSubmit, onTimeout, onNext, onQuit }: RoundScreenProps) {
  const descendRef = useRef<HTMLButtonElement>(null);
  const revealed = state.phase === 'revealed';
  const index = state.index;
  const missCount = state.phase === 'answering' ? state.misses.length : 0;
  const lastResult = revealed ? state.results[state.results.length - 1] : undefined;

  // Move focus to the continue button so keyboard users can just press Enter again.
  useEffect(() => {
    if (revealed) descendRef.current?.focus();
  }, [revealed, index]);

  // Cues follow Krillion's beat: miss thud while still answering, then on reveal a
  // submit blip + 3 s whoosh (correct) or a dull timeout; the tier sting lands with the rank.
  useEffect(() => {
    if (state.phase === 'answering') {
      stopSink();
      if (missCount > 0) play('miss', { onceKey: `miss-${index}-${missCount}` });
      return;
    }
    if (!lastResult) return;
    if (lastResult.outcome === 'correct') {
      play('submit', { onceKey: `submit-${index}` });
      play('sink', { onceKey: `sink-${index}` });
      const reduced =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const delay = reduced ? 0 : SINK_MS - 200;
      const t = window.setTimeout(() => {
        play('tier', { tier: lastResult.score?.tier, onceKey: `tier-${index}` });
      }, delay);
      return () => clearTimeout(t);
    }
    play('timeout', { onceKey: `timeout-${index}` });
  }, [revealed, index, missCount, lastResult, state.phase]);

  // Cosmetic: the HUD numbers glide up while the scene scrolls down.
  const depth = useCountUp(diveMetres(state), { durationMs: SINK_MS - 200 });
  const score = useCountUp(totalPoints(state), { durationMs: SINK_MS - 200 });

  const question = state.questions[index];
  if (!question) return null; // unreachable: the reducer guarantees a valid index

  const total = state.questions.length;

  return (
    <main className="screen screen--round">
      <header className="hud">
        <div className="hud__panel hud__panel--depth">
          <span className="hud__label">Depth</span>
          <span className="hud__value">{depth}m</span>
        </div>

        <div className="hud__progress">
          <ol className="segments" aria-hidden="true">
            {state.questions.map((q, i) => {
              const done = state.results[i];
              const stateClass = done
                ? done.outcome === 'correct'
                  ? ' segment--done'
                  : ' segment--missed'
                : i === index
                  ? ' segment--current'
                  : '';
              return <li key={q.id} className={`segment${stateClass}`} />;
            })}
          </ol>
          <span className="hud__label">
            {index + 1}/{total}
          </span>
        </div>

        <div className="hud__panel hud__panel--score">
          <span className="hud__label">Score</span>
          <span className="hud__value">{score}</span>
        </div>
      </header>

      <div className="round-tools">
        <button className="quit" type="button" onClick={onQuit}>
          Quit round
        </button>
        <MuteToggle />
      </div>

      {notice && (notice.shortfall || notice.repeats > 0) && index === 0 && (
        <p className="notice" role="note">
          {notice.shortfall && `Only ${notice.actual} questions are available for this round. `}
          {notice.repeats > 0 &&
            `${notice.repeats} question${notice.repeats === 1 ? ' has' : 's have'} been played before.`}
        </p>
      )}

      {/* After the reveal the prompt slides away; it stays in the DOM so layout does not jump. */}
      <section
        className={`question-card${revealed ? ' question-card--leaving' : ''}`}
        aria-labelledby="prompt"
      >
        <p className="question-card__category">
          {CATEGORY_LABELS[question.category]} · prompt {index + 1} of {total}
        </p>
        {isAiKnowledge(question) && (
          // Honest labelling: this question has no cited source, so say so before the player answers.
          <p className="ai-tag">AI knowledge · not source-checked</p>
        )}
        <h1 id="prompt" className="question-card__prompt">
          {question.prompt}
        </h1>
        <p className="question-card__hint">▼ rarer answers sink deeper ▼</p>
      </section>

      {lastResult && (
        <>
          {lastResult.outcome === 'correct' && (
            // The answer drops out of the prompt as the diver sinks; decorative, the reveal announces it.
            <div className="stamp" aria-hidden="true">
              <q>
                {question.answers.find((a) => a.id === lastResult.answerId)?.canonical ?? lastResult.input}
              </q>{' '}
              ▼
            </div>
          )}
          <RevealStage key={index} question={question} result={lastResult} />
        </>
      )}

      {/* Screen-reader announcement of the outcome; focus moves to the Descend button separately. */}
      <div className="visually-hidden" role="status" aria-live="polite">
        {lastResult ? headlineFor(lastResult, sinkMetres(lastResult.points)) : ''}
      </div>

      <div className="dive-bar">
        <div className="dive-bar__inner">
          {state.phase === 'answering' ? (
            <>
              <Timer
                key={`timer-${index}`}
                deadlineMs={state.deadlineMs}
                totalSeconds={state.secondsPerQuestion}
                onExpire={onTimeout}
              />
              <AnswerForm key={`form-${index}`} onSubmit={onSubmit} misses={state.misses} />
            </>
          ) : (
            <button
              ref={descendRef}
              className={`button button--primary descend${lastResult?.outcome === 'correct' ? '' : ' descend--miss'}`}
              type="button"
              onClick={() => {
                play('descend');
                onNext();
              }}
            >
              {index === total - 1 ? 'See results' : 'Descend'} <span aria-hidden="true">▼</span>
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
