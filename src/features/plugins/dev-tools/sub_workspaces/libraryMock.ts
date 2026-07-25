// Deterministic demo dataset for the knowledge library — models what a
// self-evolving workspace looks like after ~9 months of harvesting: hundreds
// of items across an emergent multi-level topic taxonomy. Seeded PRNG keyed by
// workspace id so every reload renders the same corpus. Never written to the
// DB; rows are flagged `mock: true`.
import type { KnowledgeKind, KnowledgeStatus } from '@/api/devTools/workspaces';

import type { KnowledgeItemView } from './libraryModel';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Taxonomy sample drawn from the CLOSED vocabulary in
// `db/repos/workspace_taxonomy.rs` — always `area/cluster`, never deeper. The
// demo corpus is a teaching artifact: when it showed three-level invented
// paths it modelled exactly the fragmentation the ingest door now prevents.
// The RENDERER still enumerates nothing; the tree is derived from the data.
const TOPICS = [
  'architecture/boundaries',
  'architecture/chokepoints',
  'architecture/extensibility',
  'architecture/contract-artifacts',
  'data/store-boundary',
  'data/migrations',
  'data/modeling',
  'errors/result-contracts',
  'errors/degradation',
  'errors/surfacing',
  'llm/chokepoint',
  'llm/providers',
  'llm/quality-gates',
  'frontend/components',
  'frontend/state',
  'frontend/forms',
  'testing/strategy',
  'testing/harnesses',
  'performance/hot-paths',
  'performance/caching',
  'concurrency/pipelines',
  'concurrency/retry-idempotency',
  'auth/tenancy',
  'billing/metering',
  'observability/logging',
  'process/adr-discipline',
] as const;

const FRAMEWORKS = ['React', 'Tauri', 'Rust', 'Tailwind', 'Zustand', 'Vite', 'Next.js', 'Axum'] as const;

// Categorization axes for demo realism — skew toward meso/durable like the
// real scan, with a mechanical/micro tail that the "hide lint layer" filter drops.
const ABSTRACTIONS: { value: 'macro' | 'meso' | 'micro'; weight: number }[] = [
  { value: 'macro', weight: 0.2 },
  { value: 'meso', weight: 0.6 },
  { value: 'micro', weight: 0.2 },
];
const FTYPES = [
  'architecture', 'module-boundary', 'data-flow', 'extensibility', 'api-design',
  'state-mgmt', 'error-strategy', 'concurrency-reliability', 'perf-strategy', 'micro-technique',
] as const;

const KINDS: { value: KnowledgeKind; weight: number }[] = [
  { value: 'pattern', weight: 0.34 },
  { value: 'pitfall', weight: 0.22 },
  { value: 'decision', weight: 0.16 },
  { value: 'howto', weight: 0.18 },
  { value: 'fact', weight: 0.1 },
];

const STATUSES: { value: KnowledgeStatus; weight: number }[] = [
  { value: 'observed', weight: 0.38 },
  { value: 'proposed', weight: 0.17 },
  { value: 'adopted', weight: 0.3 },
  { value: 'rejected', weight: 0.1 },
  { value: 'deprecated', weight: 0.05 },
];

const TITLE_STEMS: Record<KnowledgeKind, string[]> = {
  pattern: ['Prefer', 'Standardize on', 'Extract', 'Co-locate', 'Batch'],
  pitfall: ['Never', 'Avoid', 'Watch for', "Don't rely on", 'Guard against'],
  decision: ['Adopt', 'Retire', 'Freeze', 'Consolidate on', 'Split'],
  howto: ['How to wire', 'How to migrate', 'How to profile', 'How to test', 'How to debug'],
  fact: ['Limit:', 'Behavior:', 'Constraint:', 'Baseline:', 'Contract:'],
};

const SUBJECTS = [
  'sticky group headers in virtual lists',
  'decay-scored recall packing',
  'ts-rs binding regeneration',
  'IPC command timeout envelopes',
  'semantic radius tokens',
  'segmented tab keyboard nav',
  'SQLite WAL checkpointing',
  'framer-motion SVG transforms',
  'section-split locale chunks',
  'pre-commit gate ordering',
  'connector credential scoping',
  'empty-state illustration budget',
  'worktree-per-session isolation',
  'toast-vs-silent error routing',
  'suspense fallback layering',
  'content-hash skill revisions',
];

function pick<T>(rnd: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rnd() * arr.length)]!;
}

function weightedPick<T>(rnd: () => number, entries: readonly { value: T; weight: number }[]): T {
  const r = rnd();
  let acc = 0;
  for (const e of entries) {
    acc += e.weight;
    if (r <= acc) return e.value;
  }
  return entries[entries.length - 1]!.value;
}

/** ~`count` demo items spread over the trailing 9 months, volume ramping up —
 *  the "self-evolving workspace" growth curve. */
export function generateMockLibrary(
  workspaceId: string,
  memberProjectIds: readonly string[],
  count = 260,
): KnowledgeItemView[] {
  const rnd = mulberry32(hashString(workspaceId));
  const now = Date.now();
  const out: KnowledgeItemView[] = [];

  for (let i = 0; i < count; i++) {
    const kind = weightedPick(rnd, KINDS);
    const status = weightedPick(rnd, STATUSES);
    const topic = pick(rnd, TOPICS);
    // Ramp: recent months carry more volume (quadratic bias toward now).
    const ageDays = Math.floor(270 * (1 - Math.sqrt(rnd())));
    const createdMs = now - ageDays * 86_400_000 - Math.floor(rnd() * 86_400_000);
    const updatedMs = createdMs + Math.floor(rnd() * 14 * 86_400_000);
    const stem = pick(rnd, TITLE_STEMS[kind]);
    const subject = pick(rnd, SUBJECTS);
    const framework = rnd() < 0.6 ? pick(rnd, FRAMEWORKS) : null;
    const abstraction = weightedPick(rnd, ABSTRACTIONS);
    const durability =
      abstraction === 'micro' ? 'mechanical' : rnd() < 0.85 ? 'durable' : 'situational';

    out.push({
      id: `mock-${workspaceId}-${i}`,
      kind,
      status,
      title: `${stem} ${subject}`,
      statement: `${stem} ${subject} — demo item illustrating library scale; harvested corpora carry a distilled claim here.`,
      topic,
      layers: [topic.split('/')[0]!],
      frameworks: framework ? [framework] : [],
      originProjectId:
        memberProjectIds.length > 0 && rnd() < 0.85
          ? memberProjectIds[Math.floor(rnd() * memberProjectIds.length)]!
          : null,
      createdAt: new Date(createdMs).toISOString(),
      updatedAt: new Date(Math.min(updatedMs, now)).toISOString(),
      // Only adjudicated rows carry a decision timestamp — the same invariant
      // the real ladder holds, so the digest treats demo rows correctly if
      // they ever reach it (they are filtered out, but the shape stays honest).
      decidedAt:
        status === 'observed' || status === 'proposed'
          ? null
          : new Date(Math.min(updatedMs, now)).toISOString(),
      confidence: status === 'observed' ? Math.round(rnd() * 40 + 55) / 100 : null,
      abstraction,
      ftype: pick(rnd, FTYPES),
      durability,
      governingId: null,
      evidenceCount: abstraction === 'micro' ? Math.floor(rnd() * 40 + 5) : null,
      mock: true,
    });
  }
  return out;
}
