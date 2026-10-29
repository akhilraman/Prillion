import { describe, expect, it } from 'vitest';
import {
  createHistoryStore,
  HISTORY_KEY,
  MAX_HISTORY_ENTRIES,
  parseHistory,
  type StorageLike,
} from './playHistory.ts';

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

describe('parseHistory', () => {
  it('returns empty for null, invalid JSON and wrong shapes', () => {
    expect(parseHistory(null)).toEqual({});
    expect(parseHistory('{not json')).toEqual({});
    expect(parseHistory('[1,2,3]')).toEqual({});
    expect(parseHistory('"str"')).toEqual({});
    expect(parseHistory('null')).toEqual({});
  });

  it('keeps valid entries and drops invalid values', () => {
    const raw = JSON.stringify({ a: 100, b: 'x', c: -5, d: null, e: 0 });
    expect(parseHistory(raw)).toEqual({ a: 100, e: 0 });
  });
});

describe('createHistoryStore', () => {
  it('starts empty with no storage and still records in memory', () => {
    const store = createHistoryStore(null);
    expect(store.get()).toEqual({});
    store.record('q1', 10);
    expect(store.get()).toEqual({ q1: 10 });
  });

  it('persists records and reloads them in a new store', () => {
    const storage = memoryStorage();
    createHistoryStore(storage).record('q1', 123);
    expect(JSON.parse(storage.data[HISTORY_KEY]!)).toEqual({ q1: 123 });
    expect(createHistoryStore(storage).get()).toEqual({ q1: 123 });
  });

  it('overwrites the timestamp when a question is played again', () => {
    const store = createHistoryStore(memoryStorage());
    store.record('q1', 1);
    store.record('q1', 2);
    expect(store.get()).toEqual({ q1: 2 });
  });

  it('survives corrupt stored data', () => {
    const store = createHistoryStore(memoryStorage({ [HISTORY_KEY]: '{{{{' }));
    expect(store.get()).toEqual({});
  });

  it('discards history for questions no longer in the bank', () => {
    const storage = memoryStorage({ [HISTORY_KEY]: JSON.stringify({ keep: 1, retired: 2 }) });
    expect(createHistoryStore(storage, new Set(['keep'])).get()).toEqual({ keep: 1 });
  });

  it('does not throw when storage writes fail (quota / disabled)', () => {
    const failing: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const store = createHistoryStore(failing);
    expect(() => store.record('q1', 5)).not.toThrow();
    expect(store.get()).toEqual({ q1: 5 });
  });

  it('does not throw when storage reads fail', () => {
    const failing: StorageLike = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {},
    };
    expect(createHistoryStore(failing).get()).toEqual({});
  });

  it('caps history size, dropping the oldest entries', () => {
    const store = createHistoryStore(null);
    for (let i = 0; i < MAX_HISTORY_ENTRIES + 5; i++) store.record(`q${i}`, i);
    const ids = Object.keys(store.get());
    expect(ids).toHaveLength(MAX_HISTORY_ENTRIES);
    expect(ids).not.toContain('q0');
    expect(ids).toContain(`q${MAX_HISTORY_ENTRIES + 4}`);
  });
});
