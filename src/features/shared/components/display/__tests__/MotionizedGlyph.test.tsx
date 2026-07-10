import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MotionizedGlyph, type GlyphElement } from '../MotionizedGlyph';

// A navy ink path, a violet accent, and a negative-space path — the three fill
// classes the tracer emits (see .claude/skills/motionize).
const DATA: GlyphElement[] = [
  { d: 'M0 0h10v10H0z', fill: '#0F1347', delay: 1 },
  { d: 'M2 2h6v6H2z', fill: '#7C3AED', delay: 0 },
  { d: 'M4 4h2v2H4z', fill: 'var(--background)', delay: 0.5 },
  { d: 'M1 1h1v1H1z', fill: '#7C3AED', delay: 0.25 }, // repeat colour → one rule, not two
];

const styleOf = (c: HTMLElement) => c.querySelector('style')!.textContent!;

describe('MotionizedGlyph', () => {
  it('renders one path per element, preserving paint order and fill', () => {
    const { container } = render(<MotionizedGlyph data={DATA} viewBox="0 0 10 10" />);
    const paths = [...container.querySelectorAll('path')];
    expect(paths.map((p) => p.getAttribute('fill'))).toEqual([
      '#0F1347',
      '#7C3AED',
      'var(--background)',
      '#7C3AED',
    ]);
  });

  it('staggers the reveal by each element delay', () => {
    const { container } = render(<MotionizedGlyph data={DATA} viewBox="0 0 10 10" spread={2} />);
    const delays = [...container.querySelectorAll('path')].map((p) => (p as SVGElement).style.animationDelay);
    // 0.08s base + delay * spread
    expect(delays).toEqual(['2.08s', '0.08s', '1.08s', '0.58s']);
  });

  it('emits a light-theme fill override per distinct colour, not per path', () => {
    const { container } = render(<MotionizedGlyph data={DATA} viewBox="0 0 10 10" />);
    const rules = styleOf(container).match(/\[data-theme\^="light"\]/g) ?? [];
    expect(rules).toHaveLength(2); // navy + violet; the duplicate violet reuses its rule
  });

  it('lifts dark ink toward slate and deepens neon accents for the light surface', () => {
    const { container } = render(<MotionizedGlyph data={DATA} viewBox="0 0 10 10" />);
    const css = styleOf(container);
    expect(css).toContain('fill: #1c1e40'); // #0F1347 ink → slate (would vanish on light otherwise)
    expect(css).toContain('fill: #6b32cc'); // #7C3AED neon → deepened ~14%
  });

  it('never overrides negative space — var(--background) follows the theme itself', () => {
    const { container } = render(<MotionizedGlyph data={DATA} viewBox="0 0 10 10" />);
    expect(styleOf(container)).not.toContain('var(--background)');
  });

  it('applies the emissive glow filter to bright accents only', () => {
    const { container } = render(<MotionizedGlyph data={DATA} viewBox="0 0 10 10" glow />);
    const filtered = [...container.querySelectorAll('path')].map((p) => p.getAttribute('filter'));
    expect(filtered.filter(Boolean)).toHaveLength(2); // the two violet paths, not the navy ink
    expect(container.querySelector('filter feGaussianBlur')).toBeTruthy();
  });
});
