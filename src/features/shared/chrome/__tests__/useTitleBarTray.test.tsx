/**
 * The title-bar dock and the count it puts on the Human-review capsule.
 *
 * That number is the app's one at-a-glance answer to "is anything waiting on
 * me", and it used to be `pending reviews + build questions` — two of the SEVEN
 * queues the deck behind it actually deals. A reviewer with 26 pending ideas
 * and nothing else was shown `0`, which is worse than showing nothing at all.
 *
 * What is pinned here is therefore mostly arithmetic, and deliberately so:
 *  • the total comes from the backend's cross-queue count, PLUS build questions
 *    (the one source with no row to count) and nothing else;
 *  • manual reviews are inside that total and must not be added a second time —
 *    the double-count is the specific mistake this fix invites;
 *  • the tray's item set, now that the Goals button is gone;
 *  • the capsule's own rules: a zero collapses, a big number abbreviates.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

// --- mocks (declared before the import under test) -------------------------

const markAllRead = vi.fn();
const setHeaderOverlay = vi.fn();
const openPalette = vi.fn();
const refreshPendingCounts = vi.fn();
const registerTicker = vi.fn();
const disposeTicker = vi.fn();

interface PendingCountsShape {
  goalAcceptance: number;
  manualReviews: number;
  ideas: number;
  practices: number;
  policyProposals: number;
  promotionProposals: number;
  total: number;
}

const notificationState = { unreadCount: 0, markAllRead };

const overviewState = {
  cronAgents: [] as unknown[],
  // Still in the store — the SIDEBAR reads it. The tray must not, because the
  // backend total below already contains it.
  pendingReviewCount: 0,
  unreadMessageCount: 0,
  activeProcesses: {} as Record<string, { status: string }>,
};

const agentState = {
  buildSessions: {} as Record<string, { phase: string; pendingQuestions: unknown[] }>,
};

const systemState = {
  headerOverlay: 'none' as string,
  setHeaderOverlay,
  keyboardNavActive: false,
  pendingCounts: null as PendingCountsShape | null,
  refreshPendingCounts,
};

const paletteState = { openPalette };

vi.mock('@/stores/notificationCenterStore', () => ({
  useNotificationCenterStore: (sel: (s: typeof notificationState) => unknown) => sel(notificationState),
}));

vi.mock('@/stores/overviewStore', () => ({
  useOverviewStore: (sel: (s: typeof overviewState) => unknown) => sel(overviewState),
}));

vi.mock('@/stores/agentStore', () => ({
  useAgentStore: (sel: (s: typeof agentState) => unknown) => sel(agentState),
}));

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (sel: (s: typeof systemState) => unknown) => sel(systemState),
}));

vi.mock('@/stores/commandPaletteStore', () => ({
  useCommandPaletteStore: (sel: (s: typeof paletteState) => unknown) => sel(paletteState),
}));

vi.mock('@/lib/polling/pollingCoordinator', () => ({
  getPollingCoordinator: () => ({
    register: (...args: unknown[]) => {
      registerTicker(...args);
      return { id: 'titleBarPendingCounts', bucket: 30_000, dispose: disposeTicker };
    },
  }),
}));

// The tray mounts these lazily-summoned surfaces; neither is under test and
// both drag in half the app's feature tree.
vi.mock('@/features/fleet/monitor', () => ({ PersonaMonitor: () => null }));
vi.mock('@/features/agents/quick-answer/QuickAnswerPopover', () => ({
  QuickAnswerPopover: () => null,
}));

vi.mock('@/hooks/utility/interaction/useMotion', () => ({ useReducedMotion: () => true }));

vi.mock('@/lib/keyboard/AppKeyboardProvider', () => ({ useAppKeyboard: () => {} }));

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: {
      settings: { search: { trigger_aria: 'Search', trigger_hint: 'Search' } },
      chrome: {
        tray_schedules: 'Schedules',
        tray_schedules_today: '{count} today',
        tray_notifications: 'Notifications',
        tray_notifications_unread: '{count} unread',
      },
      monitor: {
        review_titlebar: 'Human review & questions',
        review_titlebar_attention: '{count} waiting for your answer',
        titlebar: 'Activity',
        titlebar_attention: '{count} need you',
        titlebar_tooltip: '{count} need you',
      },
    },
    tx: (template: string, vars: Record<string, unknown>) =>
      template.replace(/\{(\w+)\}/g, (_m, key: string) => String(vars[key] ?? '')),
  }),
}));

import TitleBarDock from '../TitleBarDock';

// --- helpers ---------------------------------------------------------------

function counts(overrides: Partial<PendingCountsShape> = {}): PendingCountsShape {
  return {
    goalAcceptance: 0,
    manualReviews: 0,
    ideas: 0,
    practices: 0,
    policyProposals: 0,
    promotionProposals: 0,
    total: 0,
    ...overrides,
  };
}

/** Questions live only in frontend build-session state — this is that state. */
function awaitingQuestions(n: number) {
  return n === 0
    ? {}
    : { 'sess-1': { phase: 'awaiting_input', pendingQuestions: Array.from({ length: n }, (_, i) => i) } };
}

/** Whatever the Human-review capsule is currently showing, as text. */
const reviewBadge = () => screen.getByTestId('titlebar-human-review').textContent ?? '';

beforeEach(() => {
  vi.clearAllMocks();
  notificationState.unreadCount = 0;
  overviewState.cronAgents = [];
  overviewState.pendingReviewCount = 0;
  overviewState.unreadMessageCount = 0;
  overviewState.activeProcesses = {};
  agentState.buildSessions = {};
  systemState.headerOverlay = 'none';
  systemState.keyboardNavActive = false;
  systemState.pendingCounts = null;
});

afterEach(cleanup);

// --- tests -----------------------------------------------------------------

describe('the Human-review badge counts every queue the deck deals', () => {
  it('adds build questions to the backend total', () => {
    systemState.pendingCounts = counts({ ideas: 26, total: 26 });
    agentState.buildSessions = awaitingQuestions(2);

    render(<TitleBarDock />);

    expect(reviewBadge()).toBe('28');
  });

  it('does NOT add manual reviews a second time', () => {
    // 3 of the 10 pending rows ARE manual reviews, and `pendingReviewCount` is
    // the very field the badge used to add. Adding both would read 15.
    systemState.pendingCounts = counts({ manualReviews: 3, ideas: 7, total: 10 });
    overviewState.pendingReviewCount = 3;
    agentState.buildSessions = awaitingQuestions(2);

    render(<TitleBarDock />);

    expect(reviewBadge()).toBe('12');
  });

  it('shows a pending backlog even when no review and no question is waiting', () => {
    // The whole bug in one case: the old formula scored this reviewer `0`.
    systemState.pendingCounts = counts({ ideas: 26, total: 26 });

    render(<TitleBarDock />);

    expect(reviewBadge()).toBe('26');
  });

  it('counts questions alone before the first backend read lands', () => {
    // `pendingCounts` is null until the first poll returns; the questions the
    // frontend already knows about are still worth showing.
    agentState.buildSessions = awaitingQuestions(4);

    render(<TitleBarDock />);

    expect(reviewBadge()).toBe('4');
  });
});

describe('the capsule renders a count the way the dock says it does', () => {
  it('collapses to a bare glyph at zero', () => {
    systemState.pendingCounts = counts();

    render(<TitleBarDock />);

    // Not "0" — an empty queue is nothing to report, so the number goes away.
    expect(reviewBadge()).toBe('');
    expect(screen.getByTestId('titlebar-human-review').getAttribute('aria-label')).toBe(
      'Human review & questions',
    );
  });

  it('abbreviates past 99', () => {
    systemState.pendingCounts = counts({ ideas: 140, total: 140 });

    render(<TitleBarDock />);

    expect(reviewBadge()).toBe('99+');
    // The label keeps the TRUE number — the abbreviation is a width budget,
    // not a rounding of the fact.
    expect(screen.getByTestId('titlebar-human-review').getAttribute('aria-label')).toBe(
      '140 waiting for your answer',
    );
  });
});

describe('the tray offers five actions and no Goals button', () => {
  it('renders exactly the dock item set', () => {
    render(<TitleBarDock />);

    const ids = screen.getAllByRole('button').map((b) => b.getAttribute('data-testid'));
    expect(ids).toEqual([
      'titlebar-search',
      'titlebar-schedules',
      'titlebar-human-review',
      'titlebar-process-activity',
      'titlebar-notifications',
    ]);
  });

  it('has no goal-acceptance capsule — goals are a triage kind now', () => {
    render(<TitleBarDock />);

    expect(screen.queryByTestId('titlebar-goal-acceptance')).toBeNull();
  });
});

describe('the badge owns its own freshness', () => {
  it('registers one coordinated ticker rather than a raw interval', () => {
    render(<TitleBarDock />);

    expect(registerTicker).toHaveBeenCalledTimes(1);
    const [id, fn, options] = registerTicker.mock.calls[0] as [
      string,
      () => unknown,
      { interval: number },
    ];
    expect(id).toBe('titleBarPendingCounts');
    expect(fn).toBe(refreshPendingCounts);
    // The shared 30s bucket the sidebar badges already ride, so SQLite warms
    // its cache once for both instead of once each.
    expect(options.interval).toBe(30_000);
  });

  it('disposes the ticker when the dock unmounts', () => {
    const { unmount } = render(<TitleBarDock />);
    unmount();
    expect(disposeTicker).toHaveBeenCalledTimes(1);
  });
});
