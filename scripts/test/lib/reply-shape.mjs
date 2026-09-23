/**
 * Layered-voice reply-shape counters — the measurement primitives WP4 (spark
 * athena-layered-voice) adds so a shape number is computed the SAME way
 * everywhere it's cited: the bench harness (athena-model-bench.mjs, scored
 * per turn against a fixture corpus) and the live-brain aggregator
 * (companion/reply-stats.mjs, scored over real episodes) both import this
 * module rather than each growing their own regex.
 *
 * This is a JS-side approximation of the contract in
 * docs/features/companion/layered-voice.md (WP0) / the wire identifiers in
 * .spark-briefs/WP0.md — NOT the production Rust scorer WP2 is building in
 * dispatcher/refs.rs + the companion_turn.outcome_json writer. The two are
 * expected to agree on the CONTRACT (same id patterns, same ref grammar,
 * same "list of <=3 items = 1 sentence" rule) but are independent
 * implementations by design: this one exists so the bench/measurement lane
 * never depends on WP2 landing first, and never needs the Rust validator
 * binary to answer a shape question.
 *
 * CONTRACT AMENDMENT (Director, 2026-09-23): ids inside INLINE code now
 * count as bare ids everywhere. Only a FENCED code block or a ref-link
 * handle is exempt. See `countBareIds`'s doc comment for why (measuring the
 * live brain under the old, inline-exempt reading undercounted the raw-id
 * habit layer one exists to fix by ~3.4x, since today's pre-layer-one prompt
 * explicitly asks the model to wrap ids in inline code).
 */

/** Ref-link kinds per the contract (WP0.md "Wire identifiers"). */
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
];

/** Strip ONLY fenced code blocks (``` ... ```). */
export function stripFencedCodeBlocks(text) {
  return text.replace(/```[\s\S]*?```/g, ' ');
}

/** Strip ONLY inline code spans (`...`, single backtick, no newline). */
export function stripInlineCodeSpans(text) {
  return text.replace(/`[^`\n]*`/g, ' ');
}

/** Strip fenced code blocks then inline code spans — used by
 *  sentence-counting and ref-link scanning, which never look inside either.
 *  NOT used for the primary bareId count any more (see the Director
 *  amendment on `countBareIds` below) — inline code is real prose real
 *  estate for an id, fenced code is not. */
export function stripCodeSpans(text) {
  return stripInlineCodeSpans(stripFencedCodeBlocks(text));
}

/** Strip the `(ref:kind/handle)` half of a ref link, leaving the phrase (and
 *  its surrounding prose) behind — a ref HANDLE is not a "bare" id, it's the
 *  point of the feature, so it must not count against the id-leak metric. */
export function stripRefHandles(text) {
  return text.replace(/\(ref:[a-z]+\/[^)\s]*\)/gi, ' ');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_RUN_RE = /^[0-9a-f]{7,40}$/i;
const PREFIXED_ID_RE =
  /^(?:ep|op|sess|job|appr|goal|fact|doc|proc|bl|dec|card|task)_[0-9a-zA-Z]+$/;

/** One token (already split on word boundaries) — is it a bare id per the
 *  contract: a uuid, a 7-40 char hex run containing at least one digit AND
 *  one letter (so it can't be an ordinary English word or a small number),
 *  or one of the brain-prefix ids. */
export function isBareIdToken(tok) {
  if (UUID_RE.test(tok)) return true;
  if (HEX_RUN_RE.test(tok) && /[0-9]/.test(tok) && /[a-f]/i.test(tok)) return true;
  if (PREFIXED_ID_RE.test(tok)) return true;
  return false;
}

/** Count bare ids — the PRIMARY, contract definition as of the Director's
 *  2026-09-23 amendment: an id INSIDE INLINE CODE still counts (`` `appr_1a2b3c4d` ``
 *  is exactly as much a leaked raw id as one in plain prose — the reader
 *  sees it either way), and only a FENCED code block (real multi-line code,
 *  where an id-shaped token is plausibly genuine code, e.g. a hash in a
 *  diff) or a ref-link handle is exempt.
 *
 *  This superseded an earlier two-counter split (a "contract" counter that
 *  excluded ALL code spans, used by the bench, vs. a "visible" counter that
 *  excluded none, used by reply-stats.mjs) — the split existed because the
 *  bench's original reading of WP0.md's "excluding ids inside ref link
 *  handles and code spans" was taken to mean inline code too. Measuring the
 *  live brain against that reading undercounted the raw-id habit layer one
 *  exists to fix by ~3.4x (8.6% vs 29.3% of 535 replies), because
 *  today's PRE-layer-one prompt (`chat-core.md`) explicitly asks the model to
 *  wrap ids in `inline code` — so almost every existing raw id IS
 *  backtick-wrapped, and a definition that exempts inline code is nearly
 *  blind to the exact behavior it measures. The Director's fix: the contract
 *  itself now says inline code counts. One counter, one number, used by both
 *  the bench and reply-stats.mjs. */
export function countBareIds(text) {
  const cleaned = stripRefHandles(stripFencedCodeBlocks(text));
  const tokens = cleaned.match(/[0-9a-zA-Z][0-9a-zA-Z_-]*/g) ?? [];
  return tokens.filter(isBareIdToken).length;
}

/** Count bare ids the STRICT way — the pre-amendment contract reading:
 *  excludes ids inside inline code AND fenced code, in addition to ref-link
 *  handles. Kept only for comparison/diagnostics (e.g. "how many of today's
 *  leaked ids are backtick-wrapped" = countBareIds - countBareIdsStrict);
 *  nothing scores against this any more. Do not use this as `bareIds` in a
 *  report — it undercounts the live habit by ~3.4x (see `countBareIds`'s
 *  doc comment). */
export function countBareIdsStrict(text) {
  const cleaned = stripRefHandles(stripCodeSpans(text));
  const tokens = cleaned.match(/[0-9a-zA-Z][0-9a-zA-Z_-]*/g) ?? [];
  return tokens.filter(isBareIdToken).length;
}

/** Find `[phrase](ref:kind/handle)` links outside code spans. Returns
 *  { links: [{phrase,kind,handle}], malformed: n } — malformed counts a
 *  `(ref:...)` parenthetical that did not parse as a well-formed link
 *  (unknown kind, empty handle, or not preceded by a `[phrase]`). */
export function scanRefLinks(text) {
  const cleaned = stripCodeSpans(text);
  const linkRe = /\[([^\]]*)\]\(ref:([a-z]+)\/([^)\s]*)\)/g;
  const links = [];
  let m;
  while ((m = linkRe.exec(cleaned))) {
    const [, phrase, kind, handle] = m;
    links.push({ phrase, kind, handle, wellFormed: REF_KINDS.includes(kind) && !!handle && !!phrase.trim() });
  }
  const totalRefParens = (cleaned.match(/\(ref:[^)]*\)/g) ?? []).length;
  const malformed = Math.max(0, totalRefParens - links.length) + links.filter((l) => !l.wellFormed).length;
  return { links, malformed };
}

/** Sentence count: prose lines split on [.!?] (followed by space/EOL); a
 *  markdown list (`- `/`* `/`\d+. `) of at most 3 consecutive items counts as
 *  ONE sentence (the contract's "a list of <=3 items as one"); a longer list
 *  counts each item, since past 3 it is no longer "one clause" shorthand. */
export function countSentences(text) {
  const cleaned = stripCodeSpans(text).trim();
  if (!cleaned) return 0;
  const lines = cleaned.split('\n');
  const LIST_RE = /^\s*(?:[-*]\s+|\d+\.\s+)/;
  let sentences = 0;
  let i = 0;
  while (i < lines.length) {
    if (LIST_RE.test(lines[i])) {
      let items = 0;
      while (i < lines.length && LIST_RE.test(lines[i])) {
        items++;
        i++;
      }
      sentences += items <= 3 ? 1 : items;
      continue;
    }
    const line = lines[i];
    const ends = line.match(/[.!?](?=\s|$)/g);
    sentences += ends ? ends.length : line.trim() ? 1 : 0;
    i++;
  }
  return sentences;
}

export function wordCount(text) {
  const t = text.trim();
  return t ? (t.match(/\S+/g) ?? []).length : 0;
}

export function charCount(text) {
  return text.length;
}

/** One-shot shape summary for a reply's display text (already stripped of
 *  OP:/QR:/TTS:/PROGRESS: machine lines — this module never looks for those,
 *  callers pass cleaned text).
 *  `bareIds` is the PRIMARY count (`countBareIds`: fenced code + ref handles
 *  exempt, inline code counts) — this is what both the bench harness and
 *  reply-stats.mjs score/report as "bare ids" as of the 2026-09-23 contract
 *  amendment. `bareIdsStrict` (`countBareIdsStrict`, all code spans exempt)
 *  rides along for comparison only; nothing should gate on it.
 *  `opts.visibleIds` is now a no-op — kept accepting (rather than throwing)
 *  for one release so a stale caller doesn't crash, but it does nothing:
 *  there is only one bareId definition now. Remove call sites that still
 *  pass it. */
export function replyShape(text, opts = {}) {
  void opts; // see doc comment — accepted, ignored, deliberately unused
  const words = wordCount(text);
  const chars = charCount(text);
  const sentences = countSentences(text);
  const bareIds = countBareIds(text);
  const bareIdsStrict = countBareIdsStrict(text);
  const refs = scanRefLinks(text);
  return {
    words,
    chars,
    sentences,
    bareIds,
    bareIdsStrict,
    refLinkCount: refs.links.length,
    refsWellFormed: refs.links.filter((l) => l.wellFormed).length,
    refsMalformed: refs.malformed,
  };
}

/** Percentile over a numeric array (nearest-rank, matches the bench script's
 *  `pctl`). Returns null on an empty array. */
export function percentile(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

export function median(arr) {
  return percentile(arr, 50);
}
