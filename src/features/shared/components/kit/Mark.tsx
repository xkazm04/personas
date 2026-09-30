import type { Glyph, Tone } from './types';

/**
 * Mark: a status node that sits ON the spine at --spine-x. Status is carried here, never by a
 * trailing label; `label` is the accessible name.
 * @catalog Mark - the status node on the spine (Tone x Glyph); Dot is the same glyph inline. Kit.
 */
export function Mark({ tone = 'neutral', glyph = 'solid', label, ...host }: {
  tone?: Tone;
  glyph?: Glyph;
  label: string;
  /** Forwarded for a Hint: the description and, when standalone, the tab stop. */
  'aria-describedby'?: string;
  tabIndex?: number;
}) {
  return <span className={`k-mark t-${tone} g-${glyph}`} role="img" aria-label={label} {...host} />;
}

/** Dot: the same glyph inline (legends, chips, key-value draws).
 * @catalog Dot - a status glyph inline (legends, chips, key-value draws). Kit.
 */
export function Dot({ tone = 'neutral', glyph = 'solid' }: { tone?: Tone; glyph?: Glyph }) {
  return <span className={`k-mark k-dot t-${tone} g-${glyph}`} aria-hidden="true" />;
}
