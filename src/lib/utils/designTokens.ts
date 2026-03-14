import { STATUS_PALETTE, STATUS_PALETTE_EXTENDED, SEVERITY_ACCENTS } from '@/lib/design/statusTokens';
import type { SeverityAccent } from '@/lib/design/statusTokens';

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

export interface StatusColorToken {
  color: string;
  bgColor: string;
  borderColor: string;
  ringColor?: string;
}

export interface ButtonVariantToken {
  bg: string;
  text: string;
  border: string;
  hover: string;
}

export const INPUT_FIELD =
  'w-full px-3 py-2 bg-background/50 border border-primary/15 rounded-xl text-sm text-foreground placeholder-muted-foreground/30 focus-ring focus-visible:ring-offset-1 ring-offset-background transition-all';

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

/** Map a StatusToken → legacy StatusColorToken shape */
function toStatusColor(t: { text: string; bg: string; border: string; ring: string }): StatusColorToken {
  return { color: t.text, bgColor: t.bg, borderColor: t.border, ringColor: t.ring };
}

/** Review status colors -- derived from the unified STATUS_PALETTE. */
export const STATUS_COLORS: Record<string, StatusColorToken> = {
  info:     toStatusColor(STATUS_PALETTE_EXTENDED.info),
  ai:       toStatusColor(STATUS_PALETTE_EXTENDED.ai),
  rotation: toStatusColor(STATUS_PALETTE_EXTENDED.rotation),
  success:  toStatusColor(STATUS_PALETTE.success),
  warning:  toStatusColor(STATUS_PALETTE.warning),
  error:    toStatusColor(STATUS_PALETTE.error),
  pending:  toStatusColor(STATUS_PALETTE.warning),
  approved: toStatusColor(STATUS_PALETTE.success),
  rejected: toStatusColor(STATUS_PALETTE.error),
};

/** Standardised severity accent styles -- left border + subtle background.
 *  Derived from the unified STATUS_PALETTE via SEVERITY_ACCENTS. */
export type SeverityStyleToken = SeverityAccent;

export const SEVERITY_STYLES: Record<'error' | 'warning' | 'info' | 'success', SeverityStyleToken> = SEVERITY_ACCENTS;

/** Feasibility assessment colors -- derived from STATUS_PALETTE */
export const FEASIBILITY_COLORS: Record<string, StatusColorToken> = {
  ready:   toStatusColor(STATUS_PALETTE.success),
  partial: toStatusColor(STATUS_PALETTE.warning),
  blocked: toStatusColor(STATUS_PALETTE.error),
};

// -- Tools UI tokens ----------------------------------------------------

/** Standardised border opacity for tool/connector UI surfaces */
export const TOOLS_BORDER = 'border-primary/15' as const;

/** Standardised section spacing — use mt-2 between sibling sections */
export const TOOLS_SECTION_GAP = 'mt-2' as const;

/** Standard-size action button padding (e.g. Test, Configure, Add) */
export const TOOLS_BTN_STANDARD = 'px-3 py-1.5' as const;

/** Compact/icon button padding (e.g. external link, impact toggle) */
export const TOOLS_BTN_COMPACT = 'px-2 py-1' as const;

/** Inner section spacing for stacked content within a panel */
export const TOOLS_INNER_SPACE = 'space-y-2' as const;

// -- Simple mode tokens -------------------------------------------------

export type SimpleStatus = 'good' | 'warning' | 'problem';

export interface SimpleStatusToken {
  label: string;
  color: string;
  bg: string;
  dot: string;
}

export const SIMPLE_MODE = {
  /** Reduced three-level status palette for simple mode -- derived from STATUS_PALETTE */
  STATUS: {
    good:    { label: 'Good',      color: STATUS_PALETTE.success.text, bg: STATUS_PALETTE.success.bg, dot: STATUS_PALETTE.success.icon },
    warning: { label: 'Attention', color: STATUS_PALETTE.warning.text, bg: STATUS_PALETTE.warning.bg, dot: STATUS_PALETTE.warning.icon },
    problem: { label: 'Problem',   color: STATUS_PALETTE.error.text,   bg: STATUS_PALETTE.error.bg,   dot: STATUS_PALETTE.error.icon },
  } satisfies Record<SimpleStatus, SimpleStatusToken>,
  /** Card style for simple mode -- larger, rounder, more breathing room */
  CARD: 'rounded-xl border border-primary/10 bg-background/60 p-5 shadow-sm',
  /** Minimum touch target for simple mode interactive elements */
  MIN_TARGET: 'min-h-[44px] min-w-[44px]',
} as const;
