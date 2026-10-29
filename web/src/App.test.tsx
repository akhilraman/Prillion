// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.tsx';
import type { BankLoad } from './content/loadBank.ts';
import { DEFAULT_SECONDS_PER_QUESTION } from './domain/round.ts';
import { DEFAULT_ROUND_LENGTH as N } from './domain/selection.ts';
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
  it('plays a full dive, scores it, shows results, and persists history', async () => {
    const user = userEvent.setup();
    render(<App bank={bank} />);

    await user.click(screen.getByRole('button', { name: /^space/i }));

    for (let i = 1; i <= N; i++) {
      // HUD shows progress.
      expect(screen.getByText(`${i}/${N}`)).toBeInTheDocument();

      // The answer field is focused automatically so the player can just type.
      const input = screen.getByLabelText('Your answer');
      expect(input).toHaveFocus();

      await user.type(input, `${CORRECT}{Enter}`);

      // Reveal: rank for the answer's rarity, points, accepted answers, explanation.
      // Focus moves to the continue button so Enter keeps the dive going.
      expect(screen.getByRole('heading', { level: 2, name: 'Starfish' })).toBeInTheDocument();
      expect(screen.getByText('+100 PTS · sink 200m')).toBeInTheDocument();
      expect(screen.getByText('All accepted answers')).toBeInTheDocument();
      expect(screen.getByText('test explanation')).toBeInTheDocument();
      const nextButton = screen.getByRole('button', { name: i === N ? 'See results' : 'Descend' });
      expect(nextButton).toHaveFocus();

      await user.click(nextButton);
    }

    // Results screen.
    expect(screen.getByRole('heading', { level: 1, name: 'Round complete' })).toBeInTheDocument();
    expect(screen.getByText(String(N * 100))).toBeInTheDocument();
    expect(screen.getByText(`${N} of ${N} answered correctly`)).toBeInTheDocument();

    // History was written for every question in the dive.
    const stored = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '{}') as Record<string, number>;
    expect(Object.keys(stored)).toHaveLength(N);

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
      for (let i = 1; i <= N; i++) {
        prompts.push(currentPrompt());
        await user.type(screen.getByLabelText('Your answer'), `${CORRECT}{Enter}`);
        await user.click(screen.getByRole('button', { name: /descend|see results/i }));
      }
      await user.click(screen.getByRole('button', { name: 'Play again' }));
      return prompts;
    }

    // 20 space questions, dives of N = 7.
    const first = await playRound();
    const second = await playRound();
    // Round 2: 13 unplayed remain, so nothing has to repeat.
    expect(second.filter((p) => first.includes(p))).toHaveLength(0);

    // Round 3: only 6 unplayed remain. All 6 must be included, plus exactly one replay.
    const third = await playRound();
    const played = [...first, ...second];
    const unplayed = questions.filter((q) => q.category === 'space' && !played.includes(q.prompt));
    expect(unplayed).toHaveLength(20 - 2 * N);
    for (const q of unplayed) expect(third).toContain(q.prompt);
    expect(third.filter((p) => played.includes(p))).toHaveLength(N - unplayed.length);
  });

  it('does not allow submitting an empty answer', async () => {
    const user = userEvent.setup();
    render(<App bank={bank} />);
    await user.click(screen.getByRole('button', { name: /mixed/i }));
    expect(screen.getByRole('button', { name: 'Dive' })).toBeDisabled();
    await user.type(screen.getByLabelText('Your answer'), '   {Enter}');
    // Still answering: no reveal appeared.
    expect(screen.queryByText('All accepted answers')).not.toBeInTheDocument();
  });

  it('keeps the player on the question after a wrong answer, with the text kept and a message', async () => {
    const user = userEvent.setup();
    render(<App bank={bank} />);
    await user.click(screen.getByRole('button', { name: /^space/i }));

    const input = screen.getByLabelText('Your answer');
    await user.type(input, 'definitely wrong{Enter}');

    // Nothing was revealed: same question, clock still running, text still there.
    expect(screen.getByText(/no signal/)).toHaveTextContent('definitely wrong: no signal. try again');
    expect(screen.queryByText('All accepted answers')).not.toBeInTheDocument();
    expect(screen.getByRole('timer')).toBeInTheDocument();
    expect(input).toHaveValue('definitely wrong');

    // Editing the text clears the message; a correct retry then scores normally.
    await user.clear(input);
    expect(screen.queryByText(/no signal/)).not.toBeInTheDocument();
    await user.type(input, `${CORRECT}{Enter}`);
    expect(screen.getByRole('heading', { level: 2, name: 'Starfish' })).toBeInTheDocument();
  });

  it('allows several wrong attempts before the right one', async () => {
    const user = userEvent.setup();
    render(<App bank={bank} />);
    await user.click(screen.getByRole('button', { name: /^space/i }));

    const input = screen.getByLabelText('Your answer');
    await user.type(input, 'nope{Enter}');
    await user.clear(input);
    await user.type(input, 'still no{Enter}');
    expect(screen.getByText(/no signal/)).toHaveTextContent('still no: no signal. try again');
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

    expect(screen.getByRole('heading', { level: 2, name: 'Empty Hook' })).toBeInTheDocument();
    expect(screen.getByText('+0 PTS')).toBeInTheDocument();
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

    expect(screen.getByRole('heading', { level: 2, name: 'Empty Hook' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Starfish' })).not.toBeInTheDocument();
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

    expect(screen.getByRole('heading', { level: 2, name: 'Starfish' })).toBeInTheDocument();
    clock.mockRestore();
  });
});
