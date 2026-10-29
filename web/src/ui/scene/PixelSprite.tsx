import { useMemo } from 'react';
import { spriteToPaths } from './sprites.ts';
import type { Sprite } from './sprites.ts';

interface PixelSpriteProps {
  sprite: Sprite;
  /** Screen pixels per sprite pixel. */
  scale: number;
  className?: string;
}

/** Decorative: hidden from assistive tech. `crispEdges` keeps pixel edges hard. */
export function PixelSprite({ sprite, scale, className }: PixelSpriteProps) {
  const paths = useMemo(() => spriteToPaths(sprite), [sprite]);
  return (
    <svg
      className={className}
      viewBox={`0 0 ${sprite.width} ${sprite.height}`}
      width={sprite.width * scale}
      height={sprite.height * scale}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {paths.map((p) => (
        <path key={p.fill} fill={p.fill} d={p.d} />
      ))}
    </svg>
  );
}
