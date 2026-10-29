// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.tsx';
import type { BankLoad } from './content/loadBank.ts';
import { DEFAULT_SECONDS_PER_QUESTION } from './domain/round.ts';
import { makeBank } from './domain/testFixtures.ts';
import { HISTORY_KEY } from './storage/playHistory.ts';

const questions = makeBank({ tollywood: 4, space: 20, 'us-pop': 4 });
const bank: BankLoad = { ok: true, questions };

/** The fixture's first answer is "alpha" (familiarity 0.25 => common tier, 100 points). */
const CORRECT = 'alpha';

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function currentPrompt(): string {
  return screen.getByRole('heading', { level: 1 }).textContent ?? '';
}

describe('home screen', () => {
  it('offers Mixed and every category with question counts', () => {
    render(<App bank={bank} />);
    expect(screen.getByRole('button', { name: /mixed/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^space/i })).toHaveTextContent('20 questions');
    expect(screen.getByRole('button', { name: /^tollywood/i })).toHaveTextContent('short round');
  });

  it('disables a category with no questions', () => {
    render(<App bank={{ ok: true, questions: questions.filter((q) => q.category !== 'tollywood') }} />);
    expect(screen.getByRole('button', { name: /^tollywood/i })).toBeDisabled();
  });
});

describe('question criteria', () => {
  it('shows "What counts" when a question defines criteria, and nothing when it does not', async () => {
    const user = userEvent.setup();
    const withCriteria = makeBank({ tollywood: 0, space: 1, 'us-pop': 0 }).map((q) => ({
      ...q,
      criteria: 'The hero frees a village from a tyrant.',
    }));
    const { unmount } = render(<App bank={{ ok: true, questions: withCriteria }} />);
    await user.click(screen.getByRole('button', { name: /^space/i }));
    expect(screen.getByText('What counts:')).toBeInTheDocument();
    expect(screen.getByText(/frees a village from a tyrant/)).toBeInTheDocument();
    unmount();

    render(<App bank={{ ok: true, questions: makeBank({ tollywood: 0, space: 1, 'us-pop': 0 }) }} />);
    await user.click(screen.getByRole('button', { name: /^space/i }));
    expect(screen.queryByText('What counts:')).not.toBeInTheDocument();
  });
});

describe('error state', () => {
  it('shows a readable error instead of crashing when the bank is invalid', () => {
    render(<App bank={{ ok: false, message: 'The question bank is invalid.' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('The question bank is invalid.');
  });
});

describe('playing a full round through the UI', () => {
  it('plays 15 questions, scores them, shows results, and persists history', async () => {
    const user = userEvent.setup();
    render(<App bank={bank} />);

    await user.click(screen.getByRole('button', { name: /^space/i }));

    for (let i = 1; i <= 15; i++) {
      // HUD shows progress.
      expect(screen.getByText(`${i}/15`)).toBeInTheDocument();

      // The answer field is focused automatically so the player can just type.
      const input = screen.getByLabelText('Your answer');
      expect(input).toHaveFocus();

      await user.type(input, `${CORRECT}{Enter}`);

      // Reveal: outcome, accepted answers, explanation; focus moves to the continue button.
      expect(
        screen.getByRole('heading', { level: 2, name: /correct! common answer, \+100/i }),
      ).toBeInTheDocument();
      expect(screen.getByText('All accepted answers')).toBeInTheDocument();
      expect(screen.getByText('test explanation')).toBeInTheDocument();
      const nextButton = screen.getByRole('button', { name: i === 15 ? 'See results' : 'Next question' });
      expect(nextButton).toHaveFocus();

      await user.click(nextButton);
    }

    // Results screen.
    expect(screen.getByRole('heading', { level: 1, name: 'Round complete' })).toBeInTheDocument();
    expect(screen.getByText('1500')).toBeInTheDocument();
    expect(screen.getByText('15 of 15 answered correctly')).toBeInTheDocument();

    // History was written for all 15 questions.
    const stored = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '{}') as Record<string, number>;
    expect(Object.keys(stored)).toHaveLength(15);

    // Play again returns home.
    await user.click(screen.getByRole('button', { name: 'Play again' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Prillion' })).toBeInTheDocument();
  });

  it('does not repeat questions in the next round while unplayed ones remain', async () => {
    const user = userEvent.setup();
    render(<App bank={bank} />);

    async function playRound(): Promise<string[]> {
      await user.click(screen.getByRole('button', { name: /^space/i }));
      const prompts: string[] = [];
      for (let i = 1; i <= 15; i++) {
        prompts.push(currentPrompt());
        await user.type(screen.getByLabelText('Your answer'), 'x{Enter}');
        await user.click(screen.getByRole('button', { name: /next question|see results/i }));
      }
      await user.click(screen.getByRole('button', { name: 'Play again' }));
      return prompts;
    }

    const first = await playRound();
    const second = await playRound();
    // 20 space questions: round 1 uses 15, so round 2 can only repeat what it must (10 of 15 played => 5 fresh).
    const repeats = second.filter((p) => first.includes(p));
    expect(repeats).toHaveLength(10);
    // ...and the 5 unplayed questions must all be included.
    const unplayed = questions.filter((q) => q.category === 'space' && !first.includes(q.prompt));
    expect(unplayed).toHaveLength(5);
    for (const q of unplayed) expect(second).toContain(q.prompt);
  });

  it('does not allow submitting an empty answer', async () => {
    const user = userEvent.setup();
    render(<App bank={bank} />);
    await user.click(screen.getByRole('button', { name: /mixed/i }));
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    await user.type(screen.getByLabelText('Your answer'), '   {Enter}');
    // Still answering: no reveal appeared.
    expect(screen.queryByText('All accepted answers')).not.toBeInTheDocument();
  });

  it('marks a wrong answer incorrect and still shows the accepted answers', async () => {
    const user = userEvent.setup();
    render(<App bank={bank} />);
    await user.click(screen.getByRole('button', { name: /^space/i }));
    await user.type(screen.getByLabelText('Your answer'), 'definitely wrong{Enter}');
    expect(screen.getByRole('heading', { level: 2, name: 'Not quite' })).toBeInTheDocument();
    expect(screen.getByText('alpha')).toBeInTheDocument();
  });

  it('quitting returns to the home screen', async () => {
    const user = userEvent.setup();
    render(<App bank={bank} />);
    await user.click(screen.getByRole('button', { name: /mixed/i }));
    await user.click(screen.getByRole('button', { name: 'Quit round' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Prillion' })).toBeInTheDocument();
  });
});

describe('timer', () => {
  it('times out when the deadline passes, with no points', () => {
    vi.useFakeTimers();
    render(<App bank={bank} />);
    fireEvent.click(screen.getByRole('button', { name: /^space/i }));
    expect(screen.getByRole('timer')).toHaveTextContent(`${DEFAULT_SECONDS_PER_QUESTION}s`);

    act(() => {
      vi.advanceTimersByTime((DEFAULT_SECONDS_PER_QUESTION + 1) * 1000);
    });

    expect(screen.getByRole('heading', { level: 2, name: "Time's up" })).toBeInTheDocument();
  });

  it('counts down while answering', () => {
    vi.useFakeTimers();
    render(<App bank={bank} />);
    fireEvent.click(screen.getByRole('button', { name: /^space/i }));
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByRole('timer')).toHaveTextContent('15s');
  });

  it('a late submit after a frozen tab counts as a timeout, not a correct answer', () => {
    // Control the monotonic clock directly. No timers run, which is exactly what a
    // frozen background tab looks like: real time passes, but no callbacks fire.
    // (vi.setSystemTime would NOT work here: it moves Date but not performance.now.)
    let nowMs = 5_000;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => nowMs);

    render(<App bank={bank} />);
    fireEvent.click(screen.getByRole('button', { name: /^space/i }));
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: CORRECT } });

    nowMs += 120_000; // two minutes pass with the tab frozen; the 25s deadline is long gone
    // The player returns and submits before any tick has had a chance to notice.
    fireEvent.submit(screen.getByLabelText('Your answer').closest('form')!);

    expect(screen.getByRole('heading', { level: 2, name: "Time's up" })).toBeInTheDocument();
    expect(screen.queryByText(/correct!/i)).not.toBeInTheDocument();
    clock.mockRestore();
  });

  it('a submit just inside the deadline is still accepted', () => {
    let nowMs = 5_000;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => nowMs);

    render(<App bank={bank} />);
    fireEvent.click(screen.getByRole('button', { name: /^space/i }));
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: CORRECT } });

    nowMs += DEFAULT_SECONDS_PER_QUESTION * 1000 - 1;
    fireEvent.submit(screen.getByLabelText('Your answer').closest('form')!);

    expect(screen.getByRole('heading', { level: 2, name: /correct!/i })).toBeInTheDocument();
    clock.mockRestore();
  });
});
