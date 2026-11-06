import type { ReactNode } from 'react';

/** A keycap from the B/1 keymap, on the label tier (nothing below 0.875rem). */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="su-kbd typo-label">{children}</kbd>;
}

/** "<key> what it does", the inline legend under a row and in the footer. */
export function KeyAct({ k, children }: { k: ReactNode; children: ReactNode }) {
  return (
    <span className="typo-caption">
      <Kbd>{k}</Kbd>
      {children}
    </span>
  );
}
