import { STATUS_PALETTE, STATUS_PALETTE_EXTENDED, SEVERITY_ACCENTS } from '@/lib/design/statusTokens';
import type { StatusToken, SeverityAccent } from '@/lib/design/statusTokens';

/**
 * 4px-grid spacing scale.
 * Maps to CSS custom properties --spacing-1 ... --spacing-16.
 * Use these Tailwind utility classes exclusively for a consistent visual rhythm.
 */
export const SPACING = {
  1: '1',    // 4px
  2: '2',    // 8px
  3: '3',    // 12px
  4: '4',    // 16px
  6: '6',    // 24px
  8: '8',    // 32px
  12: '12',  // 48px
  16: '16',  // 64px
} as const;

/** Allowed spacing values on the 4px grid */
export type SpacingToken = keyof typeof SPACING;

// -- Motion tokens ---------------------------------------------------------
// Unified animation timing registry — the JS counterpart of the CSS
// custom properties --duration-{instant,fast,normal,slow} in globals.css,
// held equal to them by `__tests__/motionTokens.parity.test.ts`.
//
// Reach for this registry only when a timing must exist as a NUMBER in JS: a
// setTimeout, a Framer transition, a delay prop. Anything expressible in CSS
// belongs in CSS — use the `duration-{snap,flow,ease}` utility classes, which
// read the custom properties directly and need no JS at all. That is why this
// registry has few consumers by design and not by neglect; the comment here
// used to claim universal adoption while `MOTION.duration` had none.
//
// Current JS-side consumers: `animation/animationPresets.ts` (every Framer
// rung, converted to seconds) and `MOTION.delay.tooltip` in Tooltip.tsx /
// TruncateWithTooltip.tsx.

export const MOTION = {
  /** Transition / animation durations in milliseconds. */
  duration: {
    instant: 50,
    fast: 150,
    normal: 250,
    slow: 400,
  },
  /**
   * Spring physics, one entry per intended GESTURE — not per call site.
   *
   * There were three declarations of a spring in this app and no statement of
   * which were meant to be the same: `MOTION_SPRING` and `useMotion`'s
   * `FULL_MOTION.spring` were byte-identical copies of 300/25, while the rAF
   * engine ran 50/15 — six times softer — under a comment claiming it matched
   * "the previous framer-motion config", which by then declared neither number.
   *
   * Two springs, decided and named. A spring has no duration, so neither is a
   * rung of the `duration` ladder above and neither can be audited against a
   * millisecond cap.
   */
  spring: {
    /**
     * Snappy interaction spring — a control answering a press or a hover.
     * Arrives quickly and barely overshoots. This is the app's default spring.
     */
    snappy: { stiffness: 300, damping: 25, mass: 1 },
    /**
     * Soft readout spring — a value gliding to a new number (the shared rAF
     * engine's counters, gauges and meters). Deliberately slower and heavier
     * than `snappy`: the travel IS the information, so it has to be readable
     * rather than instant.
     */
    soft: { stiffness: 50, damping: 15, mass: 1 },
  },
  /** Deliberate delays before a UI element appears. */
  delay: {
    /**
     * Hover-intent delay before a tooltip surfaces. `fast` (150ms) for dense,
     * deliberate help affordances the user is already pointing at (glossary
     * help icons); `default` (400ms) for incidental reveals like truncated-text
     * tooltips, where a slower threshold avoids flicker during normal scanning.
     */
    tooltip: {
      fast: 150,
      default: 400,
    },
  },
} as const;

export type MotionDurationToken = keyof typeof MOTION.duration;
export type MotionSpringToken = keyof typeof MOTION.spring;
export type MotionDelayToken = keyof typeof MOTION.delay;

// -- Semantic spacing tokens ------------------------------------------------
// Use these instead of raw p-*, px-*, py-*, space-y-*, gap-* classes.
// Each token encodes design intent so the "why" is clear at the call site.

/** Card internal padding — compact variant for dense UIs, standard for normal cards.
 *
 *  `standard`/`compact`/`dense` are bound to the app-wide density CSS variables
 *  (`--density-pad`, `--density-pad-sm`) set by the Appearance "Density" setting,
 *  so flipping density reflows every card that uses these tokens. The default
 *  ("comfortable") resolves to the historical values (p-4 / p-3), so appearance
 *  is unchanged out of the box. `modalSection` stays fixed — modal chrome bands
 *  should not breathe with content density. */
export const CARD_PADDING = {
  compact: 'p-[var(--density-pad-sm)]',
  standard: 'p-[var(--density-pad)]',
  /** Mobile-compact card body: full horizontal padding with tighter vertical rhythm. */
  dense: 'px-4 py-[var(--density-pad-sm)]',
  /** Modal header/tabs/footer bands — wider horizontal padding, standard vertical rhythm. */
  modalSection: 'px-6 py-4',
} as const;

/** Vertical gap between sections — within a panel vs between page-level sections.
 *  Density-aware via `--density-gap` / `--density-gap-lg`; default resolves to
 *  the historical space-y-4 / space-y-6. */
export const SECTION_GAP = {
  within: 'space-y-[var(--density-gap)]',
  between: 'space-y-[var(--density-gap-lg)]',
} as const;

/** Gap between list items — dense for tight lists, cards for spaced card grids. */
export const LIST_ITEM_GAP = {
  dense: 'gap-1.5',
  cards: 'gap-2.5',
} as const;

/** Vertical spacing between form fields. */
export const FORM_FIELD_GAP = 'space-y-4' as const;

/** @deprecated Use StatusToken from '@/lib/design/statusTokens' directly. */
export type StatusColorToken = StatusToken;

export interface ButtonVariantToken {
  bg: string;
  text: string;
  border: string;
  hover: string;
}

export const INPUT_FIELD =
  'w-full px-3 py-2 bg-background/50 border border-primary/12 rounded-xl text-sm text-foreground placeholder-muted-foreground/30 focus-ring focus-visible:ring-offset-1 ring-offset-background transition-all';

/** INPUT_FIELD with a red error border — use when `aria-invalid` is true. */
export const INPUT_FIELD_ERROR =
  'w-full px-3 py-2 bg-background/50 border border-red-500/50 rounded-xl text-sm text-foreground placeholder-muted-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 focus-visible:ring-offset-1 ring-offset-background transition-all';

/** Returns INPUT_FIELD or INPUT_FIELD_ERROR based on the error flag. */
export function inputFieldClass(hasError?: boolean): string {
  return hasError ? INPUT_FIELD_ERROR : INPUT_FIELD;
}

export const BUTTON_VARIANTS: Record<'tryIt' | 'adopt' | 'delete', ButtonVariantToken> = {
  tryIt: {
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-400',
    border: 'border-emerald-500/20',
    hover: 'hover:bg-emerald-500/20',
  },
  adopt: {
    bg: 'bg-violet-500/15',
    text: 'text-violet-400',
    border: 'border-violet-500/25',
    hover: 'hover:bg-violet-500/25',
  },
  delete: {
    bg: 'bg-red-500/10',
    text: 'text-red-400',
    border: 'border-red-500/20',
    hover: 'hover:bg-red-500/10',
  },
};

/** Review status colors -- derived from the unified STATUS_PALETTE. */
export type StatusColorKey =
  | 'info'
  | 'ai'
  | 'rotation'
  | 'success'
  | 'warning'
  | 'error'
  | 'pending'
  | 'approved'
  | 'rejected';
export const STATUS_COLORS: Record<StatusColorKey, StatusToken> = {
  info:     STATUS_PALETTE_EXTENDED.info,
  ai:       STATUS_PALETTE_EXTENDED.ai,
  rotation: STATUS_PALETTE_EXTENDED.rotation,
  success:  STATUS_PALETTE.success,
  warning:  STATUS_PALETTE.warning,
  error:    STATUS_PALETTE.error,
  pending:  STATUS_PALETTE.warning,
  approved: STATUS_PALETTE.success,
  rejected: STATUS_PALETTE.error,
};

/** Standardised severity accent styles -- left border + subtle background.
 *  Derived from the unified STATUS_PALETTE via SEVERITY_ACCENTS. */
export type SeverityStyleToken = SeverityAccent;

export const SEVERITY_STYLES: Record<'error' | 'warning' | 'info' | 'success', SeverityStyleToken> = SEVERITY_ACCENTS;

/** Feasibility assessment colors -- derived from STATUS_PALETTE */
export const FEASIBILITY_COLORS: Record<string, StatusToken> = {
  ready:   STATUS_PALETTE.success,
  partial: STATUS_PALETTE.warning,
  blocked: STATUS_PALETTE.error,
};

// -- Semantic border opacity tiers --------------------------------------
// Three named tiers for consistent visual hierarchy across all surfaces.
// SUBTLE  → internal dividers, disabled borders, separator lines
// DEFAULT → card outlines, panel borders, input borders at rest
// EMPHASIS → focused, hovered, or active-state borders

export const BORDER_SUBTLE = 'border-primary/5' as const;
export const BORDER_DEFAULT = 'border-primary/12' as const;
export const BORDER_EMPHASIS = 'border-primary/20' as const;

/** Divide-line counterpart of BORDER_SUBTLE for use with Tailwind divide-* */
export const DIVIDE_SUBTLE = 'divide-primary/5' as const;

/** Hover border class — pair with BORDER_DEFAULT on the base state */
export const BORDER_HOVER = 'hover:border-primary/20' as const;

// -- Tools UI tokens ----------------------------------------------------

/** Standardised border opacity for tool/connector UI surfaces */
export const TOOLS_BORDER = BORDER_DEFAULT;

/** Standardised section spacing — use mt-2 between sibling sections */
export const TOOLS_SECTION_GAP = 'mt-2' as const;

/** Standard-size action button padding (e.g. Test, Configure, Add) */
export const TOOLS_BTN_STANDARD = 'px-3 py-1.5' as const;

/** Compact/icon button padding (e.g. external link, impact toggle) */
export const TOOLS_BTN_COMPACT = 'px-2 py-1' as const;

/** Inner section spacing for stacked content within a panel */
export const TOOLS_INNER_SPACE = 'space-y-2' as const;

// -- Disabled & Locked State Tokens ---------------------------------------
// Unified visual language for non-interactive states.
// DISABLED: standard opacity for buttons/inputs (≈ 0.38 Material guideline)
// LOCKED:   overlay approach for cards requiring prerequisite completion
// INACTIVE_BORDER: border for non-interactive / disabled elements

/** Standard disabled state — pairs `--disabled-opacity` with cursor + pointer-events-none.
 *  Source token: `--disabled-opacity` in globals.css. Implemented as the `is-disabled` utility. */
export const STATE_DISABLED_OPACITY = 'disabled:is-disabled' as const;

/** Locked-card styles — overlay approach avoids compounded opacity illegibility.
 *  `container`:  cursor only (no opacity dimming — the overlay handles the visual).
 *  `overlay`:    semi-transparent background applied on an absolute-positioned element.
 *  `icon`:       lock-icon color within the overlay — full contrast, not muted. */
export const STATE_LOCKED = {
  container: 'cursor-not-allowed',
  overlay: 'bg-background/60',
  icon: 'text-foreground',
} as const;

/** Border for inactive / disabled elements — alias for BORDER_SUBTLE. */
export const STATE_INACTIVE_BORDER = BORDER_SUBTLE;

// -- Simple mode tokens -------------------------------------------------

export type SimpleStatus = 'good' | 'warning' | 'problem';

/**
 * Appearance vocabulary for one simple-mode status level.
 *
 * Carries no `label`. It used to, with the literal English 'Good' / 'Attention' /
 * 'Problem' baked in — display copy inside a design-token module, and the one
 * surface aimed at the least technical users was the one surface that could not
 * be translated. The copy now lives where every other machine token's copy does,
 * `status_tokens.simple`, read through `tokenLabel(t, 'simple', level)`.
 */
export interface SimpleStatusToken {
  color: string;
  bg: string;
  dot: string;
}

export const SIMPLE_MODE = {
  /** Reduced three-level status palette for simple mode -- derived from STATUS_PALETTE */
  STATUS: {
    good:    { color: STATUS_PALETTE.success.text, bg: STATUS_PALETTE.success.bg, dot: STATUS_PALETTE.success.icon },
    warning: { color: STATUS_PALETTE.warning.text, bg: STATUS_PALETTE.warning.bg, dot: STATUS_PALETTE.warning.icon },
    problem: { color: STATUS_PALETTE.error.text,   bg: STATUS_PALETTE.error.bg,   dot: STATUS_PALETTE.error.icon },
  } satisfies Record<SimpleStatus, SimpleStatusToken>,
  /** Card style for simple mode -- larger, rounder, more breathing room */
  CARD: `rounded-xl border ${BORDER_DEFAULT} bg-background/60 p-5 shadow-elevation-1`,
  /** Minimum touch target for simple mode interactive elements */
  MIN_TARGET: 'min-h-[44px] min-w-[44px]',
} as const;
