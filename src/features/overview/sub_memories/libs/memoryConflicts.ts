import type { PersonaMemory } from '@/lib/bindings/PersonaMemory';
import { silentCatch } from '@/lib/silentCatch';
import {
  TEXT_SIM_WORD_WEIGHT,
  TEXT_SIM_BIGRAM_WEIGHT,
  DUPLICATE_THRESHOLD,
  CONTRADICTION_TOPIC_THRESHOLD,
  SUPERSEDED_TOPIC_THRESHOLD,
  SUPERSEDED_MIN_TIME_DIFF_MS,
} from '@/lib/memoryLimits';

export type ConflictKind = 'duplicate' | 'contradiction' | 'superseded';

export interface MemoryConflict {
  id: string;
  kind: ConflictKind;
  similarity: number;
  memoryA: PersonaMemory;
  memoryB: PersonaMemory;
  reason: string;
}

export type ConflictResolution = 'merge' | 'keep_a' | 'keep_b' | 'dismiss';

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenize(text: string): string[] {
  return normalize(text).split(' ').filter((w) => w.length > 2);
}

function jaccard(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersection = 0;
  for (const item of setA) { if (setB.has(item)) intersection++; }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function bigrams(text: string): Set<string> {
  const norm = normalize(text);
  const set = new Set<string>();
  for (let i = 0; i < norm.length - 1; i++) set.add(norm.slice(i, i + 2));
  return set;
}

export function textSimilarity(a: string, b: string): number {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));
  const wordSim = jaccard(tokensA, tokensB);
  const bigramSim = jaccard(bigrams(a), bigrams(b));
  return wordSim * TEXT_SIM_WORD_WEIGHT + bigramSim * TEXT_SIM_BIGRAM_WEIGHT;
}

const NEGATION_PAIRS: Array<[RegExp, RegExp]> = [
  [/\bshould\b/i, /\bshould not\b/i], [/\bmust\b/i, /\bmust not\b/i],
  [/\balways\b/i, /\bnever\b/i], [/\benable\b/i, /\bdisable\b/i],
  [/\ballow\b/i, /\bdeny\b/i], [/\btrue\b/i, /\bfalse\b/i],
  [/\byes\b/i, /\bno\b/i], [/\binclude\b/i, /\bexclude\b/i],
  [/\bprefer\b/i, /\bavoid\b/i], [/\buse\b/i, /\bdo not use\b/i],
];

function hasContradictionSignal(a: string, b: string): boolean {
  for (const [patA, patB] of NEGATION_PAIRS) {
    if ((patA.test(a) && patB.test(b)) || (patB.test(a) && patA.test(b))) return true;
  }
  return false;
}

// topicOverlap (overlap / min set size) is computed inline in detectConflicts
// from the shared intersection pass — see the pair loop below.

const MIN_TIME_DIFF_MS = SUPERSEDED_MIN_TIME_DIFF_MS;
// Thresholds (DUPLICATE_THRESHOLD / CONTRADICTION_TOPIC_THRESHOLD /
// SUPERSEDED_TOPIC_THRESHOLD) are imported from `@/lib/memoryLimits`.

/** Per-memory text features, computed once per detectConflicts call so the
 * O(n²) pair loop never re-tokenizes or re-bigrams the same memory. */
interface MemoryFeatures {
  content: string;
  tokens: Set<string>;
  bigramSet: Set<string>;
}

export function detectConflicts(memories: PersonaMemory[]): MemoryConflict[] {
  const conflicts: MemoryConflict[] = [];

  // NOTE there is deliberately no `seen` de-dup set here. The pair loop below
  // starts `j` at `i + 1`, so it visits every unordered pair exactly once and a
  // de-dup guard could never fire. One stood here anyway (a Set, a `has`
  // check, three `add` calls) and read as protection against a re-entry hazard
  // the loop's own bounds already make impossible — which is worse than no
  // comment, because it misstates the invariant to the next reader.

  // O(n) precompute — previously each memory's title+content was
  // re-tokenized and re-bigrammed for every pair (~3·(n-1) times per memory).
  const features: MemoryFeatures[] = memories.map((m) => {
    const content = `${m.title} ${m.content}`;
    return { content, tokens: new Set(tokenize(content)), bigramSet: bigrams(content) };
  });

  for (let i = 0; i < memories.length; i++) {
    const fa = features[i]!;
    for (let j = i + 1; j < memories.length; j++) {
      const a = memories[i]!; const b = memories[j]!;
      const fb = features[j]!;
      const pairKey = [a.id, b.id].sort().join(':');
      const contentA = fa.content;
      const contentB = fb.content;

      // Single intersection pass powers both word-Jaccard and topic overlap.
      let intersection = 0;
      for (const t of fa.tokens) { if (fb.tokens.has(t)) intersection++; }
      // Zero shared tokens (with at least one non-empty set) ⇒ topic = 0 and
      // sim ≤ TEXT_SIM_BIGRAM_WEIGHT (0.6) < DUPLICATE_THRESHOLD (0.7): no
      // conflict kind can fire — skip before touching the larger bigram sets.
      if (intersection === 0 && (fa.tokens.size > 0 || fb.tokens.size > 0)) continue;

      const bothEmpty = fa.tokens.size === 0 && fb.tokens.size === 0;
      const union = fa.tokens.size + fb.tokens.size - intersection;
      const wordSim = bothEmpty ? 1 : (union === 0 ? 0 : intersection / union);
      const topic = (fa.tokens.size === 0 || fb.tokens.size === 0)
        ? 0
        : intersection / Math.min(fa.tokens.size, fb.tokens.size);

      // CONTRADICTION IS CHECKED FIRST, AND THE ORDER IS THE WHOLE POINT.
      //
      // The duplicate branch used to run ahead of this one and `continue`, so a
      // pair carrying an explicit negation could never be classified as a
      // contradiction if it ALSO scored as similar — and every entry in
      // NEGATION_PAIRS is a ONE-WORD swap (always/never, enable/disable,
      // allow/deny, true/false). "Always deploy on friday" vs "Never deploy on
      // friday" differ in a single token out of seven, which scores well above
      // DUPLICATE_THRESHOLD, so the sharpest contradictions in the store were
      // the ones guaranteed to be mislabelled. The consequence was not
      // cosmetic: ConflictCard offers Merge for `duplicate` and for nothing
      // else, and mergeMemories concatenates both bodies — so the UI's
      // recommended action on two opposite instructions was to fuse them into
      // one memory that says both, and inject that.
      //
      // A negation signal on a shared topic is therefore decisive: it is never
      // redundancy, however similar the two texts read.
      if (topic >= CONTRADICTION_TOPIC_THRESHOLD && hasContradictionSignal(contentA, contentB)) {
        conflicts.push({ id: pairKey, kind: 'contradiction', similarity: topic, memoryA: a, memoryB: b,
          reason: `Potentially contradictory instructions on the same topic (${Math.round(topic * 100)}% topic overlap)` });
        continue;
      }

      // Only pay for the bigram Jaccard when even a perfect bigram match
      // could push the blended score over the duplicate threshold.
      if (wordSim * TEXT_SIM_WORD_WEIGHT + TEXT_SIM_BIGRAM_WEIGHT >= DUPLICATE_THRESHOLD) {
        const sim = wordSim * TEXT_SIM_WORD_WEIGHT
          + jaccard(fa.bigramSet, fb.bigramSet) * TEXT_SIM_BIGRAM_WEIGHT;
        if (sim >= DUPLICATE_THRESHOLD) {
          const crossPersona = a.persona_id !== b.persona_id;
          conflicts.push({ id: pairKey, kind: 'duplicate', similarity: sim, memoryA: a, memoryB: b,
            reason: crossPersona ? `Near-duplicate memories across different agents (${Math.round(sim * 100)}% similar)` : `Near-duplicate memories within the same agent (${Math.round(sim * 100)}% similar)` });
          continue;
        }
      }

      if (topic >= SUPERSEDED_TOPIC_THRESHOLD) {
        const timeDiff = Math.abs(new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        if (timeDiff >= MIN_TIME_DIFF_MS) {
          const older = new Date(a.created_at) < new Date(b.created_at) ? a : b;
          const newer = older === a ? b : a;
          conflicts.push({ id: pairKey, kind: 'superseded', similarity: topic, memoryA: newer, memoryB: older,
            reason: `Newer memory may supersede an older one on the same topic (${Math.round(topic * 100)}% overlap)` });
        }
      }
    }
  }

  const kindOrder: Record<ConflictKind, number> = { contradiction: 0, duplicate: 1, superseded: 2 };
  conflicts.sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || b.similarity - a.similarity);
  return conflicts;
}

// ---------------------------------------------------------------------------
// Resolved-verdict recall
// ---------------------------------------------------------------------------

/**
 * A user's verdict on a conflict pair has to outlive the component that took
 * it. `MemoryConflictReview` held its resolved ids in component state, and the
 * Conflicts tab unmounts the moment you switch back to Memories — so every
 * pair the user had already judged reappeared on the next visit.
 *
 * That is worst exactly where it matters most. Detection is heuristic, so the
 * pairs a user DISMISSES are its false positives: the surface was guaranteed to
 * re-present its own worst output, forever, and a user who cleared ten of them
 * had to clear them again every time they came back.
 *
 * The ids are pair keys (`sorted(idA):sorted(idB)`), so they are stable across
 * sessions and cheap to store. They are capped for the same reason the
 * memory-action store now is: a key whose memories are long gone can never be
 * matched again and must not accumulate without limit.
 */
const RESOLVED_KEY = 'dolla:memory-conflicts-resolved';

/** Newest-kept cap on the persisted verdict set. */
export const MAX_RESOLVED_CONFLICTS = 200;

/** Reported once per session — this runs on every mount of the Conflicts tab,
 *  and a private-mode / storage-disabled profile would otherwise emit the same
 *  event on every visit for a condition whose only impact is re-showing pairs. */
let _resolvedStorageReported = false;

function reportStorageFailure(where: string, err: unknown): void {
  if (_resolvedStorageReported) return;
  _resolvedStorageReported = true;
  silentCatch(`memoryConflicts:${where}`)(err);
}

/** Read the persisted verdicts. Never throws: an unreadable store degrades to
 *  "the user is shown these conflicts again", which is wrong but not harmful. */
export function loadResolvedConflicts(): Set<string> {
  try {
    const raw = localStorage.getItem(RESOLVED_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    // The blob is whatever a previous build or a hand edit left behind, so the
    // shape is checked rather than asserted — a non-array, or a non-string
    // entry inside one, is dropped instead of poisoning the id set.
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === 'string'));
  } catch (err) {
    reportStorageFailure('loadResolvedConflicts', err);
    return new Set();
  }
}

/** Persist the verdict set, keeping the most recently added ids. */
export function saveResolvedConflicts(ids: Iterable<string>): void {
  try {
    // Set iteration is insertion-ordered, so the tail is the newest.
    localStorage.setItem(RESOLVED_KEY, JSON.stringify([...ids].slice(-MAX_RESOLVED_CONFLICTS)));
  } catch (err) {
    // The in-session Set still holds the verdicts, so the only loss is recall
    // after a restart.
    reportStorageFailure('saveResolvedConflicts', err);
  }
}
