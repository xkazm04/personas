/**
 * THE DOCK'S ACT TICKER FROM ANOTHER MONITOR TAB.
 *
 * The ticker sits at Monitor level (it is in the dock, reachable from every
 * tab), but the act log it opens lives in Activity's mandate drawer. A press
 * made while Conversations is up must switch the Monitor to Activity, and the
 * drawer that mounts there must open the act log AT the pressed act.
 *
 * The grid is replaced by a probe that runs the real `useMandateDrawer`, so
 * the request travels the real path: `requestActLogAt` -> the Monitor's tab
 * switch -> the drawer hook consuming the request on mount.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { useMandateDrawer } from './grid/prototype/entry-e/mandate/MandateDrawer';
import { requestActLogAt, useMandateDrawerRequest } from './grid/prototype/entry-e/mandate/mandateDrawerRequest';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const systemState = {
  monitorInitialView: 'conversations' as string | null,
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

const monitorData = {
  personas: [] as unknown[],
  healthMap: {},
  reviews: [] as unknown[],
  unreadMessages: [] as unknown[],
  activeProcesses: {},
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
vi.mock('./useMonitorData', () => ({
  useMonitorData: () => monitorData,
  MONITOR_REVIEW_LIMIT: 100,
}));

vi.mock('./channels', () => ({
  useChannelWorkspace: () => ({
    workspaceTeams: [], bridges: [], toggle: vi.fn(), selectOnly: vi.fn(),
    allOn: true, setAll: vi.fn(), drillCallsign: undefined,
    scopeToPersona: vi.fn(), clearDrill: vi.fn(),
    hasChannels: true,
  }),
}));
vi.mock('./channels/ConversationBriefing', () => ({
  ConversationBriefing: () => <div data-testid="conversations-probe" />,
}));
vi.mock('./channels/map/ChannelMap', () => ({ default: () => <div data-testid="map-probe" /> }));

// Activity's stand-in: the real drawer hook, its view printed.
vi.mock('./grid/FleetGridView', () => ({
  FleetGridView: () => {
    const { view } = useMandateDrawer();
    const at = view?.kind === 'log' ? view.focusActId ?? '' : '';
    return <div data-testid="activity-probe" data-drawer={view?.kind ?? 'closed'} data-act={at} />;
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
        channels_layout_grid: 'Conversations', channels_layout_grid_hint: 'Conversations',
        channels_layout_map: 'Map', channels_layout_map_hint: 'Map',
        channels_no_teams: 'No teams', system: 'System',
      },
      decisionCenter: { lens: { tab_blueprint: 'Blueprint', tab_blueprint_hint: 'Blueprint' } },
    },
    tx: (s: string) => s,
  }),
}));

import { PersonaMonitor } from './PersonaMonitor';

beforeEach(() => {
  useMandateDrawerRequest.setState({ pending: null });
});

afterEach(() => {
  cleanup();
});

describe('a ticker press from another Monitor tab', () => {
  it('switches Conversations to Activity and opens the act log at the pressed act', async () => {
    render(<PersonaMonitor visible onClose={vi.fn()} />);
    expect(await screen.findByTestId('conversations-probe')).toBeTruthy();
    expect(screen.queryByTestId('activity-probe')).toBeNull();

    act(() => requestActLogAt('act-42'));

    const activity = await screen.findByTestId('activity-probe');
    expect(screen.queryByTestId('conversations-probe')).toBeNull();
    expect(activity.dataset.drawer).toBe('log');
    expect(activity.dataset.act).toBe('act-42');
    // Consumed exactly once: the request does not linger to reopen the log later.
    expect(useMandateDrawerRequest.getState().pending).toBeNull();
  });

  it('leaves the Monitor where it is when nothing was pressed', async () => {
    render(<PersonaMonitor visible onClose={vi.fn()} />);
    expect(await screen.findByTestId('conversations-probe')).toBeTruthy();
    expect(screen.queryByTestId('activity-probe')).toBeNull();
  });
});
