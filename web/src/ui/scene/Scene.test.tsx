// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Scene } from './Scene.tsx';

afterEach(cleanup);

describe('Scene', () => {
  it('renders its children outside the decorative layers', () => {
    const { container } = render(
      <Scene metres={0}>
        <p>game content</p>
      </Scene>,
    );

    const layers = container.querySelector('.scene__layers');
    expect(layers).toHaveAttribute('aria-hidden', 'true');
    expect(layers).not.toContainElement(screen.getByText('game content'));
  });

  it('passes the depth to CSS as a custom property', () => {
    const { container } = render(
      <Scene metres={450}>
        <span />
      </Scene>,
    );
    expect(container.querySelector<HTMLElement>('.scene')?.style.getPropertyValue('--metres')).toBe('450');
  });

  it('marks the scene as diving only during a dive (CSS shows the ruler and diver then)', () => {
    const { container, rerender } = render(
      <Scene metres={0}>
        <span />
      </Scene>,
    );
    expect(container.querySelector('.scene')).not.toHaveClass('scene--diving');

    rerender(
      <Scene metres={0} diving>
        <span />
      </Scene>,
    );
    expect(container.querySelector('.scene')).toHaveClass('scene--diving');
  });

  it('places every landmark and ruler tick at a depth', () => {
    const { container } = render(
      <Scene metres={0}>
        <span />
      </Scene>,
    );
    const placed = container.querySelectorAll<HTMLElement>('.landmark, .ruler__tick');
    expect(placed.length).toBeGreaterThan(10);
    for (const el of placed) expect(Number(el.style.getPropertyValue('--at'))).toBeGreaterThanOrEqual(0);
  });
});
