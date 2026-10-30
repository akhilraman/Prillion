import { describe, expect, it } from 'vitest';
import { RARITY_TIERS } from '../../domain/types.ts';
import { MISS_IMAGE, TIER_IMAGES, pickTierImage } from './tierImages.ts';

describe('tier sticker art', () => {
  it('has four different stickers for Tier 1', () => {
    const images = TIER_IMAGES.common ?? [];
    expect(images).toHaveLength(4);
    expect(new Set(images).size).toBe(4);
  });

  it('can pick every Tier 1 sticker, depending only on the random number', () => {
    const images = TIER_IMAGES.common!;
    expect(pickTierImage('common', () => 0)).toBe(images[0]);
    expect(pickTierImage('common', () => 0.3)).toBe(images[1]);
    expect(pickTierImage('common', () => 0.99999)).toBe(images[3]);
  });

  it('has a sticker for Tier 2', () => {
    expect(TIER_IMAGES.uncommon).toHaveLength(1);
    expect(pickTierImage('uncommon', () => 0.7)).toBe(TIER_IMAGES.uncommon![0]);
  });

  it('has two different stickers for Tier 3, picked at random', () => {
    const images = TIER_IMAGES.rare!;
    expect(new Set(images)).toHaveProperty('size', 2);
    expect(pickTierImage('rare', () => 0)).toBe(images[0]);
    expect(pickTierImage('rare', () => 0.9)).toBe(images[1]);
  });

  it('has a sticker for Tier 4 and for a miss', () => {
    expect(TIER_IMAGES.legendary).toHaveLength(1);
    expect(MISS_IMAGE).toBeTruthy();
  });

  it('gives every tier at least one sticker, all different from each other', () => {
    const all = RARITY_TIERS.flatMap((tier) => TIER_IMAGES[tier] ?? []);
    expect(RARITY_TIERS.every((tier) => pickTierImage(tier) !== null)).toBe(true);
    expect(new Set([...all, MISS_IMAGE]).size).toBe(all.length + 1);
  });
});
