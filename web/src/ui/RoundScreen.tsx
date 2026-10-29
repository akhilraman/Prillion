import type { RoundState } from '../domain/round.ts';
import { totalPoints } from '../domain/round.ts';
import type { RoundNotice } from '../game/useRound.ts';
import { AnswerForm } from './AnswerForm.tsx';
import { CATEGORY_LABELS, headlineFor, METRES_PER_QUESTION } from './labels.ts';
import { RevealPanel } from './RevealPanel.tsx';
import { Timer } from './Timer.tsx';

interface RoundScreenProps {
  state: Extract<RoundState, { phase: 'answering' | 'revealed' }>;
  notice: RoundNotice | null;
  onSubmit: (text: string) => void;
  onTimeout: () => void;
  onNext: () => void;
  onQuit: () => void;
}

export function RoundScreen({ state, notice, onSubmit, onTimeout, onNext, onQuit }: RoundScreenProps) {
  const question = state.questions[state.index];
  if (!question) return null; // unreachable: the reducer guarantees a valid index

  const total = state.questions.length;
  const depth = state.index * METRES_PER_QUESTION;
  // 0 at the surface .. 1 at the deepest question; drives the background colour.
  const depthFraction = total > 1 ? state.index / (total - 1) : 0;

  const lastResult = state.phase === 'revealed' ? state.results[state.results.length - 1] : undefined;

  return (
    <main className="screen screen--round" style={{ ['--depth' as string]: depthFraction }}>
      <header className="hud">
        <div className="hud__item">
          <span className="hud__label">Question</span>
          <span className="hud__value">
            {state.index + 1}/{total}
          </span>
        </div>
        <div className="hud__item">
          <span className="hud__label">Depth</span>
          <span className="hud__value">{depth} m</span>
        </div>
        <div className="hud__item">
          <span className="hud__label">Score</span>
          <span className="hud__value">{totalPoints(state)}</span>
        </div>
        {state.phase === 'answering' ? (
          <Timer
            key={state.index}
            deadlineMs={state.deadlineMs}
            totalSeconds={state.secondsPerQuestion}
            onExpire={onTimeout}
          />
        ) : (
          <div className="timer timer--idle" aria-hidden="true" />
        )}
      </header>

      {notice && (notice.shortfall || notice.repeats > 0) && state.index === 0 && (
        <p className="notice" role="note">
          {notice.shortfall && `Only ${notice.actual} questions are available for this round. `}
          {notice.repeats > 0 &&
            `${notice.repeats} question${notice.repeats === 1 ? ' has' : 's have'} been played before.`}
        </p>
      )}

      <section className="question-card" aria-labelledby="prompt">
        <p className="question-card__category">{CATEGORY_LABELS[question.category]}</p>
        <h1 id="prompt" className="question-card__prompt">
          {question.prompt}
        </h1>
        {question.criteria && (
          <p className="question-card__criteria">
            <strong>What counts:</strong> {question.criteria}
          </p>
        )}

        {state.phase === 'answering' ? (
          <AnswerForm key={state.index} onSubmit={onSubmit} />
        ) : (
          lastResult && (
            <RevealPanel
              key={state.index}
              question={question}
              result={lastResult}
              isLast={state.index === total - 1}
              onNext={onNext}
            />
          )
        )}
      </section>

      {/* Screen-reader announcement of the outcome; focus moves to the Next button separately. */}
      <div className="visually-hidden" role="status" aria-live="polite">
        {lastResult ? headlineFor(lastResult) : ''}
      </div>

      <button className="button button--ghost quit" type="button" onClick={onQuit}>
        Quit round
      </button>
    </main>
  );
}
