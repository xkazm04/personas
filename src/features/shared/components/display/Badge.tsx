import { forwardRef } from 'react';

// ---------------------------------------------------------------------------
// Badge variant tokens
//
// Canonical opacity scale for ALL badge-like elements:
//   bg:     {color}-500/10
//   border: {color}-500/20
//   text:   {color}-400
//
// Hover (optional): bg {color}-500/15, border {color}-500/30
// ---------------------------------------------------------------------------

export const BADGE_VARIANTS = {
  emerald:  'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
  amber:    'bg-amber-500/10 border-amber-500/20 text-amber-400',
  red:      'bg-red-500/10 border-red-500/20 text-red-400',
  rose:     'bg-rose-500/10 border-rose-500/20 text-rose-400',
  cyan:     'bg-cyan-500/10 border-cyan-500/20 text-cyan-400',
  purple:   'bg-purple-500/10 border-purple-500/20 text-purple-400',
  violet:   'bg-violet-500/10 border-violet-500/20 text-violet-400',
  blue:     'bg-blue-500/10 border-blue-500/20 text-blue-400',
  orange:   'bg-orange-500/10 border-orange-500/20 text-orange-400',
  yellow:   'bg-yellow-500/10 border-yellow-500/20 text-yellow-400',
  sky:      'bg-sky-500/10 border-sky-500/20 text-sky-400',
  neutral:  'bg-secondary/40 border-border/50 text-foreground',
} as const;

export type BadgeVariant = keyof typeof BADGE_VARIANTS;

/** Hover-state classes following the same token scale. */
export const BADGE_HOVER: Record<BadgeVariant, string> = {
  emerald:  'hover:bg-emerald-500/15 hover:border-emerald-500/30',
  amber:    'hover:bg-amber-500/15 hover:border-amber-500/30',
  red:      'hover:bg-red-500/15 hover:border-red-500/30',
  rose:     'hover:bg-rose-500/15 hover:border-rose-500/30',
  cyan:     'hover:bg-cyan-500/15 hover:border-cyan-500/30',
  purple:   'hover:bg-purple-500/15 hover:border-purple-500/30',
  violet:   'hover:bg-violet-500/15 hover:border-violet-500/30',
  blue:     'hover:bg-blue-500/15 hover:border-blue-500/30',
  orange:   'hover:bg-orange-500/15 hover:border-orange-500/30',
  yellow:   'hover:bg-yellow-500/15 hover:border-yellow-500/30',
  sky:      'hover:bg-sky-500/15 hover:border-sky-500/30',
  neutral:  'hover:bg-secondary/60 hover:border-border/70',
};

/** Decomposed token record for cases that need individual class strings. */
export const BADGE_TOKENS: Record<BadgeVariant, { bg: string; border: string; text: string }> = {
  emerald:  { bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', text: 'text-emerald-400' },
  amber:    { bg: 'bg-amber-500/10',   border: 'border-amber-500/20',   text: 'text-amber-400' },
  red:      { bg: 'bg-red-500/10',     border: 'border-red-500/20',     text: 'text-red-400' },
  rose:     { bg: 'bg-rose-500/10',    border: 'border-rose-500/20',    text: 'text-rose-400' },
  cyan:     { bg: 'bg-cyan-500/10',    border: 'border-cyan-500/20',    text: 'text-cyan-400' },
  purple:   { bg: 'bg-purple-500/10',  border: 'border-purple-500/20',  text: 'text-purple-400' },
  violet:   { bg: 'bg-violet-500/10',  border: 'border-violet-500/20',  text: 'text-violet-400' },
  blue:     { bg: 'bg-blue-500/10',    border: 'border-blue-500/20',    text: 'text-blue-400' },
  orange:   { bg: 'bg-orange-500/10',  border: 'border-orange-500/20',  text: 'text-orange-400' },
  yellow:   { bg: 'bg-yellow-500/10',  border: 'border-yellow-500/20',  text: 'text-yellow-400' },
  sky:      { bg: 'bg-sky-500/10',     border: 'border-sky-500/20',     text: 'text-sky-400' },
  neutral:  { bg: 'bg-secondary/40',   border: 'border-border/50',      text: 'text-foreground' },
};

// ---------------------------------------------------------------------------
// Badge component
// ---------------------------------------------------------------------------

type BadgeSize = 'xs' | 'sm' | 'md';

const SIZE_CLASSES: Record<BadgeSize, string> = {
  xs: 'px-1.5 py-0.5 text-[10px] gap-1',
  sm: 'px-2 py-0.5 text-xs gap-1.5',
  md: 'px-2.5 py-1 text-sm gap-1.5',
};

const SHAPE_CLASSES = {
  pill: 'rounded-full',
  rounded: 'rounded-lg',
} as const;

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant: BadgeVariant;
  size?: BadgeSize;
  shape?: keyof typeof SHAPE_CLASSES;
  interactive?: boolean;
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ variant, size = 'sm', shape = 'pill', interactive = false, className = '', children, ...rest }, ref) => {
    return (
      <span
        ref={ref}
        className={`inline-flex items-center font-medium border ${BADGE_VARIANTS[variant]} ${SIZE_CLASSES[size]} ${SHAPE_CLASSES[shape]} ${interactive ? `transition-colors ${BADGE_HOVER[variant]}` : ''} ${className}`}
        {...rest}
      >
        {children}
      </span>
    );
  },
);

Badge.displayName = 'Badge';
