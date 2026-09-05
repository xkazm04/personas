/**
 * Pure selection-surgery helpers behind the markdown toolbar and its
 * shortcuts.
 *
 * They are pure — `(value, start, end) => { value, caretStart, caretEnd }` —
 * because caret arithmetic is exactly the code that breaks silently and loses
 * a sentence, and a pure function is the only shape of it a test can pin
 * without a DOM.
 */

export interface EditResult {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

/** Wrap (or unwrap) the selection in a symmetric marker like `**` or `` ` ``. */
export function toggleWrap(value: string, start: number, end: number, marker: string): EditResult {
  const selected = value.slice(start, end);
  const len = marker.length;

  // Markers sit just OUTSIDE the selection — the user selected the words and
  // pressed the key a second time.
  if (value.slice(start - len, start) === marker && value.slice(end, end + len) === marker) {
    return {
      value: value.slice(0, start - len) + selected + value.slice(end + len),
      selectionStart: start - len,
      selectionEnd: start - len + selected.length,
    };
  }
  // Markers are INSIDE the selection — the user selected `**word**`.
  if (selected.length >= len * 2 && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(len, -len);
    return {
      value: value.slice(0, start) + inner + value.slice(end),
      selectionStart: start,
      selectionEnd: start + inner.length,
    };
  }
  // Nothing selected still wraps, leaving the caret between the markers, so the
  // key reads as "start typing bold" and not only "bold what I already wrote".
  return {
    value: `${value.slice(0, start)}${marker}${selected}${marker}${value.slice(end)}`,
    selectionStart: start + len,
    selectionEnd: start + len + selected.length,
  };
}

/** Start of the line containing `pos`. */
function lineStartAt(value: string, pos: number): number {
  return value.lastIndexOf('\n', pos - 1) + 1;
}

/** End of the line containing `pos` (exclusive of the newline). */
function lineEndAt(value: string, pos: number): number {
  const idx = value.indexOf('\n', pos);
  return idx === -1 ? value.length : idx;
}

/**
 * Apply a per-line transform across every line the selection touches.
 * Selection is re-anchored over the rewritten block, so a multi-line list
 * conversion leaves the same text selected.
 */
export function mapLines(
  value: string,
  start: number,
  end: number,
  fn: (line: string, index: number) => string,
): EditResult {
  const from = lineStartAt(value, start);
  const to = lineEndAt(value, end);
  const block = value.slice(from, to);
  const next = block.split('\n').map(fn).join('\n');
  return {
    value: value.slice(0, from) + next + value.slice(to),
    selectionStart: from,
    selectionEnd: from + next.length,
  };
}

/** Strip any leading block marker (heading hashes, bullet, number, quote,
 *  checklist) so the markers stay mutually exclusive rather than stacking. */
function stripBlockMarker(line: string): { indent: string; rest: string } {
  const m = /^(\s*)(?:#{1,6}\s+|[-*]\s+\[[ xX]\]\s+|[-*]\s+|\d+\.\s+|>\s+)?(.*)$/.exec(line);
  return { indent: m?.[1] ?? '', rest: m?.[2] ?? line };
}

/** Toggle an ATX heading of the given level on every touched line. */
export function toggleHeading(value: string, start: number, end: number, level: 1 | 2 | 3): EditResult {
  const hashes = '#'.repeat(level);
  const from = lineStartAt(value, start);
  const firstLine = value.slice(from, lineEndAt(value, start));
  const already = new RegExp(`^\\s*${hashes} `).test(firstLine);
  return mapLines(value, start, end, (line) => {
    const { indent, rest } = stripBlockMarker(line);
    return already ? `${indent}${rest}` : `${indent}${hashes} ${rest}`;
  });
}

export type ListKind = 'bullet' | 'numbered' | 'checklist' | 'quote';

const LIST_PREFIX: Record<ListKind, (index: number) => string> = {
  bullet: () => '- ',
  numbered: (i) => `${i + 1}. `,
  checklist: () => '- [ ] ',
  quote: () => '> ',
};

const LIST_TEST: Record<ListKind, RegExp> = {
  bullet: /^\s*[-*] (?!\[[ xX]\])/,
  numbered: /^\s*\d+\. /,
  checklist: /^\s*[-*] \[[ xX]\] /,
  quote: /^\s*> /,
};

/** Toggle a line-prefix block (list / checklist / quote) across the selection. */
export function toggleList(value: string, start: number, end: number, kind: ListKind): EditResult {
  const firstLine = value.slice(lineStartAt(value, start), lineEndAt(value, start));
  const already = LIST_TEST[kind].test(firstLine);
  return mapLines(value, start, end, (line, i) => {
    const { indent, rest } = stripBlockMarker(line);
    return already ? `${indent}${rest}` : `${indent}${LIST_PREFIX[kind](i)}${rest}`;
  });
}
