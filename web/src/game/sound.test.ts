import { afterEach, describe, expect, it } from 'vitest';
import { configureSound, isMuted, MUTE_KEY, play, setMuted, stopSink, unlockAudio } from './sound.ts';
import type { StorageLike } from '../storage/playHistory.ts';

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

afterEach(() => {
  configureSound({ storage: undefined });
});

describe('sound mute', () => {
  it('defaults to unmuted when nothing is stored', () => {
    configureSound({ storage: memoryStorage() });
    expect(isMuted()).toBe(false);
  });

  it('persists mute and unmute', () => {
    const store = memoryStorage();
    configureSound({ storage: store });
    setMuted(true);
    expect(isMuted()).toBe(true);
    expect(store.data[MUTE_KEY]).toBe('1');
    setMuted(false);
    expect(isMuted()).toBe(false);
    expect(store.data[MUTE_KEY]).toBe('0');
  });

  it('treats a missing storage as unmuted', () => {
    configureSound({ storage: null });
    expect(isMuted()).toBe(false);
    setMuted(true);
    expect(isMuted()).toBe(false);
  });
});

describe('play', () => {
  it('does not throw without an AudioContext (jsdom)', () => {
    configureSound({ storage: memoryStorage() });
    expect(() => {
      play('start');
      play('submit');
      play('miss');
      play('timeout');
      play('sink');
      play('tier', { tier: 'legendary' });
      play('descend');
      play('warn');
      play('finish');
      stopSink();
      unlockAudio();
    }).not.toThrow();
  });

  it('is a no-op while muted', () => {
    const store = memoryStorage({ [MUTE_KEY]: '1' });
    configureSound({ storage: store });
    expect(isMuted()).toBe(true);
    expect(() => play('submit')).not.toThrow();
  });
});
