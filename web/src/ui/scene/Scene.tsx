import type { CSSProperties, ReactNode } from 'react';
import { PixelSprite } from './PixelSprite.tsx';
import { DRIFTER } from './creatures.ts';
import { BOAT, CLOUD, CORAL, FISH_BIG, FISH_SMALL, SEAWEED } from './sprites.ts';
import type { Sprite } from './sprites.ts';

interface SceneProps {
  /** How deep the diver is. CSS animates changes, so the world scrolls instead of jumping. */
  metres: number;
  /** Show the depth ruler and the diver (during a dive). */
  diving?: boolean;
  children: ReactNode;
}

interface FishSpec {
  sprite: Sprite;
  scale: number;
  /** Vertical position inside the sea, as a % of the viewport height. */
  top: number;
  seconds: number;
  /** Negative delays start each fish part-way across the screen instead of all at the edge. */
  delay: number;
  direction: 'right' | 'left';
}

// Fixed layout (no randomness) so renders are stable and snapshot-friendly.
const FISH: readonly FishSpec[] = [
  { sprite: FISH_BIG, scale: 3, top: 42, seconds: 95, delay: -30, direction: 'right' },
  { sprite: FISH_SMALL, scale: 3, top: 50, seconds: 70, delay: -55, direction: 'left' },
  { sprite: FISH_SMALL, scale: 2, top: 58, seconds: 55, delay: -10, direction: 'right' },
  { sprite: FISH_BIG, scale: 2, top: 66, seconds: 110, delay: -80, direction: 'left' },
  { sprite: FISH_SMALL, scale: 2, top: 74, seconds: 65, delay: -40, direction: 'right' },
  { sprite: FISH_SMALL, scale: 3, top: 84, seconds: 85, delay: -20, direction: 'left' },
];

const CLOUDS = [
  { left: '4%', top: '9%', scale: 5, seconds: 160 },
  { left: '48%', top: '4%', scale: 7, seconds: 220 },
  { left: '78%', top: '16%', scale: 4, seconds: 190 },
] as const;

const BUBBLES = [8, 22, 37, 55, 71, 88] as const;

/** Real depth facts that scroll past as the diver sinks. Purely decorative. */
const LANDMARKS: readonly { at: number; text: string; side: 'left' | 'right' }[] = [
  { at: 40, text: 'recreational scuba limit', side: 'left' },
  { at: 200, text: 'the twilight zone begins', side: 'right' },
  { at: 500, text: 'emperor penguins have dived this deep', side: 'left' },
  { at: 1000, text: 'the midnight zone: no sunlight at all', side: 'right' },
  { at: 2000, text: 'elephant seals reach this deep', side: 'left' },
  { at: 3800, text: 'the Titanic rests down here', side: 'right' },
];

const RULER_STEP = 100;
const RULER_MAX = 7000;
const RULER_TICKS = Array.from({ length: RULER_MAX / RULER_STEP + 1 }, (_, i) => i * RULER_STEP);

/** Positions an element at a depth in metres; CSS does the scrolling (see `.scene`). */
const at = (metres: number): CSSProperties => ({ '--at': metres }) as CSSProperties;

/**
 * The always-mounted ocean behind every screen. It is purely decorative (`aria-hidden`)
 * and driven by one number, `metres`: the sky and boat scroll away, the water darkens,
 * landmarks and the ruler slide past, and coral appears near the bottom.
 */
export function Scene({ metres, diving = false, children }: SceneProps) {
  return (
    <div className={`scene${diving ? ' scene--diving' : ''}`} style={{ '--metres': metres } as CSSProperties}>
      <div className="scene__layers" aria-hidden="true">
        <div className="scene__sea" />
        <div className="scene__rays" />

        {FISH.map((f, i) => (
          <span
            key={i}
            className={`fish fish--${f.direction}`}
            style={{ top: `${f.top}%`, animationDuration: `${f.seconds}s`, animationDelay: `${f.delay}s` }}
          >
            <PixelSprite sprite={f.sprite} scale={f.scale} />
          </span>
        ))}

        {LANDMARKS.map((l) => (
          <div key={l.at} className={`landmark landmark--${l.side}`} style={at(l.at)}>
            <span>{l.text}</span>
          </div>
        ))}

        {BUBBLES.map((left, i) => (
          <span key={left} className="bubble" style={{ left: `${left}%`, animationDelay: `${-i * 2.3}s` }} />
        ))}

        <div className="scene__floor">
          <span className="floor__item floor__item--left">
            <PixelSprite sprite={CORAL} scale={8} />
          </span>
          <span className="floor__item floor__item--seaweed">
            <PixelSprite sprite={SEAWEED} scale={6} />
          </span>
          <span className="floor__item floor__item--right">
            <PixelSprite sprite={CORAL} scale={6} />
          </span>
        </div>

        <span className="avatar">
          <PixelSprite sprite={DRIFTER} scale={4} />
        </span>

        <div className="scene__surface">
          <div className="scene__sky" />
          <div className="scene__sun" />
          {CLOUDS.map((c) => (
            <span
              key={c.left}
              className="cloud"
              style={{ left: c.left, top: c.top, animationDuration: `${c.seconds}s` }}
            >
              <PixelSprite sprite={CLOUD} scale={c.scale} />
            </span>
          ))}
          {/* Waves first, so the boat's hull sits in front of the crests. */}
          <svg className="waves" width="100%" height="18" aria-hidden="true" focusable="false">
            <defs>
              <pattern
                id="wave-tile"
                width="16"
                height="3"
                patternUnits="userSpaceOnUse"
                patternTransform="scale(3)"
              >
                <rect x="4" y="0" width="8" height="1" />
                <rect x="2" y="1" width="12" height="1" />
                <rect x="0" y="2" width="16" height="1" />
              </pattern>
            </defs>
            <rect width="100%" height="9" y="9" fill="url(#wave-tile)" shapeRendering="crispEdges" />
          </svg>
          <span className="boat">
            <PixelSprite sprite={BOAT} scale={5} />
          </span>
        </div>

        <div className="ruler">
          <span className="ruler__line" />
          {RULER_TICKS.map((m) => (
            <span key={m} className="ruler__tick" style={at(m)}>
              {m}m
            </span>
          ))}
          <span className="ruler__you">YOU</span>
        </div>

        <div className="scene__scanlines" />
      </div>

      <div className="scene__content">{children}</div>
    </div>
  );
}
