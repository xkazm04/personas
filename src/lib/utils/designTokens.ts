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
  'w-full px-3 py-2 bg-background/50 border border-primary/15 rounded-xl text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-1 ring-offset-background transition-all';

/** INPUT_FIELD with a red error border — use when `aria-invalid` is true. */
export const INPUT_FIELD_ERROR =
  'w-full px-3 py-2 bg-background/50 border border-red-500/50 rounded-xl text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-red-500/40 focus:ring-offset-1 ring-offset-background transition-all';

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

/** Review status colors: pending, approved, rejected */
export const STATUS_COLORS: Record<string, StatusColorToken> = {
  info: {
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/20',
    ringColor: 'focus:ring-blue-500/40',
  },
  ai: {
    color: 'text-violet-400',
    bgColor: 'bg-violet-500/10',
    borderColor: 'border-violet-500/20',
    ringColor: 'focus:ring-violet-500/40',
  },
  rotation: {
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-500/10',
    borderColor: 'border-cyan-500/20',
    ringColor: 'focus:ring-cyan-500/40',
  },
  success: {
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/30',
    ringColor: 'focus:ring-emerald-500/40',
  },
  warning: {
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/30',
    ringColor: 'focus:ring-amber-500/40',
  },
  error: {
    color: 'text-red-400',
    bgColor: 'bg-red-500/10',
    borderColor: 'border-red-500/30',
    ringColor: 'focus:ring-red-500/40',
  },
  pending: { color: 'text-amber-400', bgColor: 'bg-amber-500/10', borderColor: 'border-amber-500/30' },
  approved: { color: 'text-emerald-400', bgColor: 'bg-emerald-500/10', borderColor: 'border-emerald-500/30' },
  rejected: { color: 'text-red-400', bgColor: 'bg-red-500/10', borderColor: 'border-red-500/30' },
};

/** Standardised severity accent styles -- left border + subtle background */
export interface SeverityStyleToken {
  border: string;
  bg: string;
  text: string;
}

export const SEVERITY_STYLES: Record<'error' | 'warning' | 'info' | 'success', SeverityStyleToken> = {
  error:   { border: 'border-l-[3px] border-l-red-500',     bg: 'bg-red-500/5',     text: 'text-red-400' },
  warning: { border: 'border-l-[3px] border-l-amber-500',   bg: 'bg-amber-500/5',   text: 'text-amber-400' },
  info:    { border: 'border-l-[3px] border-l-blue-500',    bg: 'bg-blue-500/5',    text: 'text-blue-400' },
  success: { border: 'border-l-[3px] border-l-emerald-500', bg: 'bg-emerald-500/5', text: 'text-emerald-400' },
};

/** Feasibility assessment colors: ready, partial, blocked */
export const FEASIBILITY_COLORS: Record<string, StatusColorToken> = {
  ready: { color: 'text-emerald-400', bgColor: 'bg-emerald-500/10', borderColor: 'border-emerald-500/30' },
  partial: { color: 'text-amber-400', bgColor: 'bg-amber-500/10', borderColor: 'border-amber-500/30' },
  blocked: { color: 'text-red-400', bgColor: 'bg-red-500/10', borderColor: 'border-red-500/30' },
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
  /** Reduced three-level status palette for simple mode */
  STATUS: {
    good:    { label: 'Good',      color: 'text-emerald-400', bg: 'bg-emerald-500/10', dot: 'bg-emerald-400' },
    warning: { label: 'Attention', color: 'text-amber-400',   bg: 'bg-amber-500/10',   dot: 'bg-amber-400' },
    problem: { label: 'Problem',   color: 'text-red-400',     bg: 'bg-red-500/10',     dot: 'bg-red-400' },
  } satisfies Record<SimpleStatus, SimpleStatusToken>,
  /** Card style for simple mode -- larger, rounder, more breathing room */
  CARD: 'rounded-xl border border-primary/10 bg-background/60 p-5 shadow-sm',
  /** Minimum touch target for simple mode interactive elements */
  MIN_TARGET: 'min-h-[44px] min-w-[44px]',
} as const;
