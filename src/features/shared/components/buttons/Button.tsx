import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

// ── Variant + Size types ──────────────────────────────────────

export type ButtonVariant =
  | 'primary'    // Filled accent — main CTA
  | 'secondary'  // Bordered, subtle fill on hover
  | 'ghost'      // No border/bg, text-only + hover fill
  | 'danger'     // Red destructive action
  | 'accent'     // Colored tint (uses accentColor prop)
  | 'link';      // Inline text link style, no padding

export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'icon-sm' | 'icon-md' | 'icon-lg';

// ── Style maps ────────────────────────────────────────────────

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-btn-primary text-white hover:bg-btn-primary/90 shadow-sm hover:shadow-md active:scale-[0.98]',
  secondary:
    'border border-border bg-secondary/40 text-foreground/90 hover:bg-secondary/70 hover:border-border/80 active:scale-[0.98]',
  ghost:
    'text-muted-foreground hover:text-foreground hover:bg-secondary/50 active:bg-secondary/70',
  danger:
    'bg-red-600/90 text-white hover:bg-red-600 border border-red-500/30 shadow-sm active:scale-[0.98]',
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

// ── Props ─────────────────────────────────────────────────────

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** For 'accent' variant — provide a Tailwind color stem, e.g. "violet", "emerald" */
  accentColor?: string;
  /** Optional left icon */
  icon?: ReactNode;
  /** Optional right icon */
  iconRight?: ReactNode;
  /** Full width */
  block?: boolean;
  /** Show loading spinner */
  loading?: boolean;
}

// ── Component ─────────────────────────────────────────────────

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
      className = '',
      children,
      type = 'button',
      ...rest
    },
    ref,
  ) => {
    const isDisabled = disabled || loading;

    // Build accent classes dynamically
    // Note: text-*-400 colors are corrected to 600/700 on light themes via CSS overrides in globals.css
    let accentClasses = '';
    if (variant === 'accent' && accentColor) {
      accentClasses = `border-${accentColor}-500/25 bg-${accentColor}-500/10 text-${accentColor}-400 hover:bg-${accentColor}-500/20 font-semibold`;
    }

    const classes = [
      'inline-flex items-center font-medium transition-all',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background',
      VARIANT_CLASSES[variant],
      variant === 'accent' ? accentClasses : '',
      SIZE_CLASSES[size],
      block ? 'w-full justify-center' : '',
      isDisabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : 'cursor-pointer',
      className,
    ]
      .filter(Boolean)
      .join(' ');

    return (
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
  },
);

Button.displayName = 'Button';

export default Button;
