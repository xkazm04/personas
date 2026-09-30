/**
 * Fleet Activity's kit surface renders the page's rows from its props, a row click selects it and shows its detail, and Enter opens the selection (onOpen).
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { FleetTranscriptSummary } from '@/lib/bindings/FleetTranscriptSummary';
import type { FleetActivitySurfaceProps } from '../FleetActivitySurface';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

// The registry: one transcript still has a working session behind it (its title and state).
const fleetState = {
  fleetSessions: [
    { id: 'reg-1', claudeSessionId: 'cs-live', title: 'Port the pager', state: 'running', stateReason: null, origin: null, mode: 'interactive', projectLabel: 'repo-a' },
  ],
};
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: Object.assign(
    (selector?: (s: typeof fleetState) => unknown) => (selector ? selector(fleetState) : fleetState),
    { getState: () => fleetState },
  ),
}));

import { FleetActivitySurface } from '../FleetActivitySurface';

function row(o: Partial<FleetTranscriptSummary>): FleetTranscriptSummary {
  return {
    claudeSessionId: 's', path: '/p/s.jsonl', cwd: '/repo-a',
    userMessages: 1, assistantMessages: 2,
    tokens: { input: 10, output: 5, cacheCreation: 0, cacheRead: 0 },
    lastContextTokens: 0, models: ['claude-opus-4-8'], tools: [], filesTouched: [], bgProcsLaunched: 0,
    firstTimestamp: '2026-05-31T10:00:00Z', lastTimestamp: '2026-05-31T10:01:00Z',
    parseErrors: 0, totalLines: 3,
    ...o,
  } as unknown as FleetTranscriptSummary;
}

const ROWS = [
  row({ claudeSessionId: 'cs-live', path: '/p/a.jsonl', cwd: '/repo-a', filesTouched: ['/repo-a/src/auth.rs'], tools: [{ name: 'Edit', count: 2 }] }),
  row({ claudeSessionId: 'cs-gone', path: '/p/b.jsonl', cwd: '/repo-b', filesTouched: ['/repo-b/main.ts'], tools: [{ name: 'Bash', count: 9 }] }),
];

function props(o: Partial<FleetActivitySurfaceProps> = {}): FleetActivitySurfaceProps {
  return {
    rows: ROWS, filtered: ROWS, loading: false, failed: false, query: '', setQuery: vi.fn(),
    onRefresh: vi.fn(), onOpen: vi.fn(), liveSessionIds: new Set(['cs-live']),
    ...o,
  };
}

describe('FleetActivitySurface', () => {
  it('renders one table row per filtered transcript, status on the spine', () => {
    render(<FleetActivitySurface {...props()} />);
    const rows = screen.getAllByTestId('fleet-activity-row');
    expect(rows).toHaveLength(2);
    // The live transcript takes its registry title; the other falls back to its project.
    expect(within(rows[0]!).getByText('Port the pager')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('repo-b')).toBeInTheDocument();
    expect(rows[0]).toHaveClass('is-selected', 'is-live');
    expect(rows[1]).toHaveClass('is-muted');
  });

  it('selecting a row shows its detail', () => {
    render(<FleetActivitySurface {...props()} />);
    const rows = screen.getAllByTestId('fleet-activity-row');
    fireEvent.click(rows[1]!);
    expect(rows[1]).toHaveClass('is-selected');
    expect(rows[0]).not.toHaveClass('is-selected');
    // The detail lists the selected transcript's own files and tools.
    expect(screen.getAllByText('main.ts').length).toBeGreaterThan(0);
    expect(screen.queryByText('auth.rs')).toBeNull();
  });

  it('Enter opens the selected row, and the detail Open action does too', () => {
    const onOpen = vi.fn();
    render(<FleetActivitySurface {...props({ onOpen })} />);
    fireEvent.click(screen.getAllByTestId('fleet-activity-row')[1]!);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0]![0]).toBe(ROWS[1]);
    fireEvent.click(screen.getAllByTestId('fleet-activity-open')[0]!);
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('j moves the selection down', () => {
    render(<FleetActivitySurface {...props()} />);
    fireEvent.keyDown(window, { key: 'j' });
    expect(screen.getAllByTestId('fleet-activity-row')[1]).toHaveClass('is-selected');
  });

  it('keeps chrome and shows a ghost while the first load runs, and the empty band after', () => {
    const { rerender } = render(<FleetActivitySurface {...props({ rows: [], filtered: [], loading: true })} />);
    expect(screen.getByTestId('fleet-activity-search')).toBeInTheDocument();
    expect(screen.queryAllByTestId('fleet-activity-row')).toHaveLength(0);
    expect(document.querySelector('.k-table[aria-busy="true"]')).not.toBeNull();
    rerender(<FleetActivitySurface {...props({ rows: [], filtered: [], loading: false })} />);
    expect(document.querySelector('.k-table [data-empty="1"]')).not.toBeNull();
  });
});
