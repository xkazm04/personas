// Pure helpers for the Contact Sheet shell (tested in __tests__/contactModel.test.ts).
//
// The wall groups refine rounds under the roll they refine, decides which
// strips may fetch their frames and which strip renders live iframes, and the
// loupe maps the grease-pencil glyph keys onto review buckets.
import type { ContestChainStep } from '@/lib/bindings/ContestChainStep';
import type { ContestDetail } from '@/lib/bindings/ContestDetail';
import type { ContestReviewBucket } from '@/lib/bindings/ContestReviewBucket';
import type { ContestSummary } from '@/lib/bindings/ContestSummary';
import type { ContestVariant } from '@/lib/bindings/ContestVariant';

/** Strips that fetch their detail (frames). Kept below the detail cache's
 *  twelve so the focused roll and a refine child stay warm beside them. */
export const WALL_LIVE_STRIPS = 8;

/** The grease-pencil mark per tray, and the key that draws it. */
export const MARK_GLYPH: Readonly<Record<ContestReviewBucket, string>> = {
  failure: '✕',
  impractical: '~',
  shortlist: '○',
  winner: '★',
};

const KEY_TO_BUCKET: Readonly<Record<string, ContestReviewBucket>> = {
  x: 'failure',
  X: 'failure',
  '~': 'impractical',
  o: 'shortlist',
  O: 'shortlist',
  '*': 'winner',
};

/** The bucket a typed glyph marks, or null for any other key. */
export function bucketForKey(key: string): ContestReviewBucket | null {
  return KEY_TO_BUCKET[key] ?? null;
}

export interface Roll {
  summary: ContestSummary;
  /** 0 for a root roll, 1+ for a refine round nested under its parent. */
  depth: number;
}

function keyOf(s: Pick<ContestSummary, 'projectId' | 'contestId'>): string {
  return `${s.projectId}/${s.contestId}`;
}

/**
 * The wall order: each root roll (newest first, as listed) followed by its
 * refine rounds, depth-first, oldest round first. A child whose parent is not
 * in the list is shown as a root, never dropped.
 */
export function groupRolls(summaries: readonly ContestSummary[]): Roll[] {
  const present = new Set(summaries.map(keyOf));
  const children = new Map<string, ContestSummary[]>();
  const roots: ContestSummary[] = [];
  for (const s of summaries) {
    const parentKey = s.parentId ? `${s.projectId}/${s.parentId}` : null;
    if (parentKey && parentKey !== keyOf(s) && present.has(parentKey)) {
      const list = children.get(parentKey) ?? [];
      list.push(s);
      children.set(parentKey, list);
    } else {
      roots.push(s);
    }
  }
  const out: Roll[] = [];
  const seen = new Set<string>();
  const walk = (s: ContestSummary, depth: number) => {
    const k = keyOf(s);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ summary: s, depth });
    const kids = [...(children.get(k) ?? [])].sort((a, b) => (a.round ?? 0) - (b.round ?? 0));
    for (const kid of kids) walk(kid, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  // Cycles (a malformed parent chain) never reach a root; keep them visible.
  for (const s of summaries) walk(s, 0);
  return out;
}

export type FrameMode = 'screenshot' | 'live' | 'latent' | 'missing';

/** How a frame cell renders: a deleted variant says so; a screenshot is the
 *  cheapest print; a live iframe only on the developed strip; else latent. */
export function frameMode(variant: Pick<ContestVariant, 'present' | 'previewUrl' | 'screenshots'>, live: boolean): FrameMode {
  if (!variant.present) return 'missing';
  if (variant.screenshots.length > 0) return 'screenshot';
  if (live && variant.previewUrl) return 'live';
  return 'latent';
}

/** The key after/before `current` in `keys`, wrapping around. */
export function stepKey(keys: readonly string[], current: string | null, delta: 1 | -1): string | null {
  if (keys.length === 0) return null;
  const i = current ? keys.indexOf(current) : -1;
  if (i < 0) return keys[0]!;
  return keys[(i + delta + keys.length) % keys.length]!;
}

/** The seat spec that made a variant (the unblinding map). */
export function seatSpecForVariant(detail: Pick<ContestDetail, 'seats'>, variant: Pick<ContestVariant, 'seatId'>): string | null {
  return detail.seats.find((s) => s.seatId === variant.seatId && s.kind === 'participant')?.spec ?? null;
}

export interface SpecParts {
  engine: string;
  model: string;
  effort: string;
  label: string | null;
}

/** Split `engine:model@effort[#label]` for chips; tolerant of odd tokens. */
export function specParts(spec: string): SpecParts {
  const m = /^([^:]+):([^@]+)@([^#]+)(?:#(.+))?$/.exec(spec);
  if (!m) return { engine: spec, model: '', effort: '', label: null };
  return { engine: m[1]!, model: m[2]!, effort: m[3]!, label: m[4] ?? null };
}

export type RailStep = 'collect' | 'visual' | 'judges' | 'ready';
export type RailState = 'done' | 'active' | 'todo' | 'failed';

/** The darkroom chain as a rail of steps with a state each. */
export function chainRail(step: ContestChainStep, judgesEnabled: boolean): { step: RailStep; state: RailState }[] {
  const steps: RailStep[] = judgesEnabled ? ['collect', 'visual', 'judges', 'ready'] : ['collect', 'visual', 'ready'];
  const at: Record<ContestChainStep, number> = {
    idle: -1,
    collecting: 0,
    visual: 1,
    judging: judgesEnabled ? 2 : 1,
    ready: steps.length - 1,
    failed: -2,
  };
  const pos = at[step];
  return steps.map((st, i) => ({
    step: st,
    state:
      step === 'failed'
        ? 'failed'
        : step === 'ready'
          ? 'done'
          : pos < 0
            ? 'todo'
            : i < pos
              ? 'done'
              : i === pos
                ? 'active'
                : 'todo',
  }));
}

/** Whether a roll is past developing and its frames can be sorted. */
export function isOnLoupe(detail: Pick<ContestDetail, 'variants'>): boolean {
  return detail.variants.length > 0;
}
