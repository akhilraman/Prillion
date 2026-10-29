/**
 * Play history persisted in localStorage.
 *
 * localStorage is UNTRUSTED input: users can edit it, other versions of the app
 * may have written a different shape, and it can be unavailable or full (private
 * browsing, quota, disabled cookies). So we validate on read and never let a
 * storage failure break the game. History is a nice-to-have (it avoids repeats),
 * not a correctness requirement.
 */

import type { PlayHistory } from '../domain/selection.ts';

/** The subset of the Web Storage API we use. Lets tests pass an in-memory fake. */
export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export const HISTORY_KEY = 'prillion.playHistory.v1';
/** Upper bound so history cannot grow without limit. Oldest entries are dropped first. */
export const MAX_HISTORY_ENTRIES = 2000;

/** Returns localStorage if usable, else null. Accessing it can throw (e.g. blocked cookies). */
export function getBrowserStorage(): StorageLike | null {
  try {
    const storage = globalThis.localStorage;
    // Some browsers expose the object but throw on write (Safari private mode, quota 0).
    const probe = '__prillion_probe__';
    storage.setItem(probe, '1');
    storage.setItem(probe, '');
    return storage;
  } catch {
    return null;
  }
}

/** Parse and validate stored history; anything malformed is ignored rather than trusted. */
export function parseHistory(raw: string | null): PlayHistory {
  if (raw === null) return {};
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return {};

  const out: Record<string, number> = {};
  for (const [id, at] of Object.entries(data)) {
    if (typeof at === 'number' && Number.isFinite(at) && at >= 0) out[id] = at;
  }
  return out;
}

export interface HistoryStore {
  get(): PlayHistory;
  record(questionId: string, atMs: number): void;
}

/**
 * @param validIds Question ids that currently exist. History for questions that
 *   were retired from the bank is discarded so it can't accumulate forever.
 */
export function createHistoryStore(
  storage: StorageLike | null,
  validIds?: ReadonlySet<string>,
): HistoryStore {
  let history: PlayHistory = {};
  if (storage) {
    try {
      history = parseHistory(storage.getItem(HISTORY_KEY));
    } catch {
      history = {};
    }
  }
  if (validIds) {
    history = Object.fromEntries(Object.entries(history).filter(([id]) => validIds.has(id)));
  }

  function persist(): void {
    if (!storage) return;
    try {
      storage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch {
      // Quota exceeded or storage disabled: keep playing, just don't persist.
    }
  }

  return {
    get: () => history,
    record(questionId, atMs) {
      const next: Record<string, number> = { ...history, [questionId]: atMs };
      const entries = Object.entries(next);
      if (entries.length > MAX_HISTORY_ENTRIES) {
        entries.sort((a, b) => b[1] - a[1]); // newest first
        history = Object.fromEntries(entries.slice(0, MAX_HISTORY_ENTRIES));
      } else {
        history = next;
      }
      persist();
    },
  };
}
