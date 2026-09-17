/**
 * Unit tests for FleetActivityPage (P2.2 cross-session activity feed).
 * The fleet API is mocked; useTranslation is real. Drives the search filter
 * across files/tools/projects via the real DOM.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { FleetTranscriptSummary } from '@/lib/bindings/FleetTranscriptSummary';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

vi.mock('@/api/fleet/fleet', () => ({
  recentTranscripts: vi.fn(),
  // Pulled in by the Insights panel the unbound-row door opens.
  sessionMetadata: vi.fn(async () => null),
  readTranscript: vi.fn(async () => ({
    claudeSessionId: 'cs-gone', path: '/p/b.jsonl', cwd: '/repo-b',
    userMessages: 1, assistantMessages: 2,
    tokens: { input: 10, output: 5, cacheCreation: 0, cacheRead: 0 },
    models: [], tools: [], filesTouched: [],
    firstTimestamp: '2026-05-31T10:00:00Z', lastTimestamp: '2026-05-31T10:01:00Z',
    parseErrors: 0, totalLines: 3,
  })),
}));

// The registry, driven from the test: which rows have a live session behind
// them is the whole question a click has to answer.
const fleetState = {
  fleetSessions: [] as Array<{ id: string; claudeSessionId: string | null }>,
  fleetSetActiveSession: vi.fn(),
};
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: Object.assign(
    (selector?: (s: typeof fleetState) => unknown) => (selector ? selector(fleetState) : fleetState),
    { getState: () => fleetState },
  ),
}));

import * as fleetApi from '@/api/fleet/fleet';
import FleetActivityPage from '../FleetActivityPage';

function row(o: Partial<FleetTranscriptSummary>): FleetTranscriptSummary {
  return {
    claudeSessionId: 's', path: '/p/s.jsonl', cwd: '/repo-a',
    userMessages: 1, assistantMessages: 2,
    tokens: { input: 10, output: 5, cacheCreation: 0, cacheRead: 0 },
    models: ['claude-opus-4-8'], tools: [], filesTouched: [],
    firstTimestamp: '2026-05-31T10:00:00Z', lastTimestamp: '2026-05-31T10:01:00Z',
    parseErrors: 0, totalLines: 3,
    ...o,
  } as unknown as FleetTranscriptSummary;
}

const ROWS = [
  row({ path: '/p/a.jsonl', cwd: '/repo-a', filesTouched: ['/repo-a/auth.rs'], tools: [{ name: 'Edit', count: 2 }] }),
  row({ path: '/p/b.jsonl', cwd: '/repo-b', filesTouched: ['/repo-b/main.ts'], tools: [{ name: 'Bash', count: 9 }] }),
];

describe('FleetActivityPage', () => {
  beforeEach(() => vi.mocked(fleetApi.recentTranscripts).mockReset());

  it('lists recent sessions', async () => {
    vi.mocked(fleetApi.recentTranscripts).mockResolvedValue(ROWS);
    render(<FleetActivityPage />);
    await screen.findByTestId('fleet-activity-list');
    expect(screen.getAllByTestId('fleet-activity-row')).toHaveLength(2);
    expect(screen.getByText('repo-a')).toBeInTheDocument();
    expect(screen.getByText('repo-b')).toBeInTheDocument();
  });

  it('filters by file path across sessions', async () => {
    vi.mocked(fleetApi.recentTranscripts).mockResolvedValue(ROWS);
    const user = userEvent.setup();
    render(<FleetActivityPage />);
    await screen.findByTestId('fleet-activity-list');

    await user.type(screen.getByTestId('fleet-activity-search'), 'auth.rs');

    await waitFor(() => expect(screen.getAllByTestId('fleet-activity-row')).toHaveLength(1));
    expect(screen.getByText('repo-a')).toBeInTheDocument();
    expect(screen.queryByText('repo-b')).not.toBeInTheDocument();
  });

  it('shows the empty state when no sessions', async () => {
    vi.mocked(fleetApi.recentTranscripts).mockResolvedValue([]);
    render(<FleetActivityPage />);
    await waitFor(() => expect(screen.getByTestId('fleet-activity-empty')).toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------
// A SEARCH HIT IS A DOOR. The rows were inert `<div>`s, so the tab answered its
// own question ("which sessions touched auth.rs?") with a report and left the
// operator to find the session by hand.
// ---------------------------------------------------------------------------

import { resolveActivityTarget } from '../activityTarget';

describe('resolveActivityTarget', () => {
  const sessions = [
    { id: 'sess-1', claudeSessionId: 'cs-a' },
    { id: 'sess-2', claudeSessionId: null },
  ] as never;

  it('addresses a row the registry still binds by its session id', () => {
    expect(resolveActivityTarget({ claudeSessionId: 'cs-a' }, sessions))
      .toEqual({ kind: 'session', sessionId: 'sess-1' });
  });

  it('falls back to the transcript rollup for a row with no registry session', () => {
    // The transcript outlives the PTY, so a finished run stays readable.
    expect(resolveActivityTarget({ claudeSessionId: 'cs-gone' }, sessions))
      .toEqual({ kind: 'insights', claudeSessionId: 'cs-gone' });
  });

  it('never matches an unbound registry row on a null id', () => {
    expect(resolveActivityTarget({ claudeSessionId: 'cs-b' }, sessions).kind).toBe('insights');
  });
});

describe('FleetActivityPage row doors', () => {
  beforeEach(() => {
    fleetState.fleetSessions = [];
    fleetState.fleetSetActiveSession.mockClear();
  });

  it('focuses the live session and switches to Sessions', async () => {
    fleetState.fleetSessions = [{ id: 'sess-1', claudeSessionId: 'cs-a' }];
    vi.mocked(fleetApi.recentTranscripts).mockResolvedValue([
      row({ path: '/p/a.jsonl', claudeSessionId: 'cs-a', cwd: '/repo-a' }),
    ]);
    const onOpenSessions = vi.fn();
    render(<FleetActivityPage onOpenSessions={onOpenSessions} />);
    await screen.findByTestId('fleet-activity-list');

    await userEvent.click(screen.getByTestId('fleet-activity-row'));
    expect(fleetState.fleetSetActiveSession).toHaveBeenCalledWith('sess-1');
    expect(onOpenSessions).toHaveBeenCalled();
  });

  it('opens the transcript rollup for a row with no live session', async () => {
    vi.mocked(fleetApi.recentTranscripts).mockResolvedValue([
      row({ path: '/p/b.jsonl', claudeSessionId: 'cs-gone', cwd: '/repo-b' }),
    ]);
    const onOpenSessions = vi.fn();
    render(<FleetActivityPage onOpenSessions={onOpenSessions} />);
    await screen.findByTestId('fleet-activity-list');

    await userEvent.click(screen.getByTestId('fleet-activity-row'));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    // Reading a finished run is not a reason to leave the Activity tab.
    expect(onOpenSessions).not.toHaveBeenCalled();
    expect(fleetState.fleetSetActiveSession).not.toHaveBeenCalled();
  });

  it('makes every row a real control, not a div with a handler', async () => {
    vi.mocked(fleetApi.recentTranscripts).mockResolvedValue(ROWS);
    render(<FleetActivityPage />);
    await screen.findByTestId('fleet-activity-list');
    for (const el of screen.getAllByTestId('fleet-activity-row')) {
      expect(el.tagName).toBe('BUTTON');
    }
  });
});
