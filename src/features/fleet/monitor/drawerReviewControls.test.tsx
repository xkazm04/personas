/**
 * A REVIEWER CLEARING A STACK IS NEVER BLOCKED BY THE ROW ABOVE.
 *
 * `useMonitorData` states its contract in prose: `isProcessing` is
 * "presentational only — the write guard is per-review". The drawer's review
 * card ignored that: `act()` early-returned on the GLOBAL flag and both
 * verdict buttons carried `disabled={isProcessing}`, so approving one review
 * greyed out every other review until the round-trip landed — the exact case
 * the keyed ledger was built to unblock.
 *
 * These tests pin the fixed behaviour at the two levels it lives at:
 *  - the hook, which now exposes the narrow `isReviewInFlight(id, intent)`;
 *  - the card, which binds each control to that query and can dispatch a
 *    suggested action.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, renderHook, act } from '@testing-library/react';

// --- i18n ------------------------------------------------------------------
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

// --- api mocks (the hook half) ---------------------------------------------
const mockResolveRow = vi.fn();
const mockDispatchRow = vi.fn();
vi.mock('@/lib/decisions/rowWrites', () => ({
  resolveReviewRow: (...a: unknown[]) => mockResolveRow(...a),
  dispatchReviewRowAction: (...a: unknown[]) => mockDispatchRow(...a),
  isDecisionConflict: () => false,
}));
const mockListReviews = vi.fn();
vi.mock('@/api/overview/reviews', () => ({
  listManualReviews: (...a: unknown[]) => mockListReviews(...a),
  listManualReviewsPage: vi.fn(),
}));
vi.mock('@/api/overview/reports', () => ({
  listReports: vi.fn().mockResolvedValue([]),
  markReportRead: vi.fn().mockResolvedValue(undefined),
}));
/** Registered tickers by name — calling one is a poll tick, under our control. */
const pollers = new Map<string, () => unknown>();
vi.mock('@/hooks/utility/timing/usePolling', async (importOriginal) => ({
  // Keep the REAL POLLING_CONFIG — the hook reads nested cadences off it and a
  // hand-shaped stub silently becomes `undefined.interval`.
  ...(await importOriginal<typeof import('@/hooks/utility/timing/usePolling')>()),
  usePolling: (fn: () => unknown, opts: { enabled?: boolean; name?: string }) => {
    if (opts.enabled !== false && opts.name) pollers.set(opts.name, fn);
    return { lastRefreshed: null, refresh: fn };
  },
}));
vi.mock('@/hooks/realtime/useReportCreatedListener', () => ({
  useReportCreatedListener: () => {},
}));

import { useMonitorData } from './useMonitorData';
import { DrawerReviewCard } from './DrawerReviewCard';
import type { ManualReviewItem } from '@/lib/types/types';
import type { ManualReviewStatus } from '@/lib/bindings/ManualReviewStatus';

const review = (over: Partial<ManualReviewItem> = {}): ManualReviewItem =>
  ({
    id: 'r1',
    title: 'Bump the version',
    content: 'The changelog is ready.',
    severity: 'medium',
    status: 'pending',
    created_at: new Date().toISOString(),
    persona_id: 'p1',
    persona_name: 'Ada',
    source: 'local',
    context_data: null,
    suggested_actions: null,
    ...over,
  }) as ManualReviewItem;

/** A promise whose settlement this test controls. */
function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = () => res();
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** The raw backend row the reviews loader shapes. */
const rawRow = (id: string) => ({
  id,
  persona_id: 'p1',
  execution_id: null,
  title: 'Bump the version',
  description: 'The changelog is ready.',
  severity: 'medium',
  status: 'pending',
  reviewer_notes: null,
  context_data: null,
  suggested_actions: null,
  created_at: new Date().toISOString(),
  resolved_at: null,
  assignment_id: null,
  step_id: null,
  use_case_id: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  pollers.clear();
  mockListReviews.mockResolvedValue([rawRow('r1')]);
  mockResolveRow.mockResolvedValue(undefined);
  mockDispatchRow.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// The hook — the ledger is readable per review, not just in aggregate
// ---------------------------------------------------------------------------

describe('useMonitorData.isReviewInFlight', () => {
  it('reports only the row+intent actually in flight, while isProcessing is global', async () => {
    const first = deferred();
    mockResolveRow.mockReturnValueOnce(first.promise);

    const { result } = renderHook(() => useMonitorData({ messages: false, personaHealth: false }));

    // The writers refuse a row that is not in the pending queue, so the queue
    // has to be REAL before the ledger can be observed. Drive one poll tick.
    await act(async () => {
      await pollers.get('monitor:reviews')?.();
    });
    expect(result.current.reviews.map((r) => r.id)).toEqual(['r1']);

    // The mocked writer resolves (never rejects), so nothing here needs a
    // catch — an inline one would only be noise the lint rule is right about.
    let pending: Promise<void> | undefined;
    act(() => {
      pending = result.current.handleReviewAction('r1', 'approved' as ManualReviewStatus);
    });

    await waitFor(() => expect(result.current.isProcessing).toBe(true));

    // The pressed control's intent, on its own row.
    expect(result.current.isReviewInFlight('r1', 'approved')).toBe(true);
    // The OTHER verdict on the SAME row is free — two different verdicts must
    // both be able to reach the backend (the CAS picks the winner).
    expect(result.current.isReviewInFlight('r1', 'rejected')).toBe(false);
    // And no other row is touched, which is the whole point.
    expect(result.current.isReviewInFlight('r2', 'approved')).toBe(false);
    expect(result.current.isReviewInFlight('r2')).toBe(false);
    // Row-level query (no intent) still sees it.
    expect(result.current.isReviewInFlight('r1')).toBe(true);

    await act(async () => {
      first.resolve();
      await pending;
    });
    await waitFor(() => expect(result.current.isReviewInFlight('r1')).toBe(false));
  });
});

// ---------------------------------------------------------------------------
// The card — the controls bind to that query
// ---------------------------------------------------------------------------

describe('DrawerReviewCard controls', () => {
  it('leaves the second row live while the first row is writing', () => {
    // Exactly the state the hook is in mid-write on r1.
    const inFlight = (id: string, intent?: string) =>
      id === 'r1' && (intent === undefined || intent === 'approved');

    render(
      <>
        <DrawerReviewCard
          review={review({ id: 'r1' })}
          personaName="Ada"
          isReviewInFlight={inFlight}
          onAction={vi.fn().mockResolvedValue(undefined)}
        />
        <DrawerReviewCard
          review={review({ id: 'r2' })}
          personaName="Ada"
          isReviewInFlight={inFlight}
          onAction={vi.fn().mockResolvedValue(undefined)}
        />
      </>,
    );

    // The pressed control is busy…
    const approveR1 = screen.getByTestId('monitor-drawer-approve-r1');
    expect((approveR1 as HTMLButtonElement).disabled).toBe(true);
    expect(approveR1.getAttribute('aria-busy')).toBe('true');

    // …and NOTHING else is. This is the regression: it all used to be disabled.
    expect((screen.getByTestId('monitor-drawer-reject-r1') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId('monitor-drawer-approve-r2') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId('monitor-drawer-reject-r2') as HTMLButtonElement).disabled).toBe(false);
  });

  it('decides two rows back to back without either waiting on the other', async () => {
    const first = deferred();
    const onAction = vi
      .fn<(id: string, status: ManualReviewStatus, notes?: string) => Promise<void>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(undefined);

    render(
      <>
        <DrawerReviewCard
          review={review({ id: 'r1' })}
          personaName="Ada"
          isReviewInFlight={() => false}
          onAction={onAction}
        />
        <DrawerReviewCard
          review={review({ id: 'r2' })}
          personaName="Ada"
          isReviewInFlight={() => false}
          onAction={onAction}
        />
      </>,
    );

    fireEvent.click(screen.getByTestId('monitor-drawer-approve-r1'));
    // r1's write has NOT settled; the second verdict must still land.
    fireEvent.click(screen.getByTestId('monitor-drawer-reject-r2'));

    await waitFor(() => expect(onAction).toHaveBeenCalledTimes(2));
    expect(onAction).toHaveBeenNthCalledWith(1, 'r1', 'approved', undefined);
    expect(onAction).toHaveBeenNthCalledWith(2, 'r2', 'rejected', undefined);

    await act(async () => {
      first.resolve();
      await first.promise;
    });
  });

  it('dispatches a suggested action with the review id and the chosen label', async () => {
    const onDispatchAction = vi.fn().mockResolvedValue(undefined);
    render(
      <DrawerReviewCard
        review={review({ id: 'r9', suggested_actions: '["Bump PATCH","Bump MINOR"]' })}
        personaName="Ada"
        isReviewInFlight={() => false}
        onAction={vi.fn().mockResolvedValue(undefined)}
        onDispatchAction={onDispatchAction}
      />,
    );

    fireEvent.click(screen.getByTestId('monitor-drawer-action-r9-1'));
    await waitFor(() => expect(onDispatchAction).toHaveBeenCalledWith('r9', 'Bump MINOR'));
  });

  it('falls back to an approval when no dispatch port is wired', async () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    render(
      <DrawerReviewCard
        review={review({ id: 'r9', suggested_actions: '["Bump PATCH"]' })}
        personaName="Ada"
        isReviewInFlight={() => false}
        onAction={onAction}
      />,
    );
    fireEvent.click(screen.getByTestId('monitor-drawer-action-r9-0'));
    await waitFor(() => expect(onAction).toHaveBeenCalledWith('r9', 'approved', 'Bump PATCH'));
  });

  it('renders no dispatch strip when the review carries no suggested actions', () => {
    render(
      <DrawerReviewCard
        review={review({ id: 'r3' })}
        personaName="Ada"
        isReviewInFlight={() => false}
        onAction={vi.fn().mockResolvedValue(undefined)}
        onDispatchAction={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('monitor-drawer-action-r3-0')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// A failed dispatch reaches the user
// ---------------------------------------------------------------------------

describe('dispatch failure', () => {
  it('surfaces a rejected dispatch through the caller-supplied catch', async () => {
    const toasted = vi.fn();
    // The shape PersonaMonitor threads down: the writer rejects, the wrapper
    // turns it into a toast. Swallowing it here is how a run that never started
    // looks identical to one that did.
    const onDispatchAction = async (id: string, action: string) => {
      try {
        await Promise.reject(new Error(`boom ${id} ${action}`));
      } catch (err) {
        toasted(err);
      }
    };

    render(
      <DrawerReviewCard
        review={review({ id: 'r7', suggested_actions: '["Retry the run"]' })}
        personaName="Ada"
        isReviewInFlight={() => false}
        onAction={vi.fn().mockResolvedValue(undefined)}
        onDispatchAction={onDispatchAction}
      />,
    );

    fireEvent.click(screen.getByTestId('monitor-drawer-action-r7-0'));
    await waitFor(() => expect(toasted).toHaveBeenCalledTimes(1));
    expect((toasted.mock.calls[0]?.[0] as Error).message).toContain('Retry the run');
  });
});
