/**
 * Pure reading of a long-form document for `DocumentSurface` — no React, no IO.
 *
 * A "document" here is an ordered list of authored sections. The surface needs
 * three things this file computes and nothing else does: the BLOCKS a section
 * splits into (so a click can land on one row rather than the whole section),
 * each section's WEIGHT (so a navigation rail can be drawn to scale rather than
 * as equal-height rows), and a stable BLOCK ID.
 *
 * GRANULARITY IS THE ROW, NOT THE PARAGRAPH. A heading line is a block, a
 * paragraph is a block, and EVERY LIST ITEM is its own block. The contest
 * winner this surface was promoted from (and the variant the owner named for
 * its row focus) both point at single bullet lines, and a manifest is mostly
 * bullets; splitting on blank lines alone made a click on one bullet select the
 * whole list, which is the regression the owner caught.
 *
 * Splitting never rewrites its input. The surface edits a section as ONE
 * markdown string and saves it whole, so blocks are a reading and pointing
 * convenience, not a storage format — nothing here is ever serialised back.
 * That is what keeps this splitter from being able to lose a heading marker or
 * an indent the way a round-tripping HTML editor can.
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

export type DocumentBlockKind = 'heading' | 'paragraph' | 'item' | 'code';

/** One pointable row of text inside a section. */
export interface DocumentBlock {
  /** `<sectionId>:<index>` — stable while the body is unchanged. */
  id: string;
  /** Index within the section, in file order. */
  index: number;
  kind: DocumentBlockKind;
  /** The block's markdown, verbatim, trailing whitespace trimmed. */
  text: string;
  /**
   * For an `item`, the text after its list marker, ready to render as inline
   * content. For every other kind, identical to `text`.
   */
  content: string;
  /** For an `item`: its leading indent in spaces, so nesting survives display. */
  indent: number;
  /** For an `item`: the marker as written (`-`, `*`, `1.`), else ''. */
  marker: string;
  /** Heading depth for a `heading` (1-6), else 0. */
  depth: number;
  /**
   * Character offset of the block's first character within the section body.
   *
   * This is what lets a click on a row become a caret in that row when the
   * editor opens on the whole section. Computed from line lengths rather than
   * `indexOf`, which would land on the wrong copy of a repeated line — and
   * repeated lines are ordinary in a document that grows by appending one short
   * entry at a time.
   */
  offset: number;
}

const HEADING = /^\s{0,3}(#{1,6})\s+\S/;
const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const FENCE = /^\s{0,3}```/;
/**
 * The corpus's own pseudo-headings: `MANDATE — what the role is:`,
 * `FORBIDDEN CHANGES — …`, `BOUNDARIES:`. They carry no `#`, so a markdown
 * renderer shows them as body text, and the contest winner rendered them as
 * small uppercase labels instead — one of the typographic choices the owner
 * picked it for. Display only: the text is stored exactly as written.
 */
const LABEL = /^[A-Z][A-Z0-9 /-]+ —|^[A-Z][A-Z0-9 ]+:$/;

/**
 * Split a section body into rows: headings, paragraphs, each list item, and
 * fenced blocks kept whole (a blank line inside a fence does not end it).
 */
export function splitBlocks(sectionId: string, body: string): DocumentBlock[] {
  // Strip trailing LINE BREAKS only. A row's trailing spaces are part of its
  // source: an empty new bullet is `- `, and trimming it to `-` would lose the
  // marker's space and make the row unwritable.
  const lines = body.replace(/[\r\n]+$/, '').split(/\r?\n/);
  const starts: number[] = [];
  let at = 0;
  for (const line of lines) {
    starts.push(at);
    at += line.length + 1;
  }

  const out: DocumentBlock[] = [];
  const push = (kind: DocumentBlockKind, from: number, to: number, extra: Partial<DocumentBlock> = {}) => {
    const text = lines.slice(from, to + 1).join('\n');
    if (!text.trim()) return;
    out.push({
      id: `${sectionId}:${out.length}`,
      index: out.length,
      kind,
      text,
      content: text,
      indent: 0,
      marker: '',
      depth: 0,
      offset: starts[from] ?? 0,
      ...extra,
    });
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      i++;
      continue;
    }
    if (FENCE.test(line)) {
      let j = i + 1;
      while (j < lines.length && !FENCE.test(lines[j] ?? '')) j++;
      push('code', i, Math.min(j, lines.length - 1));
      i = j + 1;
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      push('heading', i, i, { depth: h[1]!.length });
      i++;
      continue;
    }
    if (LABEL.test(line.trim())) {
      push('heading', i, i, { depth: 3 });
      i++;
      continue;
    }
    const item = ITEM.exec(line);
    if (item) {
      // An item owns the non-blank lines indented deeper than its marker that
      // follow it, until the next item, heading or blank line.
      const indent = item[1]!.length;
      let j = i;
      while (j + 1 < lines.length) {
        const next = lines[j + 1] ?? '';
        if (next.trim() === '' || ITEM.test(next) || HEADING.test(next) || FENCE.test(next)) break;
        if ((next.match(/^\s*/)?.[0].length ?? 0) <= indent) break;
        j++;
      }
      const rest = lines
        .slice(i + 1, j + 1)
        .map((l) => l.trim())
        .join('\n');
      push('item', i, j, {
        indent,
        marker: item[2]!,
        content: rest ? `${item[3]}\n${rest}` : (item[3] ?? ''),
      });
      i = j + 1;
      continue;
    }
    // A paragraph runs until a blank line or a line that starts another kind.
    let j = i;
    while (j + 1 < lines.length) {
      const next = lines[j + 1] ?? '';
      if (next.trim() === '' || ITEM.test(next) || HEADING.test(next) || FENCE.test(next)) break;
      j++;
    }
    push('paragraph', i, j);
    i = j + 1;
  }
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

// ── row editing ────────────────────────────────────────────────────────────
//
// A row is edited IN PLACE, and saved as a splice on the section's original
// markdown over exactly the span the row came from. Nothing is re-serialised
// from rendered output, so a heading marker, a bullet, an indent or a blank
// line outside the row cannot be touched by an edit inside it. This is the
// property the contest's own baseline lacked (its HTML round-trip dropped `##`
// and flattened nested lists) and the reason this surface can offer true
// inline row editing at all.

/** The part of a row's source the operator types into: everything after its
 *  bullet (`  - `), its `#` marker (`## `), or nothing for a paragraph/label. */
export function rowPrefix(block: DocumentBlock): string {
  if (block.kind === 'item') return /^\s*([-*+]|\d+[.)])\s+/.exec(block.text)?.[0] ?? '';
  if (block.kind === 'heading') return /^\s{0,3}#{1,6}\s+/.exec(block.text)?.[0] ?? '';
  return '';
}

export function editablePart(block: DocumentBlock): string {
  return block.text.slice(rowPrefix(block).length);
}

/** Replace one row's editable part, returning the new whole body. */
export function spliceRow(body: string, block: DocumentBlock, next: string): string {
  const prefix = rowPrefix(block);
  return body.slice(0, block.offset) + prefix + next + body.slice(block.offset + block.text.length);
}

/**
 * Insert an empty sibling row after `block` and return the new body plus the
 * caret offset inside the new row. A bullet begets a bullet at the same indent;
 * anything else begets a new paragraph.
 */
export function insertRowAfter(body: string, block: DocumentBlock): { body: string; caret: number } {
  const end = block.offset + block.text.length;
  const lead =
    block.kind === 'item'
      ? `\n${' '.repeat(block.indent)}${/^\d/.test(block.marker) ? `${Number.parseInt(block.marker, 10) + 1}.` : block.marker} `
      : '\n\n';
  return { body: body.slice(0, end) + lead + body.slice(end), caret: end + lead.length };
}

/**
 * Split a row at `caret` (an offset inside its editable part): the text before
 * stays, the text after becomes a new sibling row. Returns the new body and the
 * caret's absolute offset at the start of the new row's editable part.
 */
export function splitRowAt(body: string, block: DocumentBlock, caret: number): { body: string; caret: number } {
  const prefix = rowPrefix(block);
  const editable = editablePart(block);
  const at = Math.max(0, Math.min(caret, editable.length));
  const lead =
    block.kind === 'item'
      ? `\n${' '.repeat(block.indent)}${/^\d/.test(block.marker) ? `${Number.parseInt(block.marker, 10) + 1}.` : block.marker} `
      : '\n\n';
  const before = editable.slice(0, at);
  const after = editable.slice(at);
  const head = body.slice(0, block.offset) + prefix + before + lead;
  return { body: head + after + body.slice(block.offset + block.text.length), caret: head.length };
}

/** Remove a row and the line break that introduced it. */
export function removeRow(body: string, block: DocumentBlock): string {
  const start = block.offset;
  const end = block.offset + block.text.length;
  // eat the newline(s) before the row so no blank gap is left behind
  let from = start;
  while (from > 0 && body[from - 1] === '\n') from--;
  if (from === 0) {
    let to = end;
    while (to < body.length && body[to] === '\n') to++;
    return body.slice(to);
  }
  return body.slice(0, from) + body.slice(end);
}
