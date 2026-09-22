/**
 * Pure reading of a long-form document for `DocumentSurface` — no React, no IO.
 *
 * A "document" here is an ordered list of authored sections. The surface needs
 * three things this file computes and nothing else does: the BLOCKS a section
 * splits into (so a click can land on one paragraph rather than the whole
 * section), each section's WEIGHT (so a navigation rail can be drawn to scale
 * rather than as equal-height rows), and a stable BLOCK ID.
 *
 * Splitting is deliberately blank-line-based and never rewrites its input. The
 * surface edits a section as ONE markdown string and saves it whole, so blocks
 * are a reading and pointing convenience, not a storage format — nothing here
 * is ever serialised back. That is what keeps this splitter from being able to
 * lose a heading marker or an indent the way a round-tripping HTML editor can.
 */

/** Who wrote a section, and therefore who may change it. */
export type DocumentAuthor = 'you' | 'agent' | 'neither';

export interface DocumentSection {
  /** Stable within one document; used for keys, tab targets and rail bands. */
  id: string;
  heading: string;
  /** The section's markdown, verbatim. Empty is legal and renders as a hint. */
  body: string;
  author: DocumentAuthor;
  /**
   * Whether the operator may type into this section. Independent of `author`
   * on purpose: a surface may show a section as yours and still lock it while
   * a save is in flight.
   */
  editable: boolean;
  /** How many changes are waiting on this section; drawn on the tab and rail. */
  pendingCount?: number;
}

/** One pointable run of text inside a section. */
export interface DocumentBlock {
  /** `<sectionId>:<index>` — stable while the body is unchanged. */
  id: string;
  /** Index within the section, in file order. */
  index: number;
  /** The block's markdown, trimmed of trailing whitespace only. */
  text: string;
  /** A `#`-prefixed line leads the block, so it reads as a divider. */
  isHeading: boolean;
  /**
   * Character offset of the block's first character within the section body.
   *
   * This is what lets a click on a paragraph become a caret in that paragraph
   * when the editor opens on the whole section. Computed from line lengths
   * rather than `indexOf`, which would land on the wrong copy of a repeated
   * line — and repeated lines are ordinary in a document that grows by
   * appending one short entry at a time.
   */
  offset: number;
}

const HEADING = /^\s{0,3}#{1,6}\s+\S/;

/**
 * Split a section body into blocks on blank lines.
 *
 * A fenced code block is kept whole even when it contains blank lines, because
 * a click that lands "inside" a fence and a save that re-joined the halves
 * would be two different ideas of where the block ends.
 */
export function splitBlocks(sectionId: string, body: string): DocumentBlock[] {
  const lines = body.replace(/\s+$/, '').split(/\r?\n/);
  const out: DocumentBlock[] = [];
  let buffer: string[] = [];
  let bufferOffset = 0;
  let cursor = 0;
  let fenced = false;

  const flush = () => {
    const joined = buffer.join('\n');
    const lead = joined.length - joined.replace(/^\n+/, '').length;
    const text = joined.replace(/^\n+/, '').replace(/\s+$/, '');
    buffer = [];
    if (!text) return;
    out.push({
      id: `${sectionId}:${out.length}`,
      index: out.length,
      text,
      isHeading: HEADING.test(text.split('\n')[0] ?? ''),
      offset: bufferOffset + lead,
    });
  };

  for (const line of lines) {
    if (/^\s{0,3}```/.test(line)) fenced = !fenced;
    if (!fenced && line.trim() === '') {
      flush();
      cursor += line.length + 1;
      continue;
    }
    if (buffer.length === 0) bufferOffset = cursor;
    buffer.push(line);
    cursor += line.length + 1;
  }
  flush();
  return out;
}

/**
 * Non-empty line count — what a rail band's height is drawn from.
 *
 * Blank lines are excluded so that a section padded with whitespace does not
 * claim more of the rail than a denser one that says more.
 */
export function weightOf(body: string): number {
  return body.split(/\r?\n/).filter((l) => l.trim() !== '').length;
}

/**
 * Band heights as percentages that always sum to 100, with a floor so a
 * one-line section stays clickable next to a two-thousand-line one.
 *
 * Returns percentages rather than pixels because the rail is a flex column
 * whose height is the viewport's, and because the app's text scale is a user
 * setting — a pixel computed here would be wrong at four of the five scales.
 */
export function railBands(sections: readonly DocumentSection[], minPercent = 6): number[] {
  if (sections.length === 0) return [];
  const weights = sections.map((s) => Math.max(1, weightOf(s.body)));
  const total = weights.reduce((a, b) => a + b, 0);
  const floor = Math.min(minPercent, 100 / sections.length);
  const raw = weights.map((w) => Math.max(floor, (w / total) * 100));
  const rawTotal = raw.reduce((a, b) => a + b, 0);
  return raw.map((v) => (v / rawTotal) * 100);
}
