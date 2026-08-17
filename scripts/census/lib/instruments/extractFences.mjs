/**
 * extractFences — fenced code blocks out of a markdown document, CRLF-safe.
 *
 * THE RECORDED BUG THIS EMBODIES (golden-path doctrine §4):
 *
 *   "A CRLF rewrite makes the merger see zero fenced blocks. One composer's
 *    Python edit silently converted its finished document to CRLF; the fence
 *    extractor then found nothing. Caught before publication. A LOST RULE LOOKS
 *    EXACTLY LIKE A RULE NOBODY WROTE — so after any programmatic edit to a
 *    finished path, re-extract the fence and confirm the rule count."
 *
 * That last sentence is the whole reason this is a module and not five lines
 * inlined at each call site: the corpus has three consumers of fenced §9 JSON
 * (`merge-published-rules.mjs`, the index generator, and any composer
 * validating its own document) and a silent zero in any of them is
 * indistinguishable from an honest zero.
 *
 * Two normalizations, both load-bearing, both learned from real documents:
 *   1. CRLF → LF before matching.
 *   2. Blockquote markers stripped per line. Composers publish the §9 rule two
 *      ways — a bare fence, or one nested inside a blockquote when §9 presents
 *      the rule as a quoted specification. Two composers used the blockquote
 *      form, the extractor reported "no ```json block", and the rules were
 *      published but never merged.
 */

/** CRLF (and lone CR) → LF. Done once, at the door. */
export function normalizeEol(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** Strip a single leading blockquote marker from every line. */
export function stripBlockquote(text) {
  return text.replace(/^[ \t]*>[ \t]?/gm, '');
}

/**
 * Every fenced block of `lang` in `md`.
 *
 * @param {string} md
 * @param {{lang?: string, blockquotes?: boolean}} [opts]
 *   lang — the info string to match (default 'json'); pass null for every fence.
 *   blockquotes — strip `>` markers before matching (default true).
 * @returns {{fences: string[], count: number}}
 */
export function extractFences(md, opts = {}) {
  const lang = opts.lang === undefined ? 'json' : opts.lang;
  const useBq = opts.blockquotes !== false;

  let src = normalizeEol(md);
  if (useBq) src = stripBlockquote(src);

  // The info string is matched EXACTLY (trailing blanks tolerated), not as a
  // prefix. `${lang}[^\n]*` would make a ```json5 or ```jsonc block merge as a
  // census rule, which is a behaviour change dressed up as leniency.
  const info = lang === null ? '[^\\n]*' : `${escapeRe(lang)}[ \\t]*`;
  const re = new RegExp('```' + info + '\\n([\\s\\S]*?)\\n```', 'g');
  const fences = [...src.matchAll(re)].map((m) => m[1]);
  return { fences, count: fences.length };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Fenced JSON, parsed. Unparseable fences are reported, never dropped silently —
 * "it didn't parse" and "it wasn't there" are different findings and only one of
 * them is the author's fault.
 *
 * @returns {{count:number, parsed:any[], failed:Array<{index:number, error:string}>}}
 */
export function extractJsonFences(md, opts = {}) {
  const { fences, count } = extractFences(md, { ...opts, lang: opts.lang ?? 'json' });
  const parsed = [];
  const failed = [];
  fences.forEach((f, index) => {
    try {
      parsed.push(JSON.parse(f));
    } catch (err) {
      failed.push({ index, error: err.message });
    }
  });
  return { count, parsed, failed, fences };
}

/**
 * The census-rule view of a document's fences: every object carrying an `id`,
 * flattened out of the three shapes composers publish
 * (`{"rules":[…]}` | `[…]` | `{…}`).
 *
 * This is the shape both `merge-published-rules.mjs` and the golden-path index
 * consume, so the two can never disagree about what a document published.
 *
 * @returns {{count:number, rules:any[], skipped:number, failed:Array<{index:number,error:string}>}}
 */
export function extractPublishedRules(md, opts = {}) {
  const { count, parsed, failed } = extractJsonFences(md, opts);
  const rules = [];
  let skipped = 0;
  for (const block of parsed) {
    const candidates = Array.isArray(block) ? block : (block?.rules ?? [block]);
    for (const c of candidates) {
      if (!c || typeof c !== 'object' || !c.id) { skipped++; continue; }
      rules.push(c);
    }
  }
  return { count, rules, skipped, failed };
}
