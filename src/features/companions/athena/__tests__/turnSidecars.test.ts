import { describe, expect, it, vi } from 'vitest';
import type { CompanionRecallPreview, CompanionTurnSidecar } from '@/api/companion';
import type { StoredNarration } from '../narrationTimeline';
import type { TodoStep } from '../operationalSteps';
import type { StoredTurnSummary } from '../companionStore';
import {
  MAX_PERSISTED_NARRATION_ENTRIES,
  capNarration,
  isEmptyHydration,
  parseSidecars,
  serializeSidecar,
} from '../turnSidecars';

vi.mock('@/lib/silentCatch', () => ({
  silentCatch: () => () => {},
  toastCatch: () => () => {},
}));

const narration: StoredNarration = {
  startedAt: 1_000,
  endedAt: 4_000,
  entries: [
    { id: 't1', kind: 'tool', toolName: 'Read', detail: 'foo.ts', at: 1_100, endedAt: 1_400 },
    { id: 'b1', kind: 'beat', text: 'Looking at the store', at: 1_500 },
  ],
};

const steps: TodoStep[] = [
  { content: 'Persist sidecars', status: 'completed' },
  { content: 'Hydrate on load', status: 'in_progress' },
];

const summary: StoredTurnSummary = {
  approvals: 1,
  navigations: 2,
  labOpens: 0,
  dashboards: 0,
  cockpits: 0,
  chatCards: 3,
  continuation: false,
} as StoredTurnSummary;

const recall: CompanionRecallPreview = {
  episodeCount: 7,
  doctrine: [{ id: 'd1', title: 'Never stash' }],
  facts: [],
  procedurals: [],
  goals: [],
  backlog: [],
  synthesized: true,
};

function row(over: Partial<CompanionTurnSidecar> = {}): CompanionTurnSidecar {
  return {
    episodeId: 'ep_1',
    narrationJson: null,
    stepsJson: null,
    summaryJson: null,
    recallJson: null,
    ...over,
  };
}

describe('capNarration', () => {
  it('leaves a short trail untouched (same object)', () => {
    expect(capNarration(narration)).toBe(narration);
  });

  it('keeps the newest N entries when the trail is too long', () => {
    const long: StoredNarration = {
      startedAt: 0,
      endedAt: 1,
      entries: Array.from({ length: MAX_PERSISTED_NARRATION_ENTRIES + 25 }, (_, i) => ({
        id: `e${i}`,
        kind: 'tool' as const,
        toolName: 'Bash',
        at: i,
      })),
    };
    const capped = capNarration(long);
    expect(capped.entries).toHaveLength(MAX_PERSISTED_NARRATION_ENTRIES);
    expect(capped.entries[0]!.id).toBe('e25');
    expect(capped.entries.at(-1)!.id).toBe(`e${MAX_PERSISTED_NARRATION_ENTRIES + 24}`);
    expect(capped.startedAt).toBe(0);
    expect(capped.endedAt).toBe(1);
  });
});

describe('serializeSidecar', () => {
  it('returns null when there is nothing worth a row', () => {
    expect(serializeSidecar('ep_1', {})).toBeNull();
    expect(serializeSidecar('ep_1', { narration: { ...narration, entries: [] }, steps: [] })).toBeNull();
    expect(serializeSidecar('', { summary })).toBeNull();
  });

  it('emits only the channels that are present', () => {
    const out = serializeSidecar('ep_1', { summary })!;
    expect(out.episodeId).toBe('ep_1');
    expect(out.summaryJson).toBeDefined();
    expect(out.narrationJson).toBeUndefined();
    expect(out.stepsJson).toBeUndefined();
    expect(out.recallJson).toBeUndefined();
  });
});

describe('serialize → parse round trip', () => {
  it('preserves every channel in its live shape', () => {
    const serialized = serializeSidecar('ep_1', { narration, steps, summary, recall })!;
    const hydrated = parseSidecars([
      row({
        narrationJson: serialized.narrationJson ?? null,
        stepsJson: serialized.stepsJson ?? null,
        summaryJson: serialized.summaryJson ?? null,
        recallJson: serialized.recallJson ?? null,
      }),
    ]);

    expect(hydrated.narrationByEpisodeId.ep_1).toEqual(narration);
    expect(hydrated.stepsByEpisodeId.ep_1).toEqual(steps);
    expect(hydrated.turnSummaryByEpisodeId.ep_1).toEqual(summary);
    expect(hydrated.recallByEpisodeId.ep_1).toEqual(recall);
    expect(isEmptyHydration(hydrated)).toBe(false);
  });

  it('keys each episode independently', () => {
    const a = serializeSidecar('ep_a', { steps })!;
    const b = serializeSidecar('ep_b', { recall })!;
    const hydrated = parseSidecars([
      row({ episodeId: 'ep_a', stepsJson: a.stepsJson ?? null }),
      row({ episodeId: 'ep_b', recallJson: b.recallJson ?? null }),
    ]);
    expect(Object.keys(hydrated.stepsByEpisodeId)).toEqual(['ep_a']);
    expect(Object.keys(hydrated.recallByEpisodeId)).toEqual(['ep_b']);
  });
});

describe('parseSidecars resilience', () => {
  it('drops corrupt blobs instead of throwing', () => {
    const hydrated = parseSidecars([
      row({ narrationJson: '{not json', stepsJson: JSON.stringify(steps) }),
    ]);
    expect(hydrated.narrationByEpisodeId.ep_1).toBeUndefined();
    expect(hydrated.stepsByEpisodeId.ep_1).toEqual(steps);
  });

  it('ignores empty trails, empty plans, and rows without an id', () => {
    const hydrated = parseSidecars([
      row({ narrationJson: JSON.stringify({ startedAt: 0, endedAt: 1, entries: [] }) }),
      row({ episodeId: '', stepsJson: JSON.stringify(steps) }),
      row({ episodeId: 'ep_2', stepsJson: '[]' }),
    ]);
    expect(isEmptyHydration(hydrated)).toBe(true);
  });

  it('reports an empty hydration for an empty row set', () => {
    expect(isEmptyHydration(parseSidecars([]))).toBe(true);
  });
});
