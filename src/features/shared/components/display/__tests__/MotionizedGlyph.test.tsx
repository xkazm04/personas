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

  describe('motion presets', () => {
    it('defaults to the staggered-draw entrance', () => {
      const { container } = render(<MotionizedGlyph data={DATA} viewBox="0 0 10 10" />);
      // The preset's scale-from value, sourced from motionPresets.ts.
      expect(styleOf(container)).toContain('transform: scale(0.35)');
    });

    it('fade-pop drops the per-path stagger so the glyph reads as one object', () => {
      const { container } = render(
        <MotionizedGlyph data={DATA} viewBox="0 0 10 10" entrance="fade-pop" spread={2} />,
      );
      const delays = [...container.querySelectorAll('path')].map((p) => (p as SVGElement).style.animationDelay);
      expect(new Set(delays)).toEqual(new Set(['0.05s']));
      expect(styleOf(container)).toContain('transform: scale(0.92)');
    });

    it('runs an ambient loop on accent paths only, leaving line-work still', () => {
      const { container } = render(
        <MotionizedGlyph data={DATA} viewBox="0 0 10 10" ambient="pulse" />,
      );
      const looping = [...container.querySelectorAll('path')].filter((p) =>
        /-amb\b/.test(p.getAttribute('class') ?? ''),
      );
      // The two violet accents loop; navy ink and negative space do not.
      expect(looping.map((p) => p.getAttribute('fill'))).toEqual(['#7C3AED', '#7C3AED']);
    });

    it('sequences the loop after the entrance instead of overlapping it', () => {
      const { container } = render(
        <MotionizedGlyph data={DATA} viewBox="0 0 10 10" ambient="pulse" spread={1} />,
      );
      const accent = [...container.querySelectorAll('path')].find((p) =>
        /-amb\b/.test(p.getAttribute('class') ?? ''),
      )!;
      // Entrance stagger first, then the loop's start: last delay (0.08+1) + 0.5s + 0.2s gap.
      expect((accent as SVGElement).style.animationDelay).toBe('0.08s, 1.78s');
    });

    it("fills the loop 'forwards' so its from-state cannot dim the entrance during the delay", () => {
      const { container } = render(
        <MotionizedGlyph data={DATA} viewBox="0 0 10 10" ambient="pulse" />,
      );
      const rule = /-amb \{ animation:[^}]+\}/.exec(styleOf(container))![0];
      expect(rule).toContain('forwards');
      expect(rule).not.toContain('both;');
    });

    it('drops ambient loops entirely under reduced motion', () => {
      const { container } = render(
        <MotionizedGlyph data={DATA} viewBox="0 0 10 10" ambient="float" />,
      );
      const css = styleOf(container);
      const reduced = css.slice(css.indexOf('prefers-reduced-motion'));
      // Both the plain and the looping paths fall back to the shared cross-fade.
      expect(reduced).toContain('-fade 0.45s');
      expect(reduced).not.toContain('translateY');
    });

    it('layers hover as a transition on the wrapper group, not a keyframe animation', () => {
      const { container } = render(
        <MotionizedGlyph data={DATA} viewBox="0 0 10 10" hover="hover-response" />,
      );
      const css = styleOf(container);
      expect(css).toContain('transition: transform 0.18s');
      expect(css).toContain('scale(1.03)');
      // The hover group wraps the replayable run group rather than replacing it.
      expect(container.querySelector('svg > g > g')).toBeTruthy();
    });
  });
});
