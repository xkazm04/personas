/**
 * WHAT "CLOSED" MEANS NOW THE MONITOR NEVER UNMOUNTS.
 *
 * `TrayOverlays` keeps this surface mounted from the first open onward
 * (`monitorPersistence.test.tsx` pins that end of the contract), so closing it
 * no longer disposes anything by itself. Everything that used to be free
 * because the tree was gone now has to be paid for deliberately, and this file
 * is the receipt:
 *
 *  • the overlay goes `inert` + `content-visibility: hidden` + invisible once
 *    its 0.16s exit fade has played — not before it, or the fade is not seen;
 *  • `useMonitorVisible()` answers the subtree honestly in both states;
 *  • the 1s elapsed-time interval is CLEARED while hidden. An interval that
 *    wakes every second to decide it has nothing to do is still a wake, so
 *    this is asserted on the timer count, not on a render;
 *  • Escape belongs to whatever is on screen: a hidden Monitor does not answer
 *    it, which is the behaviour an unmounted one had for free.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import { useMonitorVisible } from './monitorVisibility';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

// --- mocks (declared before the import under test) -------------------------

const onClose = vi.fn();

const systemState = {
  monitorInitialView: null as string | null,
  setMonitorInitialView: vi.fn(),
  monitorChannelPreset: null as unknown,
  setMonitorChannelPreset: vi.fn(),
  monitorLiveMode: false,
  toggleMonitorLiveMode: vi.fn(),
};
const pipelineState = { teams: [] as unknown[], fetchTeams: vi.fn().mockResolvedValue(undefined) };

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (sel: (s: typeof systemState) => unknown) => sel(systemState),
}));
vi.mock('@/stores/pipelineStore', () => ({
  usePipelineStore: (sel: (s: typeof pipelineState) => unknown) => sel(pipelineState),
}));
vi.mock('@/stores/themeStore', () => ({ useIsDarkTheme: () => false }));
vi.mock('@/hooks/utility/useDocumentVisibility', () => ({ useDocumentVisibility: () => true }));

/** One running process is what arms the elapsed-time tick. */
const monitorData = {
  personas: [] as unknown[],
  healthMap: {},
  reviews: [] as unknown[],
  unreadMessages: [] as unknown[],
  activeProcesses: { 'proc-1': { status: 'running', startedAt: 0, domain: 'd' } },
  reviewBadgeCounts: {},
  messageBadgeCounts: {},
  refreshAttention: vi.fn(),
  reviewsError: null,
  messagesError: null,
  healthError: null,
  lastRefreshed: null,
  loading: false,
  isProcessing: false,
  isReviewInFlight: false,
  handleReviewAction: vi.fn(),
  handleDispatchAction: vi.fn(),
  handleMarkRead: vi.fn(),
};
// `MONITOR_REVIEW_LIMIT` is a real export of the module and the shell imports
// it, so a mock that omits it fails the whole file at import time. Keep this
// in step with the module's export list, not with what this test uses.
vi.mock('./useMonitorData', () => ({
  useMonitorData: () => monitorData,
  MONITOR_REVIEW_LIMIT: 100,
}));

const workspace = { hasChannels: false };
vi.mock('./channels', () => ({
  useChannelWorkspace: () => ({
    workspaceTeams: [], bridges: [], toggle: vi.fn(), selectOnly: vi.fn(),
    allOn: true, setAll: vi.fn(), drillCallsign: undefined,
    scopeToPersona: vi.fn(), clearDrill: vi.fn(),
    hasChannels: workspace.hasChannels,
  }),
}));

// A Timeline chunk that NEVER arrives. That is the whole point of the
// transition test below: a synchronous view switch would drop straight to the
// Suspense fallback and throw the fleet board away, a transitioned one keeps
// the committed tree on screen until the incoming one is ready.
vi.mock('./channels/Stream', () => new Promise<never>(() => {}));

// The body and the dock are the two heavy subtrees the Monitor always mounts;
// neither is under test. The grid doubles as the probe for the visibility
// context, because that is the signal it is published for.
vi.mock('./grid/FleetGridView', () => ({
  FleetGridView: () => {
    const visible = useMonitorVisible();
    return <div data-testid="grid-probe" data-visible={String(visible)} />;
  },
}));
vi.mock('./grid/QuickDispatchDock', () => ({ default: () => null }));
vi.mock('@/features/shared/chrome/FleetActivityStrip', () => ({ default: () => null }));

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: {
      monitor: {
        title: 'Monitor', close: 'Close', close_hint: 'Close',
        live_toggle: 'Live', live_toggle_hint: 'Live',
        activity_mode: 'Activity', activity_mode_title: 'Activity',
        channels_layout_timeline: 'Timeline', channels_layout_timeline_hint: 'Timeline',
        channels_layout_grid: 'Conversations', channels_layout_grid_hint: 'Conversations',
        channels_layout_map: 'Map', channels_layout_map_hint: 'Map',
        board_mode: 'Board', board_mode_title: 'Board',
        channels_no_teams: 'No teams', system: 'System',
      },
    },
    tx: (s: string) => s,
  }),
}));

import { PersonaMonitor } from './PersonaMonitor';

// --- helpers ---------------------------------------------------------------

const overlay = () => screen.getByTestId('persona-monitor');
const probe = () => screen.getByTestId('grid-probe');

/** The hide waits out the 0.16s exit fade; this walks past it. */
function settleHide() {
  act(() => {
    vi.advanceTimersByTime(400);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  systemState.monitorInitialView = null;
  systemState.monitorChannelPreset = null;
  workspace.hasChannels = false;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// --- tests -----------------------------------------------------------------

describe('a closed Monitor is suspended, not torn down', () => {
  it('is inert, invisible and not hit-testable once the exit fade has played', () => {
    const { rerender } = render(<PersonaMonitor visible onClose={onClose} />);
    expect(overlay().hasAttribute('inert')).toBe(false);

    rerender(<PersonaMonitor visible={false} onClose={onClose} />);
    settleHide();

    const el = overlay();
    expect(el.hasAttribute('inert')).toBe(true);
    expect(el.className).toContain('invisible');
    expect(el.className).toContain('pointer-events-none');
    expect(el.className).toContain('[content-visibility:hidden]');
  });

  it('stays painted for the whole exit fade before it suspends', () => {
    const { rerender } = render(<PersonaMonitor visible onClose={onClose} />);

    rerender(<PersonaMonitor visible={false} onClose={onClose} />);
    act(() => {
      vi.advanceTimersByTime(100); // mid-fade: 0.16s has not elapsed
    });

    expect(overlay().hasAttribute('inert')).toBe(false);
  });

  it('un-suspends in the same commit as the reopen, with no remount', () => {
    const { rerender } = render(<PersonaMonitor visible onClose={onClose} />);
    const first = overlay();

    rerender(<PersonaMonitor visible={false} onClose={onClose} />);
    settleHide();
    rerender(<PersonaMonitor visible onClose={onClose} />);

    // No timer walk: showing is immediate, unlike hiding.
    expect(overlay().hasAttribute('inert')).toBe(false);
    // The same DOM node throughout — the tree was never rebuilt.
    expect(overlay()).toBe(first);
  });
});

describe('the visibility signal the subtree gates its cost on', () => {
  it('is true while open and false while hidden', () => {
    const { rerender } = render(<PersonaMonitor visible onClose={onClose} />);
    expect(probe().dataset.visible).toBe('true');

    rerender(<PersonaMonitor visible={false} onClose={onClose} />);
    expect(probe().dataset.visible).toBe('false');

    rerender(<PersonaMonitor visible onClose={onClose} />);
    expect(probe().dataset.visible).toBe('true');
  });
});

describe('the 1s elapsed-time interval', () => {
  it('runs while open and is CLEARED while hidden', () => {
    const { rerender } = render(<PersonaMonitor visible onClose={onClose} />);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    rerender(<PersonaMonitor visible={false} onClose={onClose} />);
    settleHide();

    // Nothing left pending: not the interval, and not the hide timeout either.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('comes back on reopen', () => {
    const { rerender } = render(<PersonaMonitor visible onClose={onClose} />);
    rerender(<PersonaMonitor visible={false} onClose={onClose} />);
    settleHide();

    rerender(<PersonaMonitor visible onClose={onClose} />);

    expect(vi.getTimerCount()).toBeGreaterThan(0);
  });
});

/**
 * WHAT THIS CAN AND CANNOT PIN. `startTransition`'s own contribution — React
 * yielding to input while the incoming 212-module tree builds — is a scheduler
 * property, and `act()` flushes transitions synchronously, so jsdom cannot
 * observe it either way. What IS observable, and what actually required a
 * change to this file, is pinned below: ONE body-level Suspense boundary, so
 * the already-revealed view survives the incoming chunk instead of being
 * replaced by a fresh boundary's fallback; and a `pressedView` the tab strip
 * reads, so the affordance is an urgent update that cannot wait on the body.
 */
describe('the view switch does not block', () => {
  it('keeps the outgoing view on screen while the incoming chunk loads, and lights the pressed tab at once', () => {
    workspace.hasChannels = true;
    render(<PersonaMonitor visible onClose={onClose} />);
    expect(screen.getByTestId('grid-probe')).toBeTruthy();

    act(() => {
      fireEvent.click(screen.getByTestId('monitor-view-timeline'));
    });

    // THE AFFORDANCE IS INSTANT — the pill the operator pressed reads as
    // selected even though the body it opens has not arrived.
    expect(screen.getByTestId('monitor-view-timeline').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('monitor-view-activity').getAttribute('aria-pressed')).toBe('false');
    // THE OUTGOING VIEW IS STILL THERE — not replaced by a chunk fallback.
    expect(screen.queryByTestId('grid-probe')).not.toBeNull();
  });
});

describe('Escape belongs to whatever is on screen', () => {
  it('closes the Monitor while it is open', () => {
    render(<PersonaMonitor visible onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('is ignored while the Monitor is hidden', () => {
    const { rerender } = render(<PersonaMonitor visible onClose={onClose} />);
    rerender(<PersonaMonitor visible={false} onClose={onClose} />);
    settleHide();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
  });
});
