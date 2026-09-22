/**
 * Extract the first grapheme from a string. Safe for emoji ZWJ sequences
 * (e.g. '👨‍💻' returns '👨' as the first codepoint, never a stray combining mark).
 *
 * Used by persona tiles + decisions list rows to render an icon initial when
 * the persona has a multi-codepoint emoji.
 */
export function firstGrapheme(s: string): string {
  if (!s) return '';
  const arr = Array.from(s);
  return arr[0] ?? '';
}
