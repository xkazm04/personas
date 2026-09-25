import type { Glyph, Tone } from './types';

/**
 * Mark: a status node that sits ON the spine at --spine-x. Status is carried here, never by a
 * trailing label; `label` is the accessible name.
 */
export function Mark({ tone = 'neutral', glyph = 'solid', label }: { tone?: Tone; glyph?: Glyph; label: string }) {
  return <span className={`k-mark t-${tone} g-${glyph}`} role="img" aria-label={label} />;
}

/** Dot: the same glyph inline (legends, chips, key-value draws). */
export function Dot({ tone = 'neutral', glyph = 'solid' }: { tone?: Tone; glyph?: Glyph }) {
  return <span className={`k-mark k-dot t-${tone} g-${glyph}`} aria-hidden="true" />;
}
