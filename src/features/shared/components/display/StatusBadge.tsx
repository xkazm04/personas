import type { ReactNode } from 'react';

// -- Semantic status variants -----------------------------------------------

export type StatusVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'processing';

// -- Accent colors (matches Button AccentColor) ----------------------------

export type BadgeAccent =
  | 'cyan' | 'purple' | 'violet' | 'emerald' | 'amber' | 'blue'
  | 'rose' | 'sky' | 'teal' | 'indigo' | 'orange' | 'pink' | 'lime'
  | 'red' | 'slate';

// -- Size ------------------------------------------------------------------

export type BadgeSize = 'sm' | 'md';

// -- Style maps ------------------------------------------------------------

const VARIANT_CLASSES: Record<StatusVariant, string> = {
  success:    'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  warning:    'bg-amber-500/10 text-amber-400 border-amber-500/20',
  error:      'bg-red-500/10 text-red-400 border-red-500/20',
  info:       'bg-blue-500/10 text-blue-400 border-blue-500/20',
  neutral:    'bg-secondary/40 text-foreground border-border/50',
  processing: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
};

const ACCENT_CLASSES: Record<BadgeAccent, string> = {
  cyan:    'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  purple:  'bg-purple-500/10 text-purple-400 border-purple-500/20',
  violet:  'bg-violet-500/10 text-violet-400 border-violet-500/20',
  emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  amber:   'bg-amber-500/10 text-amber-400 border-amber-500/20',
  blue:    'bg-blue-500/10 text-blue-400 border-blue-500/20',
  rose:    'bg-rose-500/10 text-rose-400 border-rose-500/20',
  sky:     'bg-sky-500/10 text-sky-400 border-sky-500/20',
  teal:    'bg-teal-500/10 text-teal-400 border-teal-500/20',
  indigo:  'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  orange:  'bg-orange-500/10 text-orange-400 border-orange-500/20',
  pink:    'bg-pink-500/10 text-pink-400 border-pink-500/20',
  lime:    'bg-lime-500/10 text-lime-400 border-lime-500/20',
  red:     'bg-red-500/10 text-red-400 border-red-500/20',
  slate:   'bg-secondary/40 text-foreground border-border/50',
};

const SIZE_CLASSES: Record<BadgeSize, string> = {
  sm: 'px-1.5 py-0.5 text-[10px]',
  md: 'px-2 py-0.5 text-xs',
};

// -- Props -----------------------------------------------------------------

interface StatusBadgeBaseProps {
  children: ReactNode;
  /** Optional leading icon. */
  icon?: ReactNode;
  /** Badge size. Default: 'md'. */
  size?: BadgeSize;
  /** Use rounded-full (pill) instead of rounded-lg. */
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
  pill = false,
  className = '',
  title,
}: StatusBadgeProps) {
  const colorClasses = variant ? VARIANT_CLASSES[variant] : ACCENT_CLASSES[accent!];
  const isPulsing = variant === 'processing';

  return (
    <span
      className={[
        'inline-flex items-center gap-1 border font-medium',
        colorClasses,
        SIZE_CLASSES[size],
        pill ? 'rounded-full' : 'rounded-lg',
        className,
      ].filter(Boolean).join(' ')}
      title={title}
    >
      {isPulsing && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500" />
        </span>
      )}
      {icon && <span className="flex-shrink-0">{icon}</span>}
      {children}
    </span>
  );
}
