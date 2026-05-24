import { describe, it, expect } from 'vitest';
import type { Variants } from 'framer-motion';
import { toReducedVariants } from '../useMotion';

describe('toReducedVariants', () => {
  it('strips translate/scale/rotate movement but keeps opacity', () => {
    const full: Variants = {
      hidden: { opacity: 0, y: 12, scale: 0.95, rotate: -4 },
      visible: { opacity: 1, y: 0, scale: 1, rotate: 0 },
    };
    const reduced = toReducedVariants(full);
    expect(reduced.hidden).toMatchObject({ opacity: 0 });
    expect(reduced.hidden).not.toHaveProperty('y');
    expect(reduced.hidden).not.toHaveProperty('scale');
    expect(reduced.hidden).not.toHaveProperty('rotate');
    expect(reduced.visible).toMatchObject({ opacity: 1 });
  });

  it('collapses transitions to an instant tween', () => {
    const full: Variants = {
      show: {
        opacity: 1,
        transition: { type: 'spring', stiffness: 300, damping: 25, duration: 0.4 },
      },
    };
    const reduced = toReducedVariants(full);
    expect(reduced.show.transition).toMatchObject({ type: 'tween', duration: 0 });
  });

  it('removes stagger / delay / repeat timing keys', () => {
    const full: Variants = {
      show: {
        transition: { staggerChildren: 0.05, delayChildren: 0.02, repeat: Infinity, delay: 0.3 },
      },
    };
    const reduced = toReducedVariants(full);
    const t = reduced.show.transition as Record<string, unknown>;
    expect(t).not.toHaveProperty('staggerChildren');
    expect(t).not.toHaveProperty('delayChildren');
    expect(t).not.toHaveProperty('repeat');
    expect(t).not.toHaveProperty('delay');
  });

  it('adds an instant transition when none was specified', () => {
    const full: Variants = { visible: { opacity: 1 } };
    const reduced = toReducedVariants(full);
    expect(reduced.visible.transition).toMatchObject({ type: 'tween', duration: 0 });
  });

  it('collapses keyframe arrays to their final value', () => {
    const full: Variants = { pulse: { opacity: [0.4, 1, 0.4] } };
    const reduced = toReducedVariants(full);
    expect(reduced.pulse.opacity).toBe(0.4);
  });

  it('passes through function-based variant resolvers untouched', () => {
    const resolver = (i: number) => ({ opacity: 1, transition: { delay: i * 0.1 } });
    const full = { visible: resolver } as unknown as Variants;
    const reduced = toReducedVariants(full);
    expect(reduced.visible).toBe(resolver);
  });
});
