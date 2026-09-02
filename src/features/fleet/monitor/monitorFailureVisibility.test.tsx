/**
 * EVERY FAILURE ON THE MONITOR REACHES THE USER.
 *
 * The Activity board fuses three reads and all three used to fail into silence:
 * `list_manual_reviews` and `list_reports` ended at a `logger.error`,
 * `get_persona_summaries` at a `logger.warn` in the store, and a quick-execute
 * that never dispatched released its tile lock and said nothing. The board then
 * rendered exactly what a healthy idle fleet renders — grey tiles, no queue, no
 * "as of" — which is the one thing it must never do, because a held team step
 * disappearing quietly is indistinguishable from a fleet with nothing to do.
 *
 * One test per feed's failure, plus the strip that renders them and the toast
 * the quick-execute owes its operator.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, renderHook, act } from '@testing-library/react';

// --- i18n ------------------------------------------------------------------
// Every `t.section.key` resolves to the literal "section.key", so no catalog is
// needed and every leaf is a real string React can render.
const t = new Proxy(
  {},
  {
    get: (_o, section) =>
      new Proxy({}, { get: (_s, key) => `${String(section)}.${String(key)}` }),
  },
);
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t, tx: (s: unknown) => String(s), language: 'en' }),
}));

// --- api mocks -------------------------------------------------------------

const mockListReviews = vi.fn();
const mockListReports = vi.fn();
const mockGetSummaries = vi.fn();
const mockExecutePersona = vi.fn();

vi.mock('@/api/overview/reviews', () => ({
  listManualReviews: (...a: unknown[]) => mockListReviews(...a),
  listManualReviewsPage: vi.fn(),
  updateManualReviewStatus: vi.fn(),
  dispatchReviewAction: vi.fn(),
}));
vi.mock('@/api/overview/reports', () => ({
  listReports: (...a: unknown[]) => mockListReports(...a),
  markReportRead: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/api/system/cloud', () => ({ cloudRespondToReview: vi.fn() }));
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
vi.mock('@/api/agents/executions', () => ({
  executePersona: (...a: unknown[]) => mockExecutePersona(...a),
  listExecutionsSummary: vi.fn(),
}));

const toastCatchSpy = vi.fn();
vi.mock('@/lib/silentCatch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/silentCatch')>();
  return {
    ...actual,
    toastCatch: (context: string) => (err: unknown) => toastCatchSpy(context, err),
    silentCatch: () => () => {},
  };
});

/** Registered tickers by name — calling one is a poll tick. */
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

const agentState = {
  personas: [],
  personaHealthMap: {},
  personaSummariesError: null as string | null,
  personaSummariesRefreshedAt: null as number | null,
  fetchPersonaSummaries: vi.fn().mockResolvedValue(undefined),
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
vi.mock('@/stores/themeStore', () => ({
  useThemeStore: (sel: (s: { cvdSafe: boolean }) => unknown) => sel({ cvdSafe: false }),
}));

// The sigil drags the whole glyph pipeline; the wiring under test is the catch.
vi.mock('@/features/shared/glyph/CapabilitySigil', () => ({
  CapabilitySigil: () => <div data-testid="sigil" />,
}));
vi.mock(
  '@/features/agents/sub_use_cases/components/recipes-prototype/shared/displayUseCase',
  () => ({ getHealthMeta: () => ({ healthy: { label: 'healthy' } }) }),
);
vi.mock('@/hooks/utility/interaction/useMotion', () => ({ useReducedMotion: () => true }));

import { useMonitorData } from './useMonitorData';
import { MonitorFeedStatus } from './MonitorFeedStatus';
import { MonitorCapabilities } from './MonitorCapabilities';
import { createPersonaSlice, type PersonaSlice } from '@/stores/slices/agents/personaSlice';

// --- helpers ---------------------------------------------------------------

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

function report(id: string) {
  return {
    id, persona_id: 'p1', execution_id: null, title: id, content: 'x',
    content_type: 'markdown', priority: 'normal', is_read: false, metadata: null,
    created_at: '2026-01-01T00:00:00.000Z', read_at: null, thread_id: null,
    use_case_id: null,
  };
}

/** One tick of a named feed, then a re-render to read the result. */
async function tick(name: string, rerender: () => void) {
  await act(async () => { await pollers.get(name)?.(); });
  rerender();
}

beforeEach(() => {
  vi.clearAllMocks();
  pollers.clear();
  agentState.personaSummariesError = null;
  agentState.personaSummariesRefreshedAt = null;
  mockListReviews.mockResolvedValue([]);
  mockListReports.mockResolvedValue([report('m1')]);
  mockGetSummaries.mockResolvedValue([]);
});

// --- the three feeds -------------------------------------------------------

describe('useMonitorData — a failed feed says so', () => {
  it('reports a failed review read, and heals on the next success', async () => {
    mockListReviews.mockRejectedValueOnce(new Error('database is locked'));
    const { result, rerender } = renderHook(() => useMonitorData());

    await waitFor(() => expect(result.current.reviewsError).toBe('database is locked'));

    // A poll landing after recovery clears it — the flag is a state, not a latch.
    mockListReviews.mockResolvedValue([]);
    await tick('monitor:reviews', rerender);
    expect(result.current.reviewsError).toBeNull();
  });

  it('reports a failed messages read, and heals on the next success', async () => {
    mockListReports.mockRejectedValueOnce(new Error('reports table is gone'));
    const { result, rerender } = renderHook(() => useMonitorData());

    // Before this direction the failure ended at `logger.error`: an unreadable
    // inbox and an empty one produced the same idle-grey board.
    // Resolved through the error registry on the way in (an unclassified raw
    // string becomes the generic product sentence), so the assertion is that
    // the failure BECAME state — not that SQLite's wording survived.
    await waitFor(() => expect(result.current.messagesError).toBeTruthy());

    mockListReports.mockResolvedValue([report('m1')]);
    await tick('monitor:messages', rerender);
    expect(result.current.messagesError).toBeNull();
  });

  it('surfaces the health failure the store now carries', async () => {
    agentState.personaSummariesError = 'summaries unavailable';
    const { result } = renderHook(() => useMonitorData());
    expect(result.current.healthError).toBe('summaries unavailable');
  });

  it('stamps lastRefreshed from the OLDEST feed that actually succeeded', async () => {
    agentState.personaSummariesRefreshedAt = 1_000;
    const { result } = renderHook(() => useMonitorData());

    await waitFor(() => expect(result.current.lastRefreshed).toBe(1_000));
    // A healthy feed reading "just now" must not stamp a fresh time onto a
    // board whose other half is ten minutes stale.
    expect(result.current.lastRefreshed).toBeLessThan(Date.now());
  });
});

describe('personaSlice — a failed summaries read is state, not a log line', () => {
  it('records the failure and clears it on the next success', async () => {
    const h = personaHarness();
    expect(h.get().personaSummariesError).toBeNull();

    mockGetSummaries.mockRejectedValueOnce(new Error('no such table: personas'));
    await h.get().fetchPersonaSummaries();
    expect(h.get().personaSummariesError).toBe('no such table: personas');

    mockGetSummaries.mockResolvedValue([]);
    await h.get().fetchPersonaSummaries();
    expect(h.get().personaSummariesError).toBeNull();
    expect(h.get().personaSummariesRefreshedAt).toBeGreaterThan(0);
  });
});

// --- the strip -------------------------------------------------------------

describe('MonitorFeedStatus', () => {
  const healthy = {
    reviewsError: null,
    messagesError: null,
    healthError: null,
    lastRefreshed: Date.now(),
  };

  it('renders NOTHING when every feed answered', () => {
    const { container } = render(<MonitorFeedStatus {...healthy} />);
    expect(container.firstChild).toBeNull();
  });

  it('names each failed feed and stamps how old the board is', () => {
    render(
      <MonitorFeedStatus
        reviewsError="boom"
        messagesError="boom"
        healthError="boom"
        lastRefreshed={Date.now() - 60_000}
      />,
    );

    const strip = screen.getByTestId('monitor-feed-status');
    expect(strip.textContent).toContain('monitor.reviews_error');
    expect(strip.textContent).toContain('monitor.feed_error_messages');
    expect(strip.textContent).toContain('monitor.feed_error_health');
    // The "as of" is the half that makes an error honest rather than alarming:
    // it says how stale the board under it is.
    expect(screen.getByTestId('monitor-feed-as-of').textContent).toContain('monitor.feed_as_of');
  });

  it('says so plainly when nothing has EVER been read', () => {
    render(
      <MonitorFeedStatus
        reviewsError="boom"
        messagesError={null}
        healthError={null}
        lastRefreshed={null}
      />,
    );
    expect(screen.getByTestId('monitor-feed-as-of').textContent).toContain('monitor.feed_never');
  });
});

// --- the quick-execute -----------------------------------------------------

describe('MonitorCapabilities — a quick-execute that never started', () => {
  // The fixture only has to satisfy what this component reads (id/title/mode/
  // health/connector/raw.sample_input); `DisplayUseCase` carries a dozen more
  // fields the grid never touches, which is the invariant behind the cast.
  const useCase = {
    id: 'uc1',
    title: 'Summarise the inbox',
    mode: 'executable',
    health: 'healthy',
    connector: 'none',
    raw: { sample_input: null },
  } as unknown as Parameters<typeof MonitorCapabilities>[0]['useCases'][number];

  it('toasts the failure instead of releasing the lock in silence', async () => {
    mockExecutePersona.mockRejectedValueOnce(new Error('no runner available'));
    render(<MonitorCapabilities personaId="p1" useCases={[useCase]} />);

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(toastCatchSpy).toHaveBeenCalled());
    expect(toastCatchSpy.mock.calls[0]![0]).toBe('MonitorCapabilities:quickExecute');
    // The lock still releases — the run did not start, so the sigil must be
    // pressable again.
    await waitFor(() =>
      expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(false),
    );
  });

  it('says nothing when the dispatch succeeded', async () => {
    mockExecutePersona.mockResolvedValueOnce({ id: 'e1' });
    render(<MonitorCapabilities personaId="p1" useCases={[useCase]} />);

    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(mockExecutePersona).toHaveBeenCalled());
    expect(toastCatchSpy).not.toHaveBeenCalled();
  });
});
