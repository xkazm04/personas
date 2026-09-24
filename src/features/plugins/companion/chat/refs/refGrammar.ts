/**
 * Reference links: `[<phrase>](ref:<kind>/<handle>)`.
 *
 * Contract: `docs/features/companion/layered-voice.md` § Reference links. The
 * dispatcher (WP2) already validates every link and replaces a bad one with its
 * phrase; this is the display side, so it is deliberately forgiving: anything
 * that is not a well-formed link of a known kind renders as the plain phrase.
 *
 * react-markdown drops a `ref:` href (an unknown URL scheme) before any
 * component sees it, so `rewriteRefHrefs` moves the link into the fragment
 * (`#ref:kind/handle`), which the default URL transform keeps verbatim, and
 * the `a` override in `refMarkdown` turns it back into a `RefLink`.
 */

import { maskCode } from './codeMask';

export const REF_KINDS = [
  'approval',
  'card',
  'decision',
  'report',
  'session',
  'job',
  'memory',
  'goal',
  'persona',
] as const;

export type RefKind = (typeof REF_KINDS)[number];

export function isRefKind(kind: string): kind is RefKind {
  return (REF_KINDS as readonly string[]).includes(kind);
}

export interface ParsedRef {
  phrase: string;
  kind: RefKind;
  handle: string;
}

const LINK_RE = /\[([^\]\n]*)\]\(ref:([a-z]+)\/([^)\s]*)\)/g;
const HREF_PREFIX = '#ref:';

function wellFormed(phrase: string, kind: string, handle: string): kind is RefKind {
  return isRefKind(kind) && handle.length > 0 && phrase.trim().length > 0;
}

/** Every well-formed ref link outside code, in reading order. */
export function parseRefLinks(text: string): ParsedRef[] {
  const out: ParsedRef[] = [];
  for (const m of maskCode(text).matchAll(LINK_RE)) {
    const start = m.index ?? 0;
    // Read the phrase from the ORIGINAL text: masking only blanks code, so the
    // offsets match, but a phrase may legitimately contain an inline code span.
    const original = text.slice(start, start + m[0].length);
    const o = new RegExp(LINK_RE.source).exec(original);
    if (!o) continue;
    const [, phrase = '', kind = '', handle = ''] = o;
    if (wellFormed(phrase, kind, handle)) out.push({ phrase, kind, handle });
  }
  return out;
}

/**
 * Rewrite ref links for rendering: a well-formed link keeps its markdown shape
 * with the href moved to `#ref:kind/handle`; a malformed or unknown-kind link
 * collapses to its phrase. Code (fenced and inline) is left untouched.
 */
export function rewriteRefHrefs(text: string): string {
  const masked = maskCode(text);
  let out = '';
  let last = 0;
  for (const m of masked.matchAll(LINK_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const original = text.slice(start, end);
    const o = new RegExp(LINK_RE.source).exec(original);
    out += text.slice(last, start);
    if (o) {
      const [, phrase = '', kind = '', handle = ''] = o;
      out += wellFormed(phrase, kind, handle) ? `[${phrase}](${HREF_PREFIX}${kind}/${handle})` : phrase;
    } else {
      out += original;
    }
    last = end;
  }
  return out + text.slice(last);
}

/** A malformed percent-escape is still a usable handle as written. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Decode a rewritten href back into its kind + handle; null for any other href. */
export function parseRefHref(href: string | undefined | null): { kind: RefKind; handle: string } | null {
  if (!href || !href.startsWith(HREF_PREFIX)) return null;
  const rest = href.slice(HREF_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  const kind = rest.slice(0, slash);
  const handle = safeDecode(rest.slice(slash + 1));
  if (!isRefKind(kind) || !handle) return null;
  return { kind, handle };
}
