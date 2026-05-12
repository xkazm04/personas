/**
 * Centralised magic-constants for the memory pipeline (frontend side).
 *
 * Mirrors `src-tauri/src/engine/limits.rs` for backend constants. These
 * thresholds control duplicate / contradiction / superseded detection in
 * `memoryConflicts.ts` (and a parallel hook copy under
 * `sub_memories/hooks/memoryConflicts.ts`). Tuning them blind is an easy way
 * to flood the conflict UI with false positives or hide real ones — every
 * value below carries a one-line justification so the next person tweaking
 * a threshold knows what they're trading off.
 *
 * Keep both call sites in lockstep. If you add a new threshold here, update
 * both `libs/memoryConflicts.ts` and the legacy hook copy at
 * `hooks/memoryConflicts.ts` to read from this module.
 */

/** Word-vs-bigram blend used in `textSimilarity`. Bigrams weight slightly
 * higher (0.6) because "users prefer dark" vs "dark mode preferred by users"
 * have similar token sets but very different bigram sets — bigrams catch
 * the truly-near-duplicate case better. Word similarity (0.4) keeps the
 * score sensitive when bigrams are sparse on short strings. Sum must be 1.0. */
export const TEXT_SIM_WORD_WEIGHT = 0.4;
export const TEXT_SIM_BIGRAM_WEIGHT = 0.6;

/** Combined word+bigram similarity at which two memories are flagged as
 * duplicates. 0.7 chosen empirically: scores in 0.5–0.7 routinely flagged
 * paraphrases of distinct facts (false positives); above 0.7 the pairs are
 * nearly always genuine duplicates worth merging. */
export const DUPLICATE_THRESHOLD = 0.7;

/** Topic-overlap floor for contradiction detection. Set lower (0.4) than
 * the duplicate threshold because contradictions need semantic overlap but
 * not surface similarity — "users always want X" vs "users never want X"
 * share topic tokens but diverge in negation. Pairs are escalated to
 * contradictions only when the negation regex panel ALSO matches. */
export const CONTRADICTION_TOPIC_THRESHOLD = 0.4;

/** Topic-overlap floor for "superseded by newer memory" detection. Sits
 * between duplicate (0.7) and contradiction (0.4): we want enough overlap
 * to assume the same subject, but allow the newer memory to add facts
 * absent from the older one (so a strict 0.7 would miss real supersessions). */
export const SUPERSEDED_TOPIC_THRESHOLD = 0.6;

/** Minimum time delta (in ms) between two memories before "superseded by"
 * applies. 1 hour avoids flagging two memories created in the same batch
 * (where ordering is implementation-defined) as one superseding the other. */
export const SUPERSEDED_MIN_TIME_DIFF_MS = 60 * 60 * 1000;

if (
  Math.abs(TEXT_SIM_WORD_WEIGHT + TEXT_SIM_BIGRAM_WEIGHT - 1) > 1e-9 &&
  typeof console !== 'undefined'
) {
  // Defensive: a future PR that bumps one weight without the other will
  // silently re-shape the similarity score; this loud warning is cheaper
  // than tracking down "everything got flagged" reports.
  console.warn(
    '[memoryLimits] TEXT_SIM_WORD_WEIGHT + TEXT_SIM_BIGRAM_WEIGHT must sum to 1.0',
  );
}
