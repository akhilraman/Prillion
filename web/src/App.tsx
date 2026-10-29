import { loadBank } from './content/loadBank.ts';
import type { BankLoad } from './content/loadBank.ts';
import { DEFAULT_ROUND_LENGTH } from './domain/selection.ts';
import type { Question } from './domain/types.ts';
import { useRound } from './game/useRound.ts';
import { ErrorScreen } from './ui/ErrorScreen.tsx';
import { HomeScreen } from './ui/HomeScreen.tsx';
import { ResultsScreen } from './ui/ResultsScreen.tsx';
import { RoundScreen } from './ui/RoundScreen.tsx';

// Validated once at module load. `loadBank` never throws; failures become an error screen.
const defaultBank: BankLoad = loadBank();

interface AppProps {
  /** Injectable for tests. Production uses the bundled seed bank. */
  bank?: BankLoad;
}

export default function App({ bank = defaultBank }: AppProps) {
  if (!bank.ok) return <ErrorScreen message={bank.message} />;
  return <Game questions={bank.questions} />;
}

/** No router needed: the round's phase IS the screen (idle=home, finished=results). */
function Game({ questions }: { questions: readonly Question[] }) {
  const { state, notice, start, submit, timeout, next, reset } = useRound(questions);

  switch (state.phase) {
    case 'idle':
      return <HomeScreen bank={questions} roundLength={DEFAULT_ROUND_LENGTH} onStart={start} />;
    case 'answering':
    case 'revealed':
      return (
        <RoundScreen
          state={state}
          notice={notice}
          onSubmit={submit}
          onTimeout={timeout}
          onNext={next}
          onQuit={reset}
        />
      );
    case 'finished':
      return <ResultsScreen state={state} onPlayAgain={reset} />;
  }
}
