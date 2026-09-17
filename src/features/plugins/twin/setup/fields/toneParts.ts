/**
 * The one place the two representations of a tone list meet.
 *
 * `twin_tones.examples_json` and `constraints_json` hold a JSON ARRAY OF
 * STRINGS (`["lowercase, no emoji"]`) and that is the stored format — nothing
 * here changes it. A person, however, writes three examples as three blocks
 * separated by a blank line, so the typed surface shows them that way and these
 * two functions convert between the two on the way in and on the way out.
 *
 * `blocksOfJson` is deliberately forgiving: a column holding something other
 * than an array of strings (hand-edited, imported, or written by an older
 * build) is shown VERBATIM rather than discarded, so nothing a user typed
 * disappears because a parse failed. The next save then rewrites it in the
 * canonical shape, which is the only moment the format is ever normalized.
 */

import { safeJsonParse } from '@/lib/utils/parseJson';

/** Stored JSON array -> the blank-line separated text the textarea shows. */
export function blocksOfJson(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  // `safeJsonParse` rather than a try/catch: a column that is not JSON is an
  // expected input here, not a failure to report, and the tuple says so without
  // a catch block that would have to justify swallowing something.
  const [parsed] = safeJsonParse(trimmed);
  if (Array.isArray(parsed)) {
    return parsed
      .map((item) => (typeof item === 'string' ? item : JSON.stringify(item)))
      .filter((item) => item.trim().length > 0)
      .join('\n\n');
  }
  // Not an array. Showing the raw column beats showing an empty box: the user
  // can see what is stored and correct it, and the next save normalizes it.
  return trimmed;
}

/** The textarea's blocks -> the stored JSON array. Empty text clears the column. */
export function jsonOfBlocks(text: string): string {
  const blocks = text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
  return blocks.length === 0 ? '' : JSON.stringify(blocks);
}

/** Words in a free-text field, for the biography's running count. */
export function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}
