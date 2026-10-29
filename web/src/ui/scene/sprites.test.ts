import { describe, expect, it } from 'vitest';
import * as creatures from './creatures.ts';
import * as sprites from './sprites.ts';
import { defineSprite, spriteToPaths } from './sprites.ts';

const ALL = Object.entries({ ...sprites, ...creatures }).filter(([, v]) => 'rows' in v) as [
  string,
  sprites.Sprite,
][];

describe('sprites', () => {
  it('has the sprites the scene relies on', () => {
    expect(ALL.map(([name]) => name).sort()).toEqual([
      'ANGLERFISH',
      'BOAT',
      'CLOUD',
      'CORAL',
      'DRIFTER',
      'EMPTY_HOOK',
      'FISH_BIG',
      'FISH_SMALL',
      'LEVIATHAN',
      'PUFFERFISH',
      'SEAWEED',
      'STARFISH',
    ]);
  });

  it.each(ALL)('%s only uses colours that are in its palette', (_name, sprite) => {
    for (const row of sprite.rows) {
      for (const ch of row) {
        if (ch !== '.') expect(sprite.palette[ch], `unknown palette key "${ch}"`).toBeDefined();
      }
    }
  });

  it.each(ALL)('%s has equal-width rows and some visible pixels', (_name, sprite) => {
    expect(new Set(sprite.rows.map((r) => r.length))).toEqual(new Set([sprite.width]));
    expect(sprite.rows.some((r) => /[^.]/.test(r))).toBe(true);
  });
});

describe('defineSprite', () => {
  it('pads short rows so authors can omit trailing transparent pixels', () => {
    const s = defineSprite(['a', 'aaa'], { a: 'red' });
    expect(s.width).toBe(3);
    expect(s.rows).toEqual(['a..', 'aaa']);
  });
});

describe('spriteToPaths', () => {
  it('merges horizontal runs and groups by colour', () => {
    const s = defineSprite(['aab.', '.b'], { a: 'red', b: 'blue' });
    expect(spriteToPaths(s)).toEqual([
      { fill: 'red', d: 'M0 0h2v1h-2z' },
      { fill: 'blue', d: 'M2 0h1v1h-1zM1 1h1v1h-1z' },
    ]);
  });

  it('skips transparent pixels entirely', () => {
    expect(spriteToPaths(defineSprite(['...'], { a: 'red' }))).toEqual([]);
  });
});
