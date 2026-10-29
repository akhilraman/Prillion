/**
 * Pixel art, drawn in code. Each sprite is a grid of characters: '.' is transparent and
 * every other character is a key into the sprite's palette. Keeping art as text means it
 * is reviewable in a diff, needs no image files, and stays crisp at any scale.
 */

export interface Sprite {
  readonly width: number;
  readonly height: number;
  /** Rows padded with transparent pixels to `width`. */
  readonly rows: readonly string[];
  /** Character -> CSS colour. `currentColor` lets CSS recolour a sprite (e.g. silhouettes). */
  readonly palette: Readonly<Record<string, string>>;
}

/** Trailing '.' may be omitted when authoring; rows are padded to the widest row. */
export function defineSprite(rows: readonly string[], palette: Record<string, string>): Sprite {
  const width = Math.max(...rows.map((r) => r.length));
  return { width, height: rows.length, rows: rows.map((r) => r.padEnd(width, '.')), palette };
}

/** One SVG path per colour: horizontal runs of equal pixels become single rectangles. */
export function spriteToPaths(sprite: Sprite): { fill: string; d: string }[] {
  const byColour = new Map<string, string[]>();
  sprite.rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const key = row[x]!;
      let end = x + 1;
      while (end < row.length && row[end] === key) end++;
      const fill = key === '.' ? undefined : sprite.palette[key];
      if (fill !== undefined) {
        const parts = byColour.get(fill) ?? [];
        parts.push(`M${x} ${y}h${end - x}v1h-${end - x}z`);
        byColour.set(fill, parts);
      }
      x = end;
    }
  });
  return [...byColour].map(([fill, parts]) => ({ fill, d: parts.join('') }));
}

export const BOAT = defineSprite(
  [
    '..........ffff',
    '..........fffff',
    '..........ffff',
    '..........d',
    '..........d',
    '..........d',
    '.......ddddddd',
    '.......dwwddww',
    '.......ddddddd',
    'dddddddddddddddddddddddddd',
    '.dddddddddddddddddddddddd',
    '..dddddddddddddddddddddd',
    '....dddddddddddddddddd',
  ],
  { d: '#0b1b33', f: '#ff5c8a', w: '#4fd3e8' },
);

export const CLOUD = defineSprite(
  [
    '..........wwwww',
    '......wwwwwwwwwwww',
    '....wwwwwwwwwwwwwwwwww',
    '..wwwwwwwwwwwwwwwwwwwwww',
    'wwwwwwwwwwwwwwwwwwwwwwwwww',
    'ssswwwwwwwwwwwwwwwwwwwwsss',
    '.ssssssssssssssssssssss',
  ],
  { w: '#ffffff', s: '#bcdcf0' },
);

/** Faces right; flip with CSS for the other direction. Recoloured via `color`. */
export const FISH_SMALL = defineSprite(
  ['....dddd', 'd..dddddddd', 'dddddddddddd', 'd..dddddddd', '....dddd'],
  { d: 'currentColor' },
);

export const FISH_BIG = defineSprite(
  [
    '......dddd',
    '..d..dddddddd',
    'dddddddddddddddd',
    'dddddddddddddddddd',
    'dddddddddddddddd',
    '..d..dddddddd',
    '......dddd',
  ],
  { d: 'currentColor' },
);

export const CORAL = defineSprite(
  [
    '.d.......d...d',
    '.d......dd...d',
    '.dd.....d...dd',
    '..d..d..d..dd',
    '..dd.dd.dddd',
    '...dddddddd',
    '....dddddd',
    '....dddddd',
    '...dddddddd',
    '..dddddddddd',
    '.dddddddddddd',
  ],
  { d: 'currentColor' },
);

export const SEAWEED = defineSprite(
  ['d', 'dd', '.d', '.d', 'dd', 'd', 'd', 'dd', '.d', '.d', 'dd', 'd', 'd', 'dd', '.d'],
  { d: 'currentColor' },
);
