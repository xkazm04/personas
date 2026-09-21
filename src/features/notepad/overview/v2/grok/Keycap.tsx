import type { ReactNode } from 'react';

/** Physical key glyph — a label on the desk, never a native `kbd` tooltip. */
export function Keycap({ children, large = false }: { children: ReactNode; large?: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-flex items-center justify-center min-w-5 px-1 rounded-input border border-primary/20 bg-secondary/50 text-foreground/85 leading-none ${
        large ? 'h-6 typo-label' : 'h-5 typo-label'
      }`}
    >
      {children}
    </span>
  );
}
