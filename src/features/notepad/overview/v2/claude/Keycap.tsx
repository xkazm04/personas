import type { ReactNode } from 'react';

/**
 * One key, drawn as a keycap. Purely decorative for sighted users — every
 * place that renders one also names the action in words — so it is hidden from
 * the accessibility tree by default.
 */
export function Keycap({
  children,
  tone = 'default',
  className = '',
}: {
  children: ReactNode;
  /** `accent` for the key the current context most wants pressed. */
  tone?: 'default' | 'accent' | 'warning';
  className?: string;
}) {
  const toneClass =
    tone === 'accent'
      ? 'border-primary/40 bg-primary/15 text-primary'
      : tone === 'warning'
        ? 'border-status-warning/40 bg-status-warning/15 text-status-warning'
        : 'border-primary/15 bg-secondary/40 text-foreground/85';
  return (
    <kbd
      aria-hidden
      className={`inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-interactive border border-b-2 typo-code ${toneClass} ${className}`}
    >
      {children}
    </kbd>
  );
}
