import { describe, expect, it } from 'vitest';
import type { OverlayEnter } from '@/lib/bindings/OverlayEnter';
import { enterOffset } from '../renderPlanHelpers';

// Pins `enterOffset`'s per-tick easing math against the same three curves
// implemented in the ffmpeg `overlay_pos_expr` filter-graph builder
// (src-tauri/src/commands/artist/ffmpeg.rs, `mod tests`:
// `overlay_pos_expr_entrance_is_time_varying_and_eased` /
// `overlay_pos_expr_easeinout_uses_cosine`). Both sides derive progress as
// `clamp(localTime / duration, 0, 1)` and share the identical easeOut
// (`1 - (1-p)^2`) and easeInOut (`(1 - cos(pi*p)) / 2`) formulas — this is
// the one instance in this module of per-tick evaluation the render-plan IR
// doctrine (docs/concepts/media-studio-renderplan.md) explicitly allows the
// client to duplicate rather than round-trip over IPC, so the fixture below
// (not a shared IR) is what keeps the two curves from silently drifting.
describe('enterOffset', () => {
  const base = (overrides: Partial<OverlayEnter>): OverlayEnter => ({
    duration: 0.4,
    offsetX: 0,
    offsetY: 0.15,
    easing: 'easeOut',
    ...overrides,
  });

  it('returns zero offset when there is no entrance', () => {
    expect(enterOffset(null, 0)).toEqual({ dx: 0, dy: 0 });
  });

  it('returns zero offset when duration is non-positive', () => {
    expect(enterOffset(base({ duration: 0 }), 0)).toEqual({ dx: 0, dy: 0 });
  });

  it('starts fully offset at localTime 0, regardless of easing', () => {
    for (const easing of ['linear', 'easeOut', 'easeInOut'] as const) {
      const enter = base({ easing, offsetX: 0.2, offsetY: 0.15 });
      expect(enterOffset(enter, 0)).toEqual({ dx: 0.2, dy: 0.15 });
    }
  });

  it('fully resolves to the base position once duration elapses, regardless of easing', () => {
    for (const easing of ['linear', 'easeOut', 'easeInOut'] as const) {
      const enter = base({ easing, offsetX: 0.2, offsetY: 0.15 });
      const { dx, dy } = enterOffset(enter, enter.duration);
      expect(dx).toBeCloseTo(0);
      expect(dy).toBeCloseTo(0);
    }
  });

  it('linear: remaining offset decays proportionally to progress', () => {
    const enter = base({ easing: 'linear', offsetX: 0.2, offsetY: 0 });
    // p = 0.5 -> eased = 0.5 -> remaining = 0.5
    const { dx } = enterOffset(enter, 0.2);
    expect(dx).toBeCloseTo(0.1);
  });

  it('easeOut: matches the ffmpeg `1 - (1-p)^2` power curve at p=0.5', () => {
    const enter = base({ easing: 'easeOut', offsetX: 0.2, offsetY: 0 });
    // p = 0.5 -> eased = 1 - (1-0.5)^2 = 0.75 -> remaining = 0.25
    const { dx } = enterOffset(enter, 0.2);
    expect(dx).toBeCloseTo(0.2 * 0.25);
  });

  it('easeInOut: matches the ffmpeg `(1 - cos(pi*p)) / 2` cosine curve at p=0.5', () => {
    const enter = base({ easing: 'easeInOut', offsetX: 0.2, offsetY: 0 });
    // p = 0.5 -> eased = (1 - cos(pi*0.5)) / 2 = 0.5 -> remaining = 0.5
    const { dx } = enterOffset(enter, 0.2);
    expect(dx).toBeCloseTo(0.1);
  });
});
