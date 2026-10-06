import type { ReactNode } from 'react';

/** A keycap. Inert, aria-hidden: the key is also named by the control it sits on. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="p1-kbd typo-code" aria-hidden>{children}</kbd>;
}

/** One legend entry: keycaps then a quiet word. */
export function KeyHint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      {keys.map((k) => <Kbd key={k}>{k}</Kbd>)}
      <span className="typo-caption">{label}</span>
    </span>
  );
}
