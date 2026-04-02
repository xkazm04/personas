import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Tooltip } from '../display/Tooltip';

// -- Variant + Size types --------------------------------------

export type ButtonVariant =
  | 'primary'    // Filled accent -- main CTA
  | 'secondary'  // Bordered, subtle fill on hover
  | 'ghost'      // No border/bg, text-only + hover fill
  | 'danger'     // Red destructive action
  | 'accent'     // Colored tint (uses accentColor prop)
  | 'link';      // Inline text link style, no padding

export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'icon-sm' | 'icon-md' | 'icon-lg';

// -- Style maps ------------------------------------------------

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'brightness-lock bg-btn-primary text-white hover:bg-btn-primary/90 shadow-elevation-1 hover:shadow-elevation-2 active:scale-[0.98]',
  secondary:
    'border border-border bg-secondary/40 text-foreground/90 hover:bg-secondary/70 hover:border-border/80 active:scale-[0.98]',
  ghost:
    'text-muted-foreground hover:text-foreground hover:bg-secondary/50 active:bg-secondary/70',
  danger:
    'brightness-lock bg-red-600/90 text-white hover:bg-red-600 border border-red-500/30 shadow-elevation-1 active:scale-[0.98]',
  accent:
    'border text-foreground/90 active:scale-[0.98]',
  link:
    'text-primary hover:text-primary/80 underline-offset-2 hover:underline p-0 h-auto rounded-none',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  xs:       'px-2 py-0.5 text-xs rounded-md gap-1',
  sm:       'px-2.5 py-1 text-xs rounded-lg gap-1.5',
  md:       'px-3.5 py-1.5 text-sm rounded-xl gap-2',
  lg:       'px-5 py-2.5 text-sm rounded-xl gap-2.5',
  'icon-sm': 'w-7 h-7 rounded-lg p-0 justify-center',
  'icon-md': 'w-9 h-9 rounded-xl p-0 justify-center',
  'icon-lg': 'w-11 h-11 rounded-xl p-0 justify-center',
};

// -- Props -----------------------------------------------------

export type AccentColor =
  | 'cyan' | 'purple' | 'violet' | 'emerald' | 'amber' | 'blue'
  | 'rose' | 'sky' | 'teal' | 'indigo' | 'orange' | 'pink' | 'lime';

const ACCENT_CLASSES: Record<AccentColor, string> = {
  cyan:    'border-cyan-500/25 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20',
  purple:  'border-purple-500/25 bg-purple-500/10 text-purple-400 hover:bg-purple-500/20',
  violet:  'border-violet-500/25 bg-violet-500/10 text-violet-400 hover:bg-violet-500/20',
  emerald: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20',
  amber:   'border-amber-500/25 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20',
  blue:    'border-blue-500/25 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20',
  rose:    'border-rose-500/25 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20',
  sky:     'border-sky-500/25 bg-sky-500/10 text-sky-400 hover:bg-sky-500/20',
  teal:    'border-teal-500/25 bg-teal-500/10 text-teal-400 hover:bg-teal-500/20',
  indigo:  'border-indigo-500/25 bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20',
  orange:  'border-orange-500/25 bg-orange-500/10 text-orange-400 hover:bg-orange-500/20',
  pink:    'border-pink-500/25 bg-pink-500/10 text-pink-400 hover:bg-pink-500/20',
  lime:    'border-lime-500/25 bg-lime-500/10 text-lime-400 hover:bg-lime-500/20',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** For 'accent' variant -- provide a Tailwind color stem, e.g. "violet", "emerald" */
  accentColor?: AccentColor;
  /** Optional left icon */
  icon?: ReactNode;
  /** Optional right icon */
  iconRight?: ReactNode;
  /** Full width */
  block?: boolean;
  /** Show loading spinner */
  loading?: boolean;
  /** Tooltip shown when the button is disabled, explaining why */
  disabledReason?: string;
}

// -- Component -------------------------------------------------

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'secondary',
      size = 'md',
      accentColor,
      icon,
      iconRight,
      block,
      loading,
      disabled,
      disabledReason,
      className = '',
      children,
      type = 'button',
      ...rest
    },
    ref,
  ) => {
    const isDisabled = disabled || loading;
    const showReason = isDisabled && !!disabledReason;

    // Look up accent classes from static map (ensures Tailwind can detect them during purging)
    // Note: text-*-400 colors are corrected to 600/700 on light themes via CSS overrides in globals.css
    const accentClasses = variant === 'accent' && accentColor
      ? `${ACCENT_CLASSES[accentColor] ?? ''} font-semibold`
      : '';

    const classes = [
      'inline-flex items-center font-medium transition-all',
      'focus-ring',
      VARIANT_CLASSES[variant],
      variant === 'accent' ? accentClasses : '',
      SIZE_CLASSES[size],
      block ? 'w-full justify-center' : '',
      // When disabledReason is present, skip pointer-events-none so the tooltip can trigger on hover
      isDisabled
        ? showReason
          ? 'opacity-50 cursor-not-allowed'
          : 'opacity-50 cursor-not-allowed pointer-events-none'
        : 'cursor-pointer',
      className,
    ]
      .filter(Boolean)
      .join(' ');

    const btn = (
      <button ref={ref} type={type} disabled={isDisabled} className={classes} {...rest}>
        {loading ? (
          <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-25" />
            <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
          </svg>
        ) : icon ? (
          <span className="flex-shrink-0">{icon}</span>
        ) : null}
        {children}
        {iconRight && <span className="flex-shrink-0">{iconRight}</span>}
      </button>
    );

    if (showReason) {
      return <Tooltip content={disabledReason} placement="top" delay={200}>{btn}</Tooltip>;
    }

    return btn;
  },
);

Button.displayName = 'Button';

export default Button;
