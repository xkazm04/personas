// RecapField — one labelled line of the session recap.
//
// Extracted so `SessionRecapModal` stays a list of WHAT it shows rather than a
// wall of repeated label/value markup. Two shapes, because the panel genuinely
// has two: a plain string (the common case) and arbitrary children (a value
// that carries a `RelativeTime` next to it).
//
// `emphasis` is the recap prose itself — Claude's own summary, or the trailing
// assistant turn. It reads a token larger than the provenance fields under it
// because it is the thing the operator opened this panel for. It steps UP a
// typography token rather than adding `font-semibold`, which is a silent no-op
// against an unlayered `typo-*` in this repo.

import type { ReactNode } from 'react';

/** Rendered when a field's value is absent. Never an empty line, never a "0" —
 *  a recap that shows nothing where a fact should be is a claim about the
 *  session, and it would be the wrong one. */
const ABSENT = '—';

export interface RecapFieldProps {
  label: string;
  /**
   * The plain-string form. Ignored when `children` is given.
   *
   * NULLABLE ON PURPOSE (`metric-tile.md`): a recap field can genuinely have
   * nothing to show — a session with no state reason, no OSC title, no
   * transcript — and that has to be expressible HERE rather than destroyed by
   * every caller into an empty string. The render arm for it is `ABSENT`.
   */
  value?: string | null;
  children?: ReactNode;
  emphasis?: boolean;
}

export function RecapField({ label, value, children, emphasis }: RecapFieldProps) {
  const absent = value == null || value.trim() === '';
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="typo-caption text-foreground opacity-45">{label}</span>
      {children ?? (
        <p
          className={`whitespace-pre-wrap break-words ${
            absent
              ? 'typo-caption text-foreground opacity-40'
              : emphasis
                ? 'typo-body text-foreground'
                : 'typo-caption text-foreground opacity-80'
          }`}
        >
          {absent ? ABSENT : value}
        </p>
      )}
    </div>
  );
}

export default RecapField;
