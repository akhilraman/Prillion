import type { RarityTier } from '../../domain/types.ts';
import { defineSprite } from './sprites.ts';
import type { Sprite } from './sprites.ts';

/**
 * The four reveal creatures, one per rarity tier, plus the player's avatar and the miss icon.
 * Drawn to glow: CSS adds a drop-shadow in the tier colour.
 */

export const STARFISH = defineSprite(
  [
    '.....o.....',
    '....ooo....',
    '....oho....',
    'oooooohoooo',
    '.ooooooooo.',
    '..ooooooo..',
    '..ooooooo..',
    '.ooo...ooo.',
    'ddd.....ddd',
    'dd.......dd',
  ],
  { o: '#f2a35a', h: '#ffe0b8', d: '#d6783a' },
);

export const PUFFERFISH = defineSprite(
  [
    '....s..s..s...',
    '..yyyyyyyyyy..',
    '.yyyyyyyyyyyy.',
    'syyyyyyyyeyyys',
    'fyyyyyyyyyyyyy',
    'ffyywwwwwwwyym',
    '.fyywwwwwwwyy.',
    '..yyywwwwwyy..',
    '...yyyyyyyy...',
    '....s..s..s...',
  ],
  { y: '#c4e866', w: '#f6ffd0', s: '#7fa83a', f: '#98c94a', e: '#06162b', m: '#e57a52' },
);

export const ANGLERFISH = defineSprite(
  [
    '..............sssslll',
    '.............s.....lll',
    '............s........',
    '...........s.........',
    '.....pppppppppp......',
    '...pppppppppppppp....',
    '..pppppppppppppppeep.',
    '.ppppppppppppppppekep',
    'pppppppppppppppppppppp',
    'pppppppppppptptptptpp.',
    '.pppppppppppp........',
    '..pppppppppptptptpt..',
    '.ff.pppppppppppppp...',
    'fff...pppppp.........',
  ],
  { p: '#6b4fa8', s: '#8d73c9', l: '#ffe27a', e: '#fff3c2', k: '#2b1d52', t: '#f4f0ff', f: '#523a8a' },
);

export const LEVIATHAN = defineSprite(
  [
    'ff..................................',
    'fff...........dddddddddd.............',
    '.fff.......dddddddddddddddd..........',
    '..ff....ddddddddddddddddddddd........',
    '...ffddddddddddddddddddddddddddd.....',
    '....bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb...',
    '....bbbbbbbbbbbbbbbbbbbbbbbbbbbbebb..',
    '.....bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    '......bbgbgbgbgbgbgbgbgbgbgbgbgbbbbb.',
    '........wwwwwwwwwwwwwwwwwwwwwwwwwww..',
    '.........wwwwwwwwwwwwwwwwwwwwwwww....',
    '............wwwwwwwwwwwwwwww..ff.....',
    '...............................ff....',
  ],
  { d: '#4a3a96', b: '#7a62d6', w: '#cdbfff', f: '#9d86ee', g: '#ffd166', e: '#fff3c2' },
);

/** The player's avatar: a small glowing jellyfish that sinks with every answer. */
export const DRIFTER = defineSprite(
  ['..ppppp..', '.pppwpppp', 'ppppppppp', 'ppppppppp', '.p.p.p.p.', '.p..p..p.', '..p.p.p..', '.p..p...p'],
  { p: '#ff5c8a', w: '#ffd3df' },
);

/** Shown when a question ends with no answer: the line came up empty. */
export const EMPTY_HOOK = defineSprite(
  [
    '....l....',
    '....l....',
    '....l....',
    '....l....',
    '....l....',
    '....l....',
    '....h....',
    '....h....',
    '....h....',
    'b...h....',
    'hh..h....',
    '.hhhh....',
  ],
  { l: '#8aa2b4', h: '#c9d7e2', b: '#c9d7e2' },
);

/** Which creature greets a correct answer of each rarity tier. */
export const CREATURES: Readonly<Record<RarityTier, Sprite>> = {
  common: STARFISH,
  uncommon: PUFFERFISH,
  rare: ANGLERFISH,
  legendary: LEVIATHAN,
};
