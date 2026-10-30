import type { RarityTier } from '../../domain/types.ts';
import type { Rng } from '../../domain/selection.ts';
import gopichand from '../../assets/creatures/tier-4/gopichand.webp';
import jrNtr from '../../assets/creatures/tier-1/jr-ntr.webp';
import maheshBabu from '../../assets/creatures/tier-1/mahesh-babu.webp';
import nithin from '../../assets/creatures/miss/nithin.webp';
import nani from '../../assets/creatures/tier-2/nani.webp';
import siddhu from '../../assets/creatures/tier-3/siddhu.webp';
import vijayDeverakonda from '../../assets/creatures/tier-3/vijay-deverakonda.webp';
import prabhas from '../../assets/creatures/tier-1/prabhas.webp';
import ramCharan from '../../assets/creatures/tier-1/ram-charan.webp';

/**
 * Sticker art shown on the reveal, per tier. A tier with several stickers picks one at random
 * each time; a tier with none falls back to the pixel creature in `creatures.ts`.
 * Every tier has sticker art now; the pixel creatures in `creatures.ts` remain only as a fallback.
 */
export const TIER_IMAGES: Readonly<Partial<Record<RarityTier, readonly string[]>>> = {
  common: [prabhas, ramCharan, maheshBabu, jrNtr],
  uncommon: [nani],
  rare: [vijayDeverakonda, siddhu],
  legendary: [gopichand],
};

/** Shown when the clock runs out and there is no answer to rate. */
export const MISS_IMAGE: string = nithin;

/** One sticker for the tier, or null when the tier has no sticker art yet. */
export function pickTierImage(tier: RarityTier, rng: Rng = Math.random): string | null {
  const images = TIER_IMAGES[tier];
  if (!images || images.length === 0) return null;
  return images[Math.floor(rng() * images.length)] ?? null;
}
