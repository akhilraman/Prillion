import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { MAX_INPUT_LENGTH } from '../domain/round.ts';

interface AnswerFormProps {
  onSubmit: (text: string) => void;
}

export function AnswerForm({ onSubmit }: AnswerFormProps) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Parent remounts this component per question (via `key`), so this runs for every question.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    // An empty submit would forfeit the question by accident (e.g. a stray Enter), so ignore it.
    if (text.trim() === '') return;
    onSubmit(text);
  }

  return (
    <form className="answer-form" onSubmit={handleSubmit}>
      <label className="answer-form__label" htmlFor="answer">
        Your answer
      </label>
      <div className="answer-form__row">
        <input
          id="answer"
          ref={inputRef}
          className="answer-form__input"
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={MAX_INPUT_LENGTH}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="send"
        />
        <button className="button button--primary" type="submit" disabled={text.trim() === ''}>
          Submit
        </button>
      </div>
    </form>
  );
}
