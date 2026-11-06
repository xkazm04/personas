import type { ReactNode } from 'react';

/** A keycap of the Standup keymap (the key legend), on the label tier (nothing below 0.875rem). */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="su-kbd typo-label">{children}</kbd>;
}
