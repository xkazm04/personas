/**
 * Detect the structured `## Sources` provenance section an agent appends to its
 * `user_message` when reporting figures (UAT P7 — F-NO-PROVENANCE; the protocol
 * requires it via DATA_HONESTY_INVARIANT rule 3). Lets the UI surface whether a
 * reported number can be traced to its origin, and flag the gap when a report
 * carries figures but no sources — without the parser hard-rejecting a free-form
 * deliverable (which would break legitimate runs that genuinely have no source).
 */
export interface MessageProvenance {
  /** Count of cited sources under a trailing Sources / Provenance / Citations heading. */
  sourceCount: number;
  /** Whether the report appears to contain figures/claims (so sources are expected). */
  hasFigures: boolean;
}

// A line that is a "Sources" heading: markdown heading (`## Sources`), bold
// (`**Sources**`), or a bare label (`Sources:`). Case-insensitive, per line.
const SOURCES_HEADING = /^[ \t]{0,3}(?:#{1,6}[ \t]+|\*\*[ \t]*)?(sources|provenance|citations)\b\**:?[ \t]*$/im;
// Conservative figure signal: currency, a percentage, or a 2+ digit number.
const FIGURE_SIGNAL = /[$€£]\s?\d|\d+(?:\.\d+)?\s?%|\d{2,}/;
// A bullet (`-`/`*`/`+`) or numbered (`1.`) list item with real content.
const LIST_ITEM = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\S/gm;

export function analyzeProvenance(content: string | undefined | null): MessageProvenance {
  if (!content) return { sourceCount: 0, hasFigures: false };
  const hasFigures = FIGURE_SIGNAL.test(content);

  const m = SOURCES_HEADING.exec(content);
  if (!m) return { sourceCount: 0, hasFigures };

  // Take everything after the heading line, stop at the next markdown heading.
  const after = content.slice(m.index + m[0].length);
  const section = after.split(/\n[ \t]{0,3}#{1,6}[ \t]+/)[0] ?? after;
  const sourceCount = (section.match(LIST_ITEM) ?? []).length;
  return { sourceCount, hasFigures };
}
