// ---------------------------------------------------------------------------
// Preview-side runtime helpers that act on the RenderPlan IR.
//
// The plan itself is produced by the Rust compiler (via the
// `artist_compile_render_plan` Tauri command). These helpers are the tiny
// slice of per-tick math the browser preview does on top of the plan:
// envelope evaluation and the loudnorm approximation documented in
// docs/concepts/media-studio-renderplan.md §"Normalize directive".
// ---------------------------------------------------------------------------

import type { NormalizeDirective } from '@/lib/bindings/NormalizeDirective';

/**
 * Linear gain multiplier for preview loudnorm. Matches the Rust `normalize`
 * directive's "preview applies an approximation" branch — export uses the
 * real two-pass loudnorm filter, so preview and export converge within the
 * audibility tolerance documented in the spec.
 */
export function approxLoudnormGain(normalize: NormalizeDirective): number {
  const gainDb = normalize.targetLufs - normalize.measurements.integratedLufs;
  const linear = Math.pow(10, gainDb / 20);
  return Math.max(0, Math.min(normalize.maxLinearGain, linear));
}

/**
 * Envelope opacity for a fade-in/fade-out pair, given local time within the
 * stage's output window. Used by the video element, image overlays, text
 * overlays, and (multiplied into linearGain) audio stages.
 */
export function fadeEnvelope(
  localTime: number,
  duration: number,
  fadeIn: number,
  fadeOut: number,
): number {
  let o = 1;
  if (fadeIn > 0.001 && localTime < fadeIn) {
    o = Math.max(0, localTime / fadeIn);
  }
  if (fadeOut > 0.001 && localTime > duration - fadeOut) {
    o = Math.min(o, Math.max(0, (duration - localTime) / fadeOut));
  }
  return Math.max(0, Math.min(1, o));
}
