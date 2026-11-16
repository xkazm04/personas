/**
 * The page's own small parts: a mono keycap, a ghost press with a key hint,
 * the one solid accent press, and Figs (prose whose numbers set in mono).
 */
import type { ReactNode } from 'react';

import { Button, type ButtonProps } from '@/features/shared/components/buttons';

/** A keycap: mono glyph in a hairline box; `solid` sits on the accent press. */
export function Key({ children, solid = false }: { children: ReactNode; solid?: boolean }) {
  return <kbd className={`sc-key ${solid ? 'is-solid' : ''}`}>{children}</kbd>;
}

type PressProps = Omit<ButtonProps, 'children' | 'variant' | 'size' | 'tone' | 'loading' | 'icon'> & {
  k?: ReactNode;
  icon?: ReactNode;
  busy?: boolean;
  tone?: 'ghost' | 'line' | 'solid';
  children?: ReactNode;
};

/**
 * A tight press on the shared Button. Ghost by default (no fill until hover),
 * `line` adds a hairline, `solid` is the page's single accent control; the
 * `.sc-press` rules (standup-page.css) draw it. A busy press holds still: it
 * dims and announces itself (aria-busy, no `loading`), it never spins.
 */
export function Press({ k, icon, busy = false, tone = 'ghost', children, className = '', onClick, disabled, ...rest }: PressProps) {
  const key = k !== undefined ? <Key solid={tone === 'solid'}>{k}</Key> : undefined;
  return (
    <Button
      {...rest}
      variant="ghost"
      size="sm"
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      className={`sc-press sc-press--${tone} ${className}`}
      icon={icon && key ? <>{icon}{key}</> : (icon ?? key)}
      onClick={(e) => { e.stopPropagation(); onClick?.(e); }}
    >
      {children !== undefined ? <span className="sc-press__label">{children}</span> : undefined}
    </Button>
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
