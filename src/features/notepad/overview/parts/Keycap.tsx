import type { ReactNode } from 'react';

/**
 * The legends printed on the physical keys the desk answers to. These are
 * glyphs, not copy: a keycap reads `Esc` or `/` in every locale, the same way
 * the keyboard under the operator's hands does, so they never enter the i18n
 * catalogs. Everything a key DOES is translated (`t.notepad.desk_*`).
 */
export const DESK_KEY = {
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  arrows: '↑↓←→',
  enter: 'Enter',
  enterGlyph: '↵',
  escape: 'Esc',
  del: 'Del',
  home: 'Home',
  end: 'End',
  find: '/',
  help: '?',
  bracketOpen: '[',
  bracketClose: ']',
  rail1: '1',
  rail2: '2',
  rail3: '3',
  rails: '1–3',
  projectJump: '⇧1–9',
  h: 'h',
  j: 'j',
  k: 'k',
  l: 'l',
  ask: 'a',
  publish: 'p',
  goals: 'g',
  thread: 't',
  reply: 'r',
  approve: 'y',
  reject: 'n',
} as const;

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
