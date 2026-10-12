/**
 * The title-bar dock and the count it puts on the decision capsule.
 *
 * That number is the app's one at-a-glance answer to "is anything waiting on
 * me". It is the Decision Center roster's total — the seven decision chips the
 * Activity strip shows — read through the counts-only reader, so the badge and
 * the strip cannot disagree. What is pinned here:
 *  • the badge IS the roster total for a fixture (build questions and chat are
 *    inside it; manual reviews are not added a second time; `ready` is not a
 *    decision);
 *  • pressing it opens the Monitor on its Activity view (the hub), not the
 *    Quick Answer deck;
 *  • the tooltip reads the total back as its seven chips, and a chip whose
 *    source failed says so rather than printing 0;
 *  • the tray owns no counts ticker of its own any more;
 *  • the capsule's own rules: a zero collapses, a big number abbreviates.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import { buildChipCounts, decisionTotal } from '@/features/decision-center/roster/chipCounts';
import type { PendingCounts } from '@/lib/bindings/PendingCounts';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

// --- mocks (declared before the import under test) -------------------------

const markAllRead = vi.fn();
const setHeaderOverlay = vi.fn();
const openPalette = vi.fn();
const setMonitorInitialView = vi.fn();
const registerTicker = vi.fn();
const disposeTicker = vi.fn();

const notificationState = { unreadCount: 0, markAllRead };

const overviewState = {
  cronAgents: [] as unknown[],
  // Still in the store — the SIDEBAR reads it. The tray must not, because the
  // backend total below already contains it.
  pendingReviewCount: 0,
  unreadReportCount: 0,
  activeProcesses: {} as Record<string, { status: string }>,
};

const systemState = {
  headerOverlay: 'none' as string,
  setHeaderOverlay,
  keyboardNavActive: false,
  setMonitorInitialView,
};

/** What the counts-only roster reader is answering, as its inputs. */
const roster = {
  pending: null as PendingCounts | null,
  pendingFailed: false,
  questions: 0,
  chat: 0,
};
const refreshCounts = vi.fn();

function rosterCounts() {
  return buildChipCounts({
    pending: roster.pending,
    pendingFailed: roster.pendingFailed,
    questions: roster.questions,
    chat: { n: roster.chat, failed: false },
    ready: { n: 5, failed: false },
  });
}

// The real chip arithmetic over a fixture: the badge must print exactly what
// the roster's own law (`buildChipCounts` + `decisionTotal`) computes.
vi.mock('@/features/decision-center/roster/useDecisionCounts', () => ({
  useDecisionCounts: () => {
    const counts = rosterCounts();
    return { counts, total: decisionTotal(counts), loading: false, refreshCounts };
  },
}));

const paletteState = { openPalette };

vi.mock('@/stores/notificationCenterStore', () => ({
  useNotificationCenterStore: (sel: (s: typeof notificationState) => unknown) => sel(notificationState),
}));

vi.mock('@/stores/overviewStore', () => ({
  useOverviewStore: (sel: (s: typeof overviewState) => unknown) => sel(overviewState),
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
      return { id: String(args[0]), bucket: 30_000, dispose: disposeTicker };
    },
  }),
}));

// The tray mounts these lazily-summoned surfaces; none is under test and they
// drag in half the app's feature tree.
vi.mock('@/features/fleet/monitor', () => ({ PersonaMonitor: () => null }));

// The tray also mounts the circuit-breaker indicator (its only mount in the
// app). It is covered by its own test — `circuitBreakerMount.test.tsx` — and
// reads far more of the translation catalog than this file's dock-shaped `t`
// stub carries.
vi.mock('@/features/agents/sub_executions/components/CircuitBreakerIndicator', () => ({
  CircuitBreakerIndicator: () => null,
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
        dc_consumers_badge: 'Decisions',
        dc_consumers_badge_attention: '{count} decisions waiting',
        dc_consumers_chip_gates: 'Gates',
        dc_consumers_chip_proposals: 'Proposals',
        dc_consumers_chip_backlog: 'Backlog',
        dc_consumers_chip_incidents: 'Incidents',
        dc_consumers_chip_council: 'Council',
        dc_consumers_chip_reports: 'Reports',
        dc_consumers_chip_chat: 'Chat',
        dc_consumers_chip_failed: 'unavailable',
        titlebar: 'Activity',
        titlebar_attention: '{count} need you',
        titlebar_tooltip: '{count} need you',
      },
      overview: { dc_badge_triage_all_hint: 'Shift+click to triage everything here' },
    },
    tx: (template: string, vars: Record<string, unknown>) =>
      template.replace(/\{(\w+)\}/g, (_m, key: string) => String(vars[key] ?? '')),
  }),
}));

import TitleBarDock from '../TitleBarDock';
import { closeDecisionDeck, useDecisionDeckStore } from '@/features/decision-center/deck/deckStore';
import { TitleBarDecisionTooltip } from '../TitleBarDecisionTooltip';

// --- helpers ---------------------------------------------------------------

function counts(overrides: Partial<PendingCounts> = {}): PendingCounts {
  return {
    goalAcceptance: 0,
    manualReviews: 0,
    ideas: 0,
    policyProposals: 0,
    promotionProposals: 0,
    openIncidents: 0,
    blockingIncidents: 0,
    unreadReports: 0,
    companionApprovals: 0,
    councilDecidable: 0,
    decisionTotal: 0,
    total: 0,
    ...overrides,
  };
}

/** Whatever the decision capsule is currently showing, as text. */
const decisionBadge = () => screen.getByTestId('titlebar-human-review').textContent ?? '';

beforeEach(() => {
  vi.clearAllMocks();
  notificationState.unreadCount = 0;
  overviewState.cronAgents = [];
  overviewState.pendingReviewCount = 0;
  overviewState.unreadReportCount = 0;
  overviewState.activeProcesses = {};
  systemState.headerOverlay = 'none';
  systemState.keyboardNavActive = false;
  roster.pending = null;
  roster.pendingFailed = false;
  roster.questions = 0;
  roster.chat = 0;
});

afterEach(cleanup);

// --- tests -----------------------------------------------------------------

describe('the decision badge is the roster total', () => {
  it('equals the roster total for a fixture spanning every chip', () => {
    roster.pending = counts({
      manualReviews: 2,
      companionApprovals: 1,
      ideas: 7,
      goalAcceptance: 1,
      openIncidents: 3,
      blockingIncidents: 1,
      unreadReports: 4,
      councilDecidable: 1,
    });
    roster.questions = 2;
    roster.chat = 1;

    render(<TitleBarDock />);

    const expected = decisionTotal(rosterCounts());
    // gates 2+1+2, proposals 1, backlog 7, incidents 3, council 1, reports 4,
    // chat 1 — and NOT the 5 ready ideas, which are not a decision.
    expect(expected).toBe(22);
    expect(decisionBadge()).toBe(String(expected));
  });

  it('does NOT add manual reviews a second time', () => {
    // `pendingReviewCount` is the very overview field the badge once added on
    // top of a total that already held it.
    roster.pending = counts({ manualReviews: 3, ideas: 7 });
    overviewState.pendingReviewCount = 3;
    roster.questions = 2;

    render(<TitleBarDock />);

    expect(decisionBadge()).toBe('12');
  });

  it('counts questions alone before the first backend read lands', () => {
    roster.questions = 4;

    render(<TitleBarDock />);

    expect(decisionBadge()).toBe('4');
  });
});

describe('pressing the badge opens the Decision Center hub', () => {
  it('opens the Monitor on its Activity view', () => {
    render(<TitleBarDock />);

    fireEvent.click(screen.getByTestId('titlebar-human-review'));

    expect(setMonitorInitialView).toHaveBeenCalledWith('fleet');
    expect(setHeaderOverlay).toHaveBeenCalledWith('monitor');
  });

  it('brings Activity forward without closing a Monitor already open', () => {
    systemState.headerOverlay = 'monitor';
    render(<TitleBarDock />);

    fireEvent.click(screen.getByTestId('titlebar-human-review'));

    expect(setMonitorInitialView).toHaveBeenCalledWith('fleet');
    expect(setHeaderOverlay).not.toHaveBeenCalled();
  });
});

describe('the badge tooltip reads the total back as its chips', () => {
  it('lists the seven decision chips in strip order with their counts', () => {
    roster.pending = counts({ ideas: 7, unreadReports: 4 });
    roster.chat = 2;

    render(<TitleBarDecisionTooltip heading="13 decisions waiting" counts={rosterCounts()} />);

    const text = screen.getByTestId('titlebar-decision-tooltip').textContent ?? '';
    expect(text).toBe(
      '13 decisions waitingGates0Proposals0Backlog7Incidents0Council0Reports4Chat2',
    );
  });

  it('says a chip is unavailable when its source did not answer, never 0', () => {
    roster.pendingFailed = true;

    render(<TitleBarDecisionTooltip heading="Decisions" counts={rosterCounts()} />);

    const text = screen.getByTestId('titlebar-decision-tooltip').textContent ?? '';
    expect(text).toContain('Backlogunavailable');
    // Chat is derived client-side and did answer.
    expect(text).toContain('Chat0');
  });
});

describe('the capsule renders a count the way the dock says it does', () => {
  it('collapses to a bare glyph at zero', () => {
    roster.pending = counts();

    render(<TitleBarDock />);

    // Not "0" — an empty queue is nothing to report, so the number goes away.
    expect(decisionBadge()).toBe('');
    expect(screen.getByTestId('titlebar-human-review').getAttribute('aria-label')).toBe('Decisions');
  });

  it('abbreviates past 99', () => {
    roster.pending = counts({ ideas: 140 });

    render(<TitleBarDock />);

    expect(decisionBadge()).toBe('99+');
    // The label keeps the TRUE number — the abbreviation is a width budget,
    // not a rounding of the fact.
    expect(screen.getByTestId('titlebar-human-review').getAttribute('aria-label')).toBe(
      '140 decisions waiting',
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

describe('the badge does not run a counts poll of its own', () => {
  it('registers no tray ticker — the roster reader owns the counts freshness', () => {
    render(<TitleBarDock />);

    // The old `titleBarPendingCounts` ticker read the same command through a
    // second path. The counts reader (mocked here) registers the roster's
    // coordinated ticker instead; the tray itself registers nothing.
    expect(registerTicker).not.toHaveBeenCalled();
  });
});

describe('Shift+click on the badge triages everything in the Decision Deck', () => {
  afterEach(() => closeDecisionDeck());

  it('opens the deck on every chip, grown out of the badge, and leaves the Monitor alone', () => {
    render(<TitleBarDock />);

    fireEvent.click(screen.getByTestId('titlebar-human-review'), { shiftKey: true });

    const req = useDecisionDeckStore.getState().request;
    expect(req?.scope).toEqual({ kind: 'all' });
    expect(req?.origin).not.toBeUndefined();
    expect(setHeaderOverlay).not.toHaveBeenCalled();
    expect(setMonitorInitialView).not.toHaveBeenCalled();
  });

  it('a plain click still opens the hub and no deck', () => {
    render(<TitleBarDock />);

    fireEvent.click(screen.getByTestId('titlebar-human-review'));

    expect(useDecisionDeckStore.getState().request).toBeNull();
    expect(setHeaderOverlay).toHaveBeenCalledWith('monitor');
  });
});
