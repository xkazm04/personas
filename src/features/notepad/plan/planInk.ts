// The plan rail's colour vocabulary, in DESIGN TOKENS.
//
// These files arrived from `teams/sub_factory/l2/ship/` carrying the Passport
// Wall's own ink module under `teams/sub_factory/passport/` — six hard-coded
// hexes and a spray of rgba slate greys, applied through inline styles. That was
// coherent where it came from (the wall is one dense table with its own ink) and
// is wrong here: the pad is built out of Design.md tokens, and a hex is a colour
// that cannot follow the theme. On a light theme every one of them rendered the
// dark-theme value.
//
// The mapping, once, so nobody has to re-derive it:
//
//   INK.teal    #2DD4BF  → `primary`         the accent: a goal, the core cut
//   INK.emerald #34D399  → `status-success`  done / agreeing / go
//   INK.amber   #F59E0B  → `status-warning`  a blocker, a rating, warn
//   INK.red     #F87171  → `status-error`    nogo
//   INK.blue    #60A5FA  → `status-info`     the SETUP hue — unconfigured is an
//                                            invitation, not a fault
//   INK.violet  #8B5CF6  → `brand-purple`    Athena, and scope added after cut
//   the rgba slate grey → `status-neutral`  (148,163,184 IS `--status-neutral-raw`)
//
// TWO forms, because two kinds of consumer:
//
//  * `PLAN_INK` / `PLAN_BORDER` / `PLAN_WASH` — Tailwind class strings, which is
//    what everything that owns its own markup uses.
//  * `PLAN_HUE` — the same tokens as CSS `var(…)` VALUES, for the handful of
//    props that are typed as a colour string (`LedgerRow.stateHue`,
//    `BucketBtn.hue`). Those props are shared with `ShipPlannerTab`, which still
//    lives in the Factory and still passes hexes, so the prop type cannot change
//    until Phase 3 retires it. Passing a `var(--token)` keeps the prop's
//    contract and still gets the theme — which a hex never could.
import type { ContextTone, CritState } from '@/lib/milestone/shipModel';

/** Text colour per role. */
export const PLAN_INK = {
  accent: 'text-primary',
  success: 'text-status-success',
  warning: 'text-status-warning',
  error: 'text-status-error',
  info: 'text-status-info',
  athena: 'text-brand-purple',
  /** Structural grey — a count, a dismissed row, a rule. */
  neutral: 'text-status-neutral',
} as const;

/** Border colour per role, at the one opacity this rail uses. */
export const PLAN_BORDER = {
  accent: 'border-primary/35',
  success: 'border-status-success/35',
  warning: 'border-status-warning/35',
  error: 'border-status-error/35',
  info: 'border-status-info/35',
  athena: 'border-brand-purple/35',
  neutral: 'border-status-neutral/20',
} as const;

/** The faint ground a row or panel sits on. */
export const PLAN_WASH = {
  accent: 'bg-primary/5',
  success: 'bg-status-success/5',
  warning: 'bg-status-warning/5',
  error: 'bg-status-error/5',
  info: 'bg-status-info/5',
  athena: 'bg-brand-purple/5',
  neutral: 'bg-status-neutral/5',
} as const;

/** Solid fill per role — a dot, a rail, a filled tick. LITERAL class strings,
 *  like every other map here: Tailwind scans source TEXT, so a class assembled
 *  at runtime (`PLAN_WASH[role].replace('/5','')`) is a class that never gets
 *  generated and a dot that renders transparent. */
export const PLAN_FILL = {
  accent: 'bg-primary',
  success: 'bg-status-success',
  warning: 'bg-status-warning',
  error: 'bg-status-error',
  info: 'bg-status-info',
  athena: 'bg-brand-purple',
  neutral: 'bg-status-neutral',
} as const;

/** A chip's ground — heavier than `PLAN_WASH`, for a count badge sitting on a
 *  button rather than a panel behind a paragraph. */
export const PLAN_TINT = {
  accent: 'bg-primary/15',
  success: 'bg-status-success/15',
  warning: 'bg-status-warning/15',
  error: 'bg-status-error/15',
  info: 'bg-status-info/15',
  athena: 'bg-brand-purple/15',
  neutral: 'bg-status-neutral/15',
} as const;

export type PlanRole = keyof typeof PLAN_INK;

/**
 * The same tokens as CSS values. See the header: only for props typed as a
 * colour string. Prefer a class everywhere else — a class can carry opacity and
 * a hover state; a value cannot.
 */
export const PLAN_HUE: Record<PlanRole, string> = {
  accent: 'var(--primary)',
  success: 'var(--status-success)',
  warning: 'var(--status-warning)',
  error: 'var(--status-error)',
  info: 'var(--status-info)',
  athena: 'var(--brand-purple)',
  neutral: 'var(--status-neutral)',
};

/** The exit-criteria verdict, as a role. Replaces `CRIT_HUE`, which is the same
 *  four states expressed as the wall's ink hexes. */
export const CRIT_ROLE: Record<CritState, PlanRole> = {
  go: 'success',
  warn: 'warning',
  nogo: 'error',
  setup: 'info',
};

/** A context's health, as a role. Replaces `TONE_HUE_MAP`. */
export const TONE_ROLE: Record<ContextTone, PlanRole> = {
  ok: 'success',
  warn: 'warning',
  crit: 'error',
  setup: 'info',
};
