/**
 * Question selection for a round.
 *
 * Requirements:
 *  - Mixed rounds are balanced across categories.
 *  - A player should not see a question they have already played while
 *    unplayed ones remain; once they've exhausted the pool, the
 *    LEAST-recently played questions come back first.
 *  - Randomness is injected, so tests are deterministic.
 */

import { CATEGORIES } from './types.ts';
import type { Category, CategorySelection, Question } from './types.ts';

export const DEFAULT_ROUND_LENGTH = 15;

/** A function returning a float in [0, 1). `Math.random` satisfies this. */
export type Rng = () => number;

/** Small, fast, seedable PRNG (mulberry32). NOT for security - only for reproducible tests. */
export function seededRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates. Returns a new array. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** question id -> epoch ms when the player last played it. Absent = never played. */
export type PlayHistory = Readonly<Record<string, number>>;

export interface SelectionOptions {
  bank: readonly Question[];
  selection: CategorySelection;
  count?: number;
  history?: PlayHistory;
  rng?: Rng;
}

export interface SelectionResult {
  questions: Question[];
  /** True when the bank had fewer eligible questions than requested. */
  shortfall: boolean;
  /** How many selected questions the player has already played before. */
  repeats: number;
}

/**
 * Round-robin draw from several queues into `picked` until `count` is reached
 * or every queue is empty. Queue order within a queue is preserved; the order
 * of queues is reshuffled each pass so no category is always drawn first.
 */
function drawRoundRobin(queues: Question[][], picked: Question[], count: number, rng: Rng): void {
  let progressed = true;
  while (picked.length < count && progressed) {
    progressed = false;
    for (const queue of shuffle(queues, rng)) {
      const next = queue.shift();
      if (next) {
        picked.push(next);
        progressed = true;
        if (picked.length === count) return;
      }
    }
  }
}

export function selectQuestions(options: SelectionOptions): SelectionResult {
  const { bank, selection, count = DEFAULT_ROUND_LENGTH, history = {}, rng = Math.random } = options;

  const categories: readonly Category[] = selection === 'mixed' ? CATEGORIES : [selection];
  const pools = categories.map((category) => bank.filter((q) => q.category === category));

  // Freshness beats category balance: we exhaust every category's NEVER-PLAYED
  // questions (balanced among themselves) before we replay anything.
  const freshQueues = pools.map((pool) =>
    shuffle(
      pool.filter((q) => history[q.id] === undefined),
      rng,
    ),
  );
  // Replays: least-recently played first (ties broken by id for determinism).
  const playedQueues = pools.map((pool) =>
    pool
      .filter((q) => history[q.id] !== undefined)
      .sort((a, b) => history[a.id]! - history[b.id]! || a.id.localeCompare(b.id)),
  );

  const picked: Question[] = [];
  drawRoundRobin(freshQueues, picked, count, rng);
  drawRoundRobin(playedQueues, picked, count, rng);

  return {
    questions: shuffle(picked, rng),
    shortfall: picked.length < count,
    repeats: picked.filter((q) => history[q.id] !== undefined).length,
  };
}
