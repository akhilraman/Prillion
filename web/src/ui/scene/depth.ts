import type { RoundState } from '../../domain/round.ts';
import { totalPoints } from '../../domain/round.ts';

/** Every point sinks the diver this many metres. Depth is derived from score, never stored. */
export const METRES_PER_POINT = 2;

export function sinkMetres(points: number): number {
  return points * METRES_PER_POINT;
}

/** Total depth so far; includes the answer on screen once it is revealed. */
export function diveMetres(state: RoundState): number {
  return sinkMetres(totalPoints(state));
}
