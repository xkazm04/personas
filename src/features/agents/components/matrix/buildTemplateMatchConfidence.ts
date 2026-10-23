/**
 * Confidence gate for the mid-build template suggestion (glyph-convergence R2).
 *
 * `companion_match_templates` is a keyword LIKE search: it returns any review
 * whose searchable text contains *at least one* extracted intent keyword. That
 * means the top result can be a weak, single-keyword coincidence (e.g. the only
 * overlap is "slack"). Interrupting a from-scratch build with a weak suggestion
 * erodes trust — especially for the non-technical users this surface targets.
 *
 * So before the card surfaces a match, we re-check overlap on the client: how
 * many DISTINCT intent keywords actually appear in the match's text. We mirror
 * the backend's substring matching (LIKE `%kw%`) rather than exact-token
 * equality, so stems/plurals still count ("idea" → "ideas", "harvest" →
 * "harvester"). Only matches clearing MIN_OVERLAP are strong enough to show.
 */
import type { CompanionTemplateMatch } from '@/api/companion';

// The keyword rules below mirror `extract_keywords` in
// src-tauri/src/commands/companion/templates.rs (MIN_KEYWORD_LEN, STOP_WORDS,
// the split, the cap) so the presentation gate agrees with what the matcher
// actually searched on. The parity test reads the Rust source.
export const MIN_KEYWORD_LEN = 3;
/** The matcher searches on the first 8 keywords only (`.take(8)`). */
export const MAX_KEYWORDS = 8;

export const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'that', 'this', 'want', 'need',
  'would', 'could', 'should', 'have', 'has', 'are', 'you', 'your', 'but', 'can',
  'all', 'any', 'one', 'two', 'three', 'what', 'when', 'who', 'why', 'how',
]);

const utf8 = new TextEncoder();

/**
 * Distinct, lowercased, stop-word-filtered keywords from an intent string.
 *
 * Split on anything that is not a letter or digit in ANY script (Rust's
 * `char::is_alphanumeric`), and measure length in UTF-8 bytes (Rust's
 * `str::len`). An ASCII-only split cut "úkolů" into the fragment "kol" and
 * turned a Chinese intent into no keywords at all, so the gate hid every
 * match the backend had found for it.
 */
export function intentKeywords(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/[^\p{Alphabetic}\p{N}]+/u)
        .map((w) => w.toLowerCase())
        .filter((w) => utf8.encode(w).length >= MIN_KEYWORD_LEN && !STOP_WORDS.has(w))
        .slice(0, MAX_KEYWORDS),
    ),
  );
}

/** Count of distinct intent keywords that appear (as substrings) in the match. */
export function matchOverlap(intent: string, match: CompanionTemplateMatch): number {
  const kws = intentKeywords(intent);
  if (kws.length === 0) return 0;
  const haystack = `${match.name} ${match.snippet} ${match.category ?? ''} ${match.connectors.join(' ')}`.toLowerCase();
  return kws.filter((k) => haystack.includes(k)).length;
}

/**
 * Minimum distinct-keyword overlap for a match to interrupt the build. Two is
 * the sweet spot: one shared keyword is usually a generic coincidence (a common
 * connector or verb); two means the template genuinely tracks the intent.
 */
export const MIN_OVERLAP = 2;

/**
 * A match is strong enough to surface when it shares at least MIN_OVERLAP
 * distinct intent keywords — or ALL of them, when the intent is shorter than
 * MIN_OVERLAP (a 1-keyword intent can only ever overlap by 1).
 */
export function isStrongMatch(intent: string, match: CompanionTemplateMatch): boolean {
  const kws = intentKeywords(intent);
  if (kws.length === 0) return false;
  const need = Math.min(MIN_OVERLAP, kws.length);
  return matchOverlap(intent, match) >= need;
}

/** Strong matches only, in the backend's relevance order. */
export function strongMatches(
  intent: string,
  matches: CompanionTemplateMatch[],
): CompanionTemplateMatch[] {
  return matches.filter((m) => isStrongMatch(intent, m));
}

/**
 * Whether the mid-build template suggestion may surface, given the
 * questionnaire state.
 *
 * It surfaces once the first clarifying questions land and until the user
 * dismisses it; the confidence gate above, not this predicate, decides
 * whether a given match is worth showing. (It once took the build layout as
 * well; with a single build layout left, that parameter was dropped.)
 */
export function shouldSurfaceTemplateSuggestion(
  pendingQuestionCount: number,
  dismissed: boolean,
): boolean {
  return pendingQuestionCount > 0 && !dismissed;
}
