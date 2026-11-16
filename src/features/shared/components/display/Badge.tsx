import { forwardRef } from 'react';
import { StateMark, type StateMarkState } from './StateMark';

// ---------------------------------------------------------------------------
// Badge variant tokens
//
// Token maps for callers that still want a tinted chip (noteStatusMeta). Hues map to the nearest
// status or role token: bg /10, border /20, text full. The Badge component itself renders no
// fill: it is a StateMark (glyph + word).
// ---------------------------------------------------------------------------

export const BADGE_VARIANTS = {
  emerald: 'bg-status-success/10 border-status-success/20 text-status-success',
  amber: 'bg-status-warning/10 border-status-warning/20 text-status-warning',
  red: 'bg-status-error/10 border-status-error/20 text-status-error',
  rose: 'bg-status-error/10 border-status-error/20 text-status-error',
  cyan: 'bg-status-info/10 border-status-info/20 text-status-info',
  purple: 'bg-role-agent/10 border-role-agent/20 text-role-agent',
  violet: 'bg-role-agent/10 border-role-agent/20 text-role-agent',
  blue: 'bg-status-info/10 border-status-info/20 text-status-info',
  orange: 'bg-status-warning/10 border-status-warning/20 text-status-warning',
  yellow: 'bg-status-warning/10 border-status-warning/20 text-status-warning',
  sky: 'bg-status-info/10 border-status-info/20 text-status-info',
  neutral:  'bg-surface-2 border-hair-2 text-ink-1',
} as const;

export type BadgeVariant = keyof typeof BADGE_VARIANTS;

/** Hover-state classes following the same token scale. */
export const BADGE_HOVER: Record<BadgeVariant, string> = {
  emerald: 'hover:bg-status-success/15 hover:border-status-success/30',
  amber: 'hover:bg-status-warning/15 hover:border-status-warning/30',
  red: 'hover:bg-status-error/15 hover:border-status-error/30',
  rose: 'hover:bg-status-error/15 hover:border-status-error/30',
  cyan: 'hover:bg-status-info/15 hover:border-status-info/30',
  purple: 'hover:bg-role-agent/15 hover:border-role-agent/30',
  violet: 'hover:bg-role-agent/15 hover:border-role-agent/30',
  blue: 'hover:bg-status-info/15 hover:border-status-info/30',
  orange: 'hover:bg-status-warning/15 hover:border-status-warning/30',
  yellow: 'hover:bg-status-warning/15 hover:border-status-warning/30',
  sky: 'hover:bg-status-info/15 hover:border-status-info/30',
  neutral:  'hover:bg-surface-2 hover:border-hair-2',
};

/** Decomposed token record for cases that need individual class strings. */
export const BADGE_TOKENS: Record<BadgeVariant, { bg: string; border: string; text: string }> = {
  emerald: { bg: 'bg-status-success/10', border: 'border-status-success/20', text: 'text-status-success' },
  amber: { bg: 'bg-status-warning/10', border: 'border-status-warning/20', text: 'text-status-warning' },
  red: { bg: 'bg-status-error/10', border: 'border-status-error/20', text: 'text-status-error' },
  rose: { bg: 'bg-status-error/10', border: 'border-status-error/20', text: 'text-status-error' },
  cyan: { bg: 'bg-status-info/10', border: 'border-status-info/20', text: 'text-status-info' },
  purple: { bg: 'bg-role-agent/10', border: 'border-role-agent/20', text: 'text-role-agent' },
  violet: { bg: 'bg-role-agent/10', border: 'border-role-agent/20', text: 'text-role-agent' },
  blue: { bg: 'bg-status-info/10', border: 'border-status-info/20', text: 'text-status-info' },
  orange: { bg: 'bg-status-warning/10', border: 'border-status-warning/20', text: 'text-status-warning' },
  yellow: { bg: 'bg-status-warning/10', border: 'border-status-warning/20', text: 'text-status-warning' },
  sky: { bg: 'bg-status-info/10', border: 'border-status-info/20', text: 'text-status-info' },
  neutral: { bg: 'bg-surface-2', border: 'border-hair-2', text: 'text-ink-1' },
};

// ---------------------------------------------------------------------------
// Badge component
// ---------------------------------------------------------------------------

type BadgeSize = 'xs' | 'sm' | 'md';

const BADGE_STATE: Record<BadgeVariant, StateMarkState> = {
  emerald: 'success', amber: 'warning', red: 'error', rose: 'error', cyan: 'info', purple: 'info',
  violet: 'info', blue: 'info', orange: 'warning', yellow: 'warning', sky: 'info', neutral: 'neutral',
};

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant: BadgeVariant;
  size?: BadgeSize;
  /** Kept for call-site compatibility; a badge no longer has a pill shape. */
  shape?: 'pill' | 'rounded';
  interactive?: boolean;
}

/**
 * Badge: a tone and a word as a StateMark (glyph + word, no pill, no fill).
 * @catalog Badge - a tone + word rendered as a StateMark; variants map to the nearest status; `interactive` makes it a focusable button.
 */
export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ variant, size = 'sm', shape: _shape, interactive = false, className = '', children, tabIndex, ...rest }, ref) => {
    // Interactive badges MUST be keyboard-reachable and render a focus ring.
    // See Design.md §7.6 — every interactive primitive applies focus-ring.
    const interactiveProps = interactive
      ? {
          tabIndex: tabIndex ?? 0,
          role: rest.role ?? 'button',
        }
      : tabIndex !== undefined
        ? { tabIndex }
        : {};
    const interactiveClasses = interactive
      ? 'cursor-pointer rounded-interactive transition-colors focus-ring hover:bg-surface-2'
      : '';
    return (
      <span
        ref={ref}
        className={`inline-flex items-center ${interactiveClasses} ${className}`.trim()}
        {...interactiveProps}
        {...rest}
      >
        <StateMark state={BADGE_STATE[variant]} size={size === 'md' ? 'md' : 'sm'} label={children} />
      </span>
    );
  },
);

Badge.displayName = 'Badge';
