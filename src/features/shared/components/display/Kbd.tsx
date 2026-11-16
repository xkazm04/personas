import type { ReactNode } from 'react';

export interface KbdProps {
  children: ReactNode;
  /** Sits on a solid primary control: the cap takes the control's own ink. */
  solid?: boolean;
}

/**
 * Kbd: a keycap, a mono glyph in a hairline box with a 2px foot.
 * @catalog Kbd - a keycap (mono, hairline, 2px foot); `solid` for a cap on the primary control.
 */
export function Kbd({ children, solid = false }: KbdProps) {
  return (
    <kbd
      className={[
        'typo-code inline-flex h-5 min-w-5 flex-none items-center justify-center rounded-interactive border border-b-2 px-1 leading-none',
        solid ? 'border-btn-primary-fg/40 bg-btn-primary-fg/15 text-btn-primary-fg' : 'border-hair-2 bg-background text-ink-2',
      ].join(' ')}
    >
      {children}
    </kbd>
  );
}
