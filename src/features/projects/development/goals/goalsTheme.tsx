/**
 * Goals v2 shared visual language.
 *
 * Adapts the platform visual-identity philosophy (depth via low-opacity gradient
 * pools, motion as information, constraint/accent-parameterization) to the
 * desktop's own semantic tokens — no raw hex, no web-only primitives. Every
 * Goals surface composes from these so the look stays cohesive and a tweak is
 * a one-file edit.
 */

/**
 * A near-invisible radial "atmosphere" pool seated behind a surface — the
 * depth-without-clutter layer. Violet (the Goals accent) at ~6% so it registers
 * subconsciously. Decorative + inert.
 */
export function GoalAtmosphere(_props: { className?: string }) {
  // Console law: no atmosphere pool behind a surface. Kept as a no-op so call sites stay put.
  return null;
}
