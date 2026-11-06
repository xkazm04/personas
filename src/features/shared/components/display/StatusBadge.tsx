import type { ReactNode } from 'react';
import { StateMark, type StateMarkState } from './StateMark';
import { Tooltip } from './Tooltip';

// -- Semantic status variants -----------------------------------------------

export type StatusVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'processing';

// -- Accent colors (matches Button AccentColor) ----------------------------

export type BadgeAccent =
  | 'cyan' | 'purple' | 'violet' | 'emerald' | 'amber' | 'blue'
  | 'rose' | 'sky' | 'teal' | 'indigo' | 'orange' | 'pink' | 'lime'
  | 'red' | 'slate';

// -- Size ------------------------------------------------------------------

export type BadgeSize = 'sm' | 'md';

// -- Mapping onto the StateMark vocabulary ---------------------------------
//
// A badge is a state mark now: glyph in the signal colour + a word, no pill, no fill. A hue
// accent has no state of its own, so it maps to the nearest status.

const ACCENT_STATE: Record<BadgeAccent, StateMarkState> = {
  cyan: 'info', sky: 'info', blue: 'info',
  emerald: 'success', teal: 'success', lime: 'success',
  amber: 'warning', orange: 'warning',
  red: 'error', rose: 'error',
  purple: 'info', violet: 'info', indigo: 'info', pink: 'info',
  slate: 'neutral',
};

// -- Props -----------------------------------------------------------------

interface StatusBadgeBaseProps {
  children: ReactNode;
  /** Optional leading icon. */
  icon?: ReactNode;
  /** Badge size. Default: 'md'. */
  size?: BadgeSize;
  /** Kept for call-site compatibility; a badge no longer has a pill shape. */
  pill?: boolean;
  /** Extra class names. */
  className?: string;
  /** HTML title for hover tooltip. */
  title?: string;
}

interface StatusBadgeVariantProps extends StatusBadgeBaseProps {
  /** Semantic status variant. */
  variant: StatusVariant;
  accent?: never;
}

interface StatusBadgeAccentProps extends StatusBadgeBaseProps {
  /** Arbitrary accent color. */
  accent: BadgeAccent;
  variant?: never;
}

export type StatusBadgeProps = StatusBadgeVariantProps | StatusBadgeAccentProps;

// -- Component -------------------------------------------------------------

export function StatusBadge({
  variant,
  accent,
  children,
  icon,
  size = 'md',
  className = '',
  title,
}: StatusBadgeProps) {
  const state: StateMarkState = variant ?? ACCENT_STATE[accent!];
  const mark = (
    <span className={['inline-flex items-center gap-1.5', className].filter(Boolean).join(' ')}>
      {icon && <span className="flex-shrink-0">{icon}</span>}
      <StateMark state={state} size={size} label={children} />
    </span>
  );
  return title ? <Tooltip content={title}>{mark}</Tooltip> : mark;
}
