/**
 * The id net: a display-time safety net that shortens raw ids Athena still
 * writes into her prose, so a uuid never eats a line of the conversation.
 *
 * What counts as an id mirrors `scripts/test/lib/reply-shape.mjs`
 * (`isBareIdToken`, WP4) so the thing measured and the thing shortened agree:
 * a uuid, a 7-40 char hex run holding at least one digit AND one letter, or a
 * brain / orchestration prefixed id (`ep_…`, `op_…`, `appr_…`, …).
 *
 * Exempt, per the contract: fenced code blocks (an id-shaped token there is
 * plausibly real code) and ref links (the handle is the point of the link).
 * Also exempt: link destinations and bare URLs, where a hex run is part of an
 * address the reader may follow. An inline code span holding ONLY an id is
 * shortened — backticking ids is today's habit, and it is exactly the habit the
 * layered voice retires; any other inline code is left alone.
 */

import { fencedRanges, inlineCodeRanges, maskFenced } from './codeMask';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_RUN_RE = /^[0-9a-f]{7,40}$/i;
const PREFIXED_ID_RE = /^(?:ep|op|sess|job|appr|goal|fact|doc|proc|bl|dec|card|task)_[0-9a-zA-Z]+$/;
const TOKEN_RE = /[0-9a-zA-Z][0-9a-zA-Z_-]*/g;

/** One token — is it a bare id per the layered-voice contract. */
export function isBareIdToken(tok: string): boolean {
  if (UUID_RE.test(tok)) return true;
  if (HEX_RUN_RE.test(tok) && /[0-9]/.test(tok) && /[a-f]/i.test(tok)) return true;
  return PREFIXED_ID_RE.test(tok);
}

/**
 * Shorten an opaque identifier for reading. A uuid identifies; it is not meant
 * to be read. Eight chars is enough to correlate against a log and short enough
 * not to eat the line. Shared with the system-note correlator line
 * (`athenaChatSystemKind`) so both surfaces shorten the same way.
 */
export function shortenId(value: string): string {
  return value.length > 9 ? `${value.slice(0, 8)}…` : value;
}

// Ranges the net must not touch, found on the fence-masked text.
const PROTECTED_RES: RegExp[] = [
  /\[[^\]\n]*\]\((?:#?ref:)[^)\s]*\)/g, // ref links (raw or already rewritten)
  /\]\([^)\n]*\)/g, // any markdown link / image destination
  /<[a-z][a-z0-9+.-]*:[^>\s]*>/gi, // autolinks
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s)<>]+/gi, // bare URLs
];

function shortenTokens(segment: string): string {
  return segment.replace(TOKEN_RE, (tok) => (isBareIdToken(tok) ? shortenId(tok) : tok));
}

/** Shorten bare ids in assistant markdown. Pure; returns a new string. */
export function shortenBareIds(text: string): string {
  if (!text) return text;
  const fenceMasked = maskFenced(text);
  type Range = { start: number; end: number; inline?: boolean };
  const ranges: Range[] = fencedRanges(text).map(([start, end]) => ({ start, end }));
  for (const re of PROTECTED_RES) {
    for (const m of fenceMasked.matchAll(re)) {
      const start = m.index ?? 0;
      ranges.push({ start, end: start + m[0].length });
    }
  }
  for (const [start, end] of inlineCodeRanges(text)) ranges.push({ start, end, inline: true });
  ranges.sort((a, b) => a.start - b.start || b.end - a.end);

  let out = '';
  let cursor = 0;
  for (const r of ranges) {
    if (r.end <= cursor) continue; // swallowed by an earlier, wider range
    const start = Math.max(r.start, cursor);
    out += shortenTokens(text.slice(cursor, start));
    const chunk = text.slice(start, r.end);
    if (r.inline && start === r.start) {
      const inner = chunk.slice(1, -1).trim();
      out += isBareIdToken(inner) ? `\`${shortenId(inner)}\`` : chunk;
    } else {
      out += chunk;
    }
    cursor = r.end;
  }
  return out + shortenTokens(text.slice(cursor));
}
