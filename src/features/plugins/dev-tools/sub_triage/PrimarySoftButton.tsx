import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { PRIMARY_SOFT } from './triageTones';

/**
 * The rules panel's soft primary action (Add rule, Run rules, Save), in the
 * theme's own primary, which it always used.
 *
 * style-deviation: a raw <button>, not the shared Button. Button's tones are
 * statuses and roles; `highlight` is teal where light's primary is blue, and
 * `variant="accent"` without a tone paints `text-foreground/90`, which the
 * unlayered `[data-theme^="light"] .text-foreground\/90` repair forces over any
 * `text-primary` beside it (measured: light rendered this label in foreground
 * ink). A primary tone on Button is the missing variant (Gate 2 retro).
 */
export function PrimarySoftButton({ icon, size = 'sm', className = '', children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: ReactNode;
  size?: 'xs' | 'sm';
}) {
  const pad = size === 'xs' ? 'px-2 py-0.5 typo-label' : 'px-2.5 py-1 typo-caption';
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex items-center gap-1 rounded-interactive border transition-colors focus-ring ${pad} ${PRIMARY_SOFT} ${className}`}
    >
      {icon}
      {children}
    </button>
  );
}
