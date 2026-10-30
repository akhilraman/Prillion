import { useCallback, useRef, useState } from 'react';
import { indexFromQuestions, loadCategories, loadIndex } from './content/loadBank.ts';
import type { BankIndex, BankLoad } from './content/loadBank.ts';
import { DEFAULT_ROUND_LENGTH } from './domain/selection.ts';
import type { CategorySelection, Question } from './domain/types.ts';
import { useRound } from './game/useRound.ts';
import { ErrorScreen } from './ui/ErrorScreen.tsx';
import { HomeScreen } from './ui/HomeScreen.tsx';
import { ResultsScreen } from './ui/ResultsScreen.tsx';
import { RoundScreen } from './ui/RoundScreen.tsx';
import { diveMetres } from './ui/scene/depth.ts';
import { Scene } from './ui/scene/Scene.tsx';

interface AppProps {
  /** Injectable for tests. Production lazy-loads one category (or all three, for mixed) on start. */
  bank?: BankLoad;
}

export default function App({ bank }: AppProps) {
  if (bank && !bank.ok) {
    return (
      <Scene metres={0}>
        <ErrorScreen message={bank.message} />
      </Scene>
    );
  }

  if (bank?.ok) {
    return <Game index={indexFromQuestions(bank.questions)} injected={bank.questions} />;
  }

  const index = loadIndex();
  if (!index.ok) {
    return (
      <Scene metres={0}>
        <ErrorScreen message={index.message} />
      </Scene>
    );
  }
  return <Game index={index.index} />;
}

/**
 * No router needed: the round's phase IS the screen (idle=home, finished=results).
 * The ocean scene wraps every screen, so it stays mounted and the descent between
 * questions animates instead of resetting.
 */
function Game({ index, injected }: { index: BankIndex; injected?: readonly Question[] }) {
  const { state, notice, start, submit, timeout, next, reset } = useRound(new Set(index.ids));
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const onStart = useCallback(
    (selection: CategorySelection) => {
      if (injected) {
        start(selection, injected);
        return;
      }
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      setLoadError(null);
      void loadCategories(selection).then((result) => {
        loadingRef.current = false;
        setLoading(false);
        if (!result.ok) {
          setLoadError(result.message);
          return;
        }
        start(selection, result.questions);
      });
    },
    [injected, start],
  );

  return (
    <Scene metres={diveMetres(state)} diving={state.phase !== 'idle'}>
      {screenFor()}
    </Scene>
  );

  function screenFor() {
    switch (state.phase) {
      case 'idle':
        return (
          <HomeScreen
            counts={index.counts}
            total={index.ids.length}
            roundLength={DEFAULT_ROUND_LENGTH}
            loading={loading}
            loadError={loadError}
            onStart={onStart}
          />
        );
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
}
