/**
 * The console's own small parts: a mono keycap, a ghost press with a key hint,
 * the one solid accent press, and Figs (prose whose numbers set in mono).
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';

/** A keycap: mono glyph in a hairline box; `solid` sits on the accent press. */
export function Key({ children, solid = false }: { children: ReactNode; solid?: boolean }) {
  return <kbd className={`sc-key ${solid ? 'is-solid' : ''}`}>{children}</kbd>;
}

type PressProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  k?: ReactNode;
  icon?: ReactNode;
  busy?: boolean;
  tone?: 'ghost' | 'line' | 'solid';
  children?: ReactNode;
};

/**
 * A tight press. Ghost by default (no fill until hover), `line` adds a hairline,
 * `solid` is the page's single accent control. A busy press holds still: it
 * dims and announces itself, it never spins.
 */
export function Press({ k, icon, busy = false, tone = 'ghost', children, className = '', onClick, ...rest }: PressProps) {
  return (
    <button
      type="button"
      {...rest}
      aria-busy={busy || undefined}
      disabled={rest.disabled || busy}
      className={`sc-press sc-press--${tone} ${className}`}
      onClick={(e) => { e.stopPropagation(); onClick?.(e); }}
    >
      {icon}
      {k !== undefined && <Key solid={tone === 'solid'}>{k}</Key>}
      {children !== undefined && <span className="sc-press__label">{children}</span>}
    </button>
  );
}

const NUM = /(\d+(?:[:.-]\d+)*%?)/;

/** Prose with every figure set in the mono face (tabular, crisp) and the words left in Inter. */
export function Figs({ text }: { text: string }) {
  return (
    <>
      {text.split(NUM).map((part, i) => (i % 2 === 1 ? <span key={i} className="sc-num">{part}</span> : part))}
    </>
  );
}
