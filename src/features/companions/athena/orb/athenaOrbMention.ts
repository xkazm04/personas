// athenaOrbMention — resolving a name Athena said to a node on the Monitor board.
//
// Her caption over the Monitor is her latest line, flattened to a sentence. This
// turns the part of it that names something into a place you can go: a persona
// or a live fleet session that is on the board becomes a click target which
// scrolls to that tile and flashes it.
//
// ## The whole design constraint is FALSE POSITIVES
//
// A link that jumps the board to the wrong node is worse than no link at all —
// the operator loses their place and learns not to trust the affordance, and one
// bad jump costs more than fifty missed ones. Every rule below exists to make
// the match refuse rather than guess:
//
//  1. WHOLE WORD ONLY. "Scout" must not match inside "Scouting" or "rescout".
//  2. MIN_NAME length. A two- or three-character name ("QA", "Ops") collides
//     with ordinary prose constantly; below the floor a name is not evidence.
//  3. EXACTLY ONE candidate may match. Two personas whose names both appear —
//     or one name that is a substring of another's — resolves to NOTHING. This
//     is the rule that does most of the work, because ambiguity is the common
//     case and silently taking the first is how a link points somewhere wrong.
//  4. Only ON-BOARD entities are candidates. Resolving to a persona the board
//     is not drawing would scroll to nothing.
//  5. The FIRST occurrence in the sentence is the one linked, so the rendered
//     link is always the text the reader is looking at.
//
// Nothing here is fuzzy: no stemming, no edit distance, no partial credit. If
// the exact name is not sitting in the sentence as its own word, there is no
// link and the caption stays plain prose — which is the correct outcome for the
// overwhelming majority of things Athena says.

/** Below this, a name is too short to be evidence that she meant the entity. */
const MIN_NAME = 4;

export interface MentionCandidate {
  /** `p:<personaId>` or `s:<sessionId>` — the key `gridGeometry` assigns. */
  key: string;
  /** The display name to look for, and to render as the link. */
  name: string;
}

export interface ResolvedMention {
  key: string;
  /** The matched text EXACTLY as it appears in the caption, so the rendered
   *  link is the reader's own substring rather than a re-cased copy. */
  label: string;
  start: number;
  end: number;
}

/** Escape a name for use inside a RegExp — names are user data and routinely
 *  contain `.`, `(`, `+` and other metacharacters. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Word boundaries that also work for names not starting or ending with a word
 * character.
 *
 * A plain `\b` at both ends looks right and is wrong: `\b` asserts a word ⇄
 * non-word TRANSITION, so for a name like `build (api)` the trailing `\b` sits
 * between `)` and a space — two non-word characters, no transition, no match.
 * Such a name could never resolve, silently. Caught by
 * `__tests__/athenaOrbMention.test.ts`, which is the reason that test exists.
 *
 * So the assertion is chosen per edge: guard against an adjacent word character
 * only where the name's own edge IS one. Same protection against matching
 * inside a longer word, without the false negative at a punctuation edge.
 */
function boundedPattern(name: string): string {
  const lead = /^\w/.test(name) ? '(?<!\\w)' : '';
  const tail = /\w$/.test(name) ? '(?!\\w)' : '';
  return `${lead}${escapeRe(name)}${tail}`;
}

/** Find the ONE entity this sentence unambiguously names, or null. */
export function resolveMention(
  caption: string | null,
  candidates: readonly MentionCandidate[],
): ResolvedMention | null {
  if (!caption) return null;

  const hits: ResolvedMention[] = [];
  for (const c of candidates) {
    const name = c.name.trim();
    if (name.length < MIN_NAME) continue;
    const m = new RegExp(boundedPattern(name), 'i').exec(caption);
    if (!m) continue;
    hits.push({ key: c.key, label: m[0], start: m.index, end: m.index + m[0].length });
    // Rule 3 short-circuit: a second hit means ambiguous, and ambiguous means
    // no link. Nothing later can rescue it, so stop looking.
    if (hits.length > 1) return null;
  }

  return hits[0] ?? null;
}

/**
 * Split a caption around a resolved mention, for rendering `before · link ·
 * after`. Returns null when there is nothing to link, so the caller renders the
 * plain string it already had.
 */
export function splitOnMention(
  caption: string,
  mention: ResolvedMention | null,
): { before: string; label: string; after: string } | null {
  if (!mention) return null;
  return {
    before: caption.slice(0, mention.start),
    label: caption.slice(mention.start, mention.end),
    after: caption.slice(mention.end),
  };
}
