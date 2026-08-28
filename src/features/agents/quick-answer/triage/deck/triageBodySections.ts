/**
 * triageBodySections — the structured case behind a triage card.
 *
 * Scanners (`/scan-sweep` and the app's Idea Scanner) write an idea's body as
 * markdown with a FIXED set of `## ` sections — Summary, Description, Flow,
 * Expected impact — so that a reviewer decides against the same shape every
 * time and a cheaper model can execute from it without re-deriving intent.
 * The card renders each section as its own block with a divider; a body that
 * carries no `## ` heading (older ideas, free prose) renders as one block.
 *
 * The heading text is CONTENT, not chrome: it is whatever the scanner wrote,
 * so it is shown verbatim and never translated. Only the ordering is ours —
 * the canonical sections sort first, in canonical order (Summary, Expected
 * impact / behaviour, Description, Flow), and anything else follows in the
 * order written.
 */

export interface BodySection {
  /** Heading text, verbatim. `null` for the leading un-headed prose. */
  heading: string | null;
  /** Section markdown, trimmed. */
  content: string;
  /** Which canonical slot this heading names, when it names one. */
  canonical: CanonicalSection | null;
}

export type CanonicalSection = 'summary' | 'description' | 'flow' | 'impact' | 'delta';

/** Render order. The impact / expected-behaviour slot is deliberately promoted
 *  ABOVE the description: the reviewer decides on what changes for whom and
 *  reads the mechanics only when that is worth the time (operator call,
 *  2026-08-28). Scanners still WRITE it last — this reorders at render time,
 *  it never rewrites the stored body. */
const CANONICAL_ORDER: CanonicalSection[] = ['summary', 'impact', 'delta', 'description', 'flow'];

/** Loose match on purpose: `## Expected impact`, `## Impact`, `## Flow (bullets)`. */
function canonicalOf(heading: string): CanonicalSection | null {
  const h = heading.toLowerCase();
  if (/^summary\b/.test(h)) return 'summary';
  if (/^description\b/.test(h)) return 'description';
  if (/^(flow|steps|bullet)/.test(h)) return 'flow';
  if (/impact\b/.test(h) || /^expected\b/.test(h)) return 'impact';
  if (/^net delta\b/.test(h) || /^delta\b/.test(h) || /^evaluation\b/.test(h)) return 'delta';
  return null;
}

const HEADING = /^##\s+(.+?)\s*#*\s*$/;

/**
 * Split a body at its `## ` headings. Fenced code blocks are opaque — a `##`
 * inside ``` fences is code, not a heading.
 */
export function splitBodySections(body: string): BodySection[] {
  const lines = body.split(/\r?\n/);
  const out: BodySection[] = [];
  let heading: string | null = null;
  let buf: string[] = [];
  let inFence = false;

  const flush = () => {
    const content = buf.join('\n').trim();
    if (heading !== null || content) {
      out.push({ heading, content, canonical: heading === null ? null : canonicalOf(heading) });
    }
    buf = [];
  };

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const m = inFence ? null : HEADING.exec(line);
    if (m) {
      flush();
      heading = m[1]!;
      continue;
    }
    buf.push(line);
  }
  flush();

  // Canonical sections first, in canonical order; the rest keep written order.
  // A stable sort — `Array.prototype.sort` is stable — so ties keep position.
  const rank = (s: BodySection) =>
    s.canonical === null ? CANONICAL_ORDER.length : CANONICAL_ORDER.indexOf(s.canonical);
  const lead = out.filter((s) => s.heading === null);
  const rest = out.filter((s) => s.heading !== null).sort((a, b) => rank(a) - rank(b));
  return [...lead, ...rest];
}

/** True when the body carries at least one `## ` section — the structured form. */
export function isSectionedBody(body: string): boolean {
  return splitBodySections(body).some((s) => s.heading !== null);
}
