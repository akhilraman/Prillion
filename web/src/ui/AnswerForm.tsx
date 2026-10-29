import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { MAX_INPUT_LENGTH } from '../domain/round.ts';

interface AnswerFormProps {
  onSubmit: (text: string) => void;
  /** Attempts the game did not recognise, oldest first. The newest one drives the feedback. */
  misses: readonly string[];
}

export function AnswerForm({ onSubmit, misses }: AnswerFormProps) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const lastMiss = misses[misses.length - 1];

  // Parent remounts this component per question (via `key`), so this runs for every question.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // After a miss, keep the text but select it, so the player can fix a typo or just retype.
  useEffect(() => {
    if (misses.length > 0) inputRef.current?.select();
  }, [misses.length]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    // An empty submit would waste an attempt (e.g. a stray Enter), so ignore it.
    if (text.trim() === '') return;
    onSubmit(text);
  }

  // The message disappears as soon as the player edits the answer it was about.
  const showMiss = lastMiss !== undefined && text === lastMiss;

  return (
    <form className={`answer-form${showMiss ? ' answer-form--miss' : ''}`} onSubmit={handleSubmit}>
      {showMiss && (
        // `key` restarts the entrance animation on every repeated miss.
        <p key={misses.length} className="answer-form__miss" role="status">
          <q>{lastMiss}</q>: no signal. try again
        </p>
      )}
      {/* The placeholder is a hint, not a label: screen readers need the real label. */}
      <label className="visually-hidden" htmlFor="answer">
        Your answer
      </label>
      <input
        id="answer"
        ref={inputRef}
        className="answer-form__input"
        type="text"
        value={text}
        placeholder="your answer…"
        onChange={(e) => setText(e.target.value)}
        maxLength={MAX_INPUT_LENGTH}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="send"
      />
      <button className="button button--primary" type="submit" disabled={text.trim() === ''}>
        Dive
      </button>
    </form>
  );
}
