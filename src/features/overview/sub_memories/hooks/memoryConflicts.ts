import type { PersonaMemory } from '@/lib/bindings/PersonaMemory';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConflictKind = 'duplicate' | 'contradiction' | 'superseded';

export interface MemoryConflict {
  id: string;
  kind: ConflictKind;
  similarity: number; // 0-1
  memoryA: PersonaMemory;
  memoryB: PersonaMemory;
  reason: string;
}

export type ConflictResolution = 'merge' | 'keep_a' | 'keep_b' | 'dismiss';

// ---------------------------------------------------------------------------
// Text normalization
// ---------------------------------------------------------------------------

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text: string): string[] {
  return normalize(text).split(' ').filter((w) => w.length > 2);
}

// ---------------------------------------------------------------------------
// Similarity -- word-level Jaccard + bigram overlap
// ---------------------------------------------------------------------------

function jaccard(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function bigrams(text: string): Set<string> {
  const norm = normalize(text);
  const set = new Set<string>();
  for (let i = 0; i < norm.length - 1; i++) {
    set.add(norm.slice(i, i + 2));
  }
  return set;
}

export function textSimilarity(a: string, b: string): number {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));
  const wordSim = jaccard(tokensA, tokensB);
  const bigramSim = jaccard(bigrams(a), bigrams(b));
  // Weighted: bigrams catch partial matches better
  return wordSim * 0.4 + bigramSim * 0.6;
}

// ---------------------------------------------------------------------------
// Contradiction signals
// ---------------------------------------------------------------------------

const NEGATION_PAIRS: Array<[RegExp, RegExp]> = [
  [/\bshould\b/i, /\bshould not\b/i],
  [/\bmust\b/i, /\bmust not\b/i],
  [/\balways\b/i, /\bnever\b/i],
  [/\benable\b/i, /\bdisable\b/i],
  [/\ballow\b/i, /\bdeny\b/i],
  [/\btrue\b/i, /\bfalse\b/i],
  [/\byes\b/i, /\bno\b/i],
  [/\binclude\b/i, /\bexclude\b/i],
  [/\bprefer\b/i, /\bavoid\b/i],
  [/\buse\b/i, /\bdo not use\b/i],
];

function hasContradictionSignal(a: string, b: string): boolean {
  for (const [patA, patB] of NEGATION_PAIRS) {
    if ((patA.test(a) && patB.test(b)) || (patB.test(a) && patA.test(b))) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Superseded detection (same topic, different timestamps)
// ---------------------------------------------------------------------------

function topicOverlap(a: string, b: string): number {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let overlap = 0;
  for (const t of tokensA) if (tokensB.has(t)) overlap++;
  return overlap / Math.min(tokensA.size, tokensB.size);
}

// ---------------------------------------------------------------------------
// Main detection
// ---------------------------------------------------------------------------

const DUPLICATE_THRESHOLD = 0.7;
const CONTRADICTION_TOPIC_THRESHOLD = 0.4;
const SUPERSEDED_TOPIC_THRESHOLD = 0.6;
const MIN_TIME_DIFF_MS = 60 * 60 * 1000; // 1 hour

export function detectConflicts(memories: PersonaMemory[]): MemoryConflict[] {
  const conflicts: MemoryConflict[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < memories.length; i++) {
    for (let j = i + 1; j < memories.length; j++) {
      const a = memories[i]!;
      const b = memories[j]!;
      const pairKey = [a.id, b.id].sort().join(':');
      if (seen.has(pairKey)) continue;

      const contentA = `${a.title} ${a.content}`;
      const contentB = `${b.title} ${b.content}`;
      const sim = textSimilarity(contentA, contentB);
      const topic = topicOverlap(contentA, contentB);

      // 1. Duplicate detection (high overall similarity)
      if (sim >= DUPLICATE_THRESHOLD) {
        seen.add(pairKey);
        const crossPersona = a.persona_id !== b.persona_id;
        conflicts.push({
          id: pairKey,
          kind: 'duplicate',
          similarity: sim,
          memoryA: a,
          memoryB: b,
          reason: crossPersona
            ? `Near-duplicate memories across different agents (${Math.round(sim * 100)}% similar)`
            : `Near-duplicate memories within the same agent (${Math.round(sim * 100)}% similar)`,
        });
        continue;
      }

      // 2. Contradiction detection (moderate topic overlap + negation signals)
      if (topic >= CONTRADICTION_TOPIC_THRESHOLD && hasContradictionSignal(contentA, contentB)) {
        seen.add(pairKey);
        conflicts.push({
          id: pairKey,
          kind: 'contradiction',
          similarity: topic,
          memoryA: a,
          memoryB: b,
          reason: `Potentially contradictory instructions on the same topic (${Math.round(topic * 100)}% topic overlap)`,
        });
        continue;
      }

      // 3. Superseded detection (high topic overlap, significant time difference)
      if (topic >= SUPERSEDED_TOPIC_THRESHOLD) {
        const timeDiff = Math.abs(
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        );
        if (timeDiff >= MIN_TIME_DIFF_MS) {
          const older = new Date(a.created_at) < new Date(b.created_at) ? a : b;
          const newer = older === a ? b : a;
          seen.add(pairKey);
          conflicts.push({
            id: pairKey,
            kind: 'superseded',
            similarity: topic,
            memoryA: newer,
            memoryB: older,
            reason: `Newer memory may supersede an older one on the same topic (${Math.round(topic * 100)}% overlap)`,
          });
        }
      }
    }
  }

  // Sort: contradictions first, then duplicates, then superseded
  const kindOrder: Record<ConflictKind, number> = { contradiction: 0, duplicate: 1, superseded: 2 };
  conflicts.sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || b.similarity - a.similarity);

  return conflicts;
}
