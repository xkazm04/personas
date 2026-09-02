/**
 * WHAT AN UNCHANGED POLL COSTS THE ACTIVITY BOARD.
 *
 * Twice a minute the Monitor re-reads three feeds. On an idle fleet all three
 * come back saying exactly what they said last time — and the board rebuilt
 * anyway, because two of the three handed back fresh object identities for
 * identical content:
 *
 *  • `reloadMessages` allocated a new array unconditionally (`raw.filter(...)`).
 *  • `fetchPersonaSummaries` built and `set` a brand-new `personaHealthMap`.
 *
 * Either one invalidates the `buildMonitorModel` memo in `PersonaMonitor`
 * (deps `[personas, reviews, unreadMessages, activeProcesses, healthMap]`),
 * which re-sorts the fleet, hands `FleetGridView` a new `cards` prop and
 * defeats every memoized `PersonaTile` under it.
 *
 * This file MEASURES that, rather than asserting it in prose: `modelBuilds`
 * counts recomputations of a memo carrying the Monitor's exact dep tuple across
 * N polls that changed nothing. The reviews feed already had `sameReviews` and
 * is the control — it is what "0" is supposed to look like.
 *
 * The health map is driven through the REAL `personaSlice` (only its API module
 * is mocked), so the number below is the store's behaviour and not a mock's.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useMemo } from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { PersonaHealth } from '@/lib/bindings/PersonaHealth';

// --- mocks (must precede the import under test) ----------------------------

const mockGetSummaries = vi.fn();
const mockListReports = vi.fn();
const mockListReviews = vi.fn();

vi.mock('@/api/agents/personas', () => ({
  getPersonaSummaries: (...a: unknown[]) => mockGetSummaries(...a),
  listPersonas: vi.fn().mockResolvedValue([]),
  getPersonaDetail: vi.fn(),
  createPersona: vi.fn(),
  updatePersona: vi.fn(),
  deletePersona: vi.fn(),
  duplicatePersona: vi.fn(),
  buildUpdateInput: vi.fn(),
  operationToPartial: vi.fn(),
}));

vi.mock('@/api/overview/reports', () => ({
  listReports: (...a: unknown[]) => mockListReports(...a),
  markReportRead: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/api/overview/reviews', () => ({
  listManualReviews: (...a: unknown[]) => mockListReviews(...a),
  listManualReviewsPage: vi.fn(),
  updateManualReviewStatus: vi.fn(),
  dispatchReviewAction: vi.fn(),
}));

vi.mock('@/api/system/cloud', () => ({
  cloudRespondToReview: vi.fn(),
}));

/** Every registered ticker's fetch fn, by `name` — a "poll tick" is calling it. */
const pollers = new Map<string, () => unknown>();
vi.mock('@/hooks/utility/timing/usePolling', () => ({
  usePolling: (fn: () => unknown, opts: { enabled: boolean; name?: string }) => {
    if (opts.enabled && opts.name) pollers.set(opts.name, fn);
    return { isPolling: opts.enabled, lastRefreshed: null };
  },
  POLLING_CONFIG: {
    dashboardRefresh: { interval: 60_000 },
    cloudReviews: { interval: 60_000, maxBackoff: 60_000 },
  },
}));

vi.mock('@/lib/log', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('@sentry/react', () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  withScope: (fn: (scope: unknown) => void) => fn({ setTag: vi.fn(), setExtra: vi.fn() }),
}));

// The REAL persona slice, in a minimal zustand-shaped harness (the pattern
// `labSlice.fetchRuns.test.ts` uses). The health map's identity is the thing
// under measurement, so mocking the store would be measuring the mock.
import { createPersonaSlice, type PersonaSlice } from '@/stores/slices/agents/personaSlice';

function personaHarness() {
  let state = {} as PersonaSlice & Record<string, unknown>;
  const set = (partial: unknown) => {
    const patch = typeof partial === 'function'
      ? (partial as (s: typeof state) => object)(state)
      : partial;
    state = { ...state, ...(patch as object) };
  };
  const get = () => state as never;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state = { ...(createPersonaSlice as any)(set, get, {}) };
  return { get: () => state };
}

let slice = personaHarness();

const agentState = {
  get personas() { return slice.get().personas; },
  get personaHealthMap() { return slice.get().personaHealthMap; },
  fetchPersonaSummaries: () => slice.get().fetchPersonaSummaries(),
};
const overviewState = {
  activeProcesses: {},
  cloudReviews: [] as unknown[],
  fetchCloudReviews: vi.fn().mockResolvedValue(undefined),
  fetchPendingReviewCount: vi.fn().mockResolvedValue(undefined),
  fetchUnreadReportCount: vi.fn().mockResolvedValue(undefined),
};
const systemState = { cloudConfig: { is_connected: false } };

vi.mock('@/stores/agentStore', () => ({
  useAgentStore: (sel: (s: typeof agentState) => unknown) => sel(agentState),
}));
vi.mock('@/stores/overviewStore', () => ({
  useOverviewStore: (sel: (s: typeof overviewState) => unknown) => sel(overviewState),
}));
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (sel: (s: typeof systemState) => unknown) => sel(systemState),
}));

import { useMonitorData } from './useMonitorData';

// --- fixtures --------------------------------------------------------------

function health(status: string): PersonaHealth {
  return {
    status: status as PersonaHealth['status'],
    recentStatuses: ['completed', 'completed'],
    successRate: 1,
    totalRecent: 2n,
    runsToday: 1n,
    sparkline: [0n, 0n, 0n, 0n, 0n, 1n, 1n],
  };
}

/** A summary row shaped the way `getPersonaSummaries` shapes one. */
function summary(personaId: string, status = 'healthy') {
  return {
    personaId,
    enabledTriggerCount: 1,
    lastRunAt: '2026-01-01T00:00:00.000Z',
    health: health(status),
  };
}

function report(id: string, isRead = false) {
  return {
    id,
    persona_id: 'p1',
    execution_id: null,
    title: `Report ${id}`,
    content: 'body',
    content_type: 'markdown',
    priority: 'normal',
    is_read: isRead,
    metadata: null,
    created_at: '2026-01-01T00:00:00.000Z',
    read_at: null,
    thread_id: null,
    use_case_id: null,
  };
}

function review(id: string) {
  return {
    id,
    persona_id: 'p1',
    execution_id: 'e1',
    severity: 'high',
    title: `Review ${id}`,
    description: null,
    status: 'pending',
    reviewer_notes: null,
    context_data: null,
    suggested_actions: null,
    created_at: '2026-01-01T00:00:00.000Z',
    resolved_at: null,
  };
}

// --- harness ---------------------------------------------------------------

/** Recomputations of a memo carrying `PersonaMonitor`'s exact dep tuple. */
let modelBuilds = 0;

function useMeasuredMonitor() {
  const data = useMonitorData();
  useMemo(() => {
    modelBuilds += 1;
    // Stands in for `buildMonitorModel(personas, reviews, unreadMessages,
    // activeProcesses, healthMap)` — the count is what matters, and touching
    // every input keeps the dep list honest.
    return [
      data.personas.length,
      data.reviews.length,
      data.unreadMessages.length,
      Object.keys(data.activeProcesses).length,
      Object.keys(data.healthMap).length,
    ];
  }, [data.personas, data.reviews, data.unreadMessages, data.activeProcesses, data.healthMap]);
  return data;
}

/** Mount and settle every feed's first read (the mocked store is not reactive,
 *  so the final `rerender` is what re-reads the slice's health map). */
async function mountMeasured() {
  const view = renderHook(() => useMeasuredMonitor());
  await waitFor(() => expect(mockListReviews).toHaveBeenCalled());
  await waitFor(() => expect(mockListReports).toHaveBeenCalled());
  await waitFor(() => expect(mockGetSummaries).toHaveBeenCalled());
  await act(async () => { await Promise.resolve(); });
  view.rerender();
  return view;
}

/** One poll tick of all three local feeds, then a re-render to read the store. */
async function tick(rerender: () => void) {
  await act(async () => {
    await pollers.get('monitor:reviews')?.();
    await pollers.get('monitor:messages')?.();
    await pollers.get('monitor:personaHealth')?.();
  });
  rerender();
}

beforeEach(() => {
  vi.clearAllMocks();
  pollers.clear();
  modelBuilds = 0;
  slice = personaHarness();
  mockListReviews.mockResolvedValue([review('r1')]);
  mockListReports.mockResolvedValue([report('m1'), report('m2', true)]);
  mockGetSummaries.mockResolvedValue([summary('p1'), summary('p2')]);
});

describe('the Monitor model memo across an UNCHANGED poll', () => {
  it('is not recomputed at all — three ticks, nothing moved', async () => {
    const { result, rerender } = await mountMeasured();
    await waitFor(() => expect(result.current.reviews.length).toBe(1));
    await waitFor(() => expect(result.current.unreadMessages.length).toBe(1));
    await waitFor(() => expect(Object.keys(result.current.healthMap).length).toBe(2));

    // Everything settled: from here on the backend says the same thing.
    modelBuilds = 0;
    for (let i = 0; i < 3; i += 1) await tick(rerender);

    // THE MEASUREMENT. One recompute per tick per fresh-identity feed is what
    // an idle fleet used to pay; the target is zero.
    expect(modelBuilds).toBe(0);
  });

  it('keeps the SAME unread-messages array', async () => {
    const { result, rerender } = await mountMeasured();
    await waitFor(() => expect(result.current.unreadMessages.length).toBe(1));
    const first = result.current.unreadMessages;

    await tick(rerender);
    expect(result.current.unreadMessages).toBe(first);
  });

  it('keeps the SAME personaHealthMap', async () => {
    const { result, rerender } = await mountMeasured();
    await waitFor(() => expect(Object.keys(result.current.healthMap).length).toBe(2));
    const first = result.current.healthMap;

    await tick(rerender);
    expect(result.current.healthMap).toBe(first);
  });
});

describe('the bail-out is a cache, not a freeze', () => {
  it('hands back a NEW unread array when a message arrives', async () => {
    const { result, rerender } = await mountMeasured();
    await waitFor(() => expect(result.current.unreadMessages.length).toBe(1));
    const first = result.current.unreadMessages;

    mockListReports.mockResolvedValue([report('m1'), report('m3')]);
    await tick(rerender);

    expect(result.current.unreadMessages).not.toBe(first);
    expect(result.current.unreadMessages).toHaveLength(2);
  });

  it('hands back a NEW unread array when a message is read elsewhere', async () => {
    const { result, rerender } = await mountMeasured();
    await waitFor(() => expect(result.current.unreadMessages.length).toBe(1));
    const first = result.current.unreadMessages;

    mockListReports.mockResolvedValue([report('m1', true), report('m2', true)]);
    await tick(rerender);

    expect(result.current.unreadMessages).not.toBe(first);
    expect(result.current.unreadMessages).toHaveLength(0);
  });

  it('hands back a NEW health map when a persona degrades', async () => {
    const { result, rerender } = await mountMeasured();
    await waitFor(() => expect(Object.keys(result.current.healthMap).length).toBe(2));
    const first = result.current.healthMap;

    mockGetSummaries.mockResolvedValue([summary('p1', 'failing'), summary('p2')]);
    await tick(rerender);

    expect(result.current.healthMap).not.toBe(first);
    expect(result.current.healthMap.p1!.status).toBe('failing');
  });

  it('hands back a NEW health map when a persona joins the fleet', async () => {
    const { result, rerender } = await mountMeasured();
    await waitFor(() => expect(Object.keys(result.current.healthMap).length).toBe(2));
    const first = result.current.healthMap;

    mockGetSummaries.mockResolvedValue([summary('p1'), summary('p2'), summary('p3')]);
    await tick(rerender);

    expect(result.current.healthMap).not.toBe(first);
    expect(Object.keys(result.current.healthMap)).toHaveLength(3);
  });
});
