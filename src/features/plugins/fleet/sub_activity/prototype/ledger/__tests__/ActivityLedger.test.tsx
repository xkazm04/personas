/**
 * Gate K prototype, A/1 "Ledger" port of Fleet Activity: renders rows from the
 * kit props, joins the live registry for state, selects on click and shows the
 * selected session's folio, and hands Enter / the folio's Open action to onOpen.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FleetTranscriptSummary } from '@/lib/bindings/FleetTranscriptSummary';
import type { FleetActivitySurfaceProps as ActivityKitProps } from '../../../FleetActivitySurface';

const fleetState = {
  fleetSessions: [{ id: 'reg-a', claudeSessionId: 'cs-a', state: 'running', title: 'Port the pager', stateReason: null, origin: 'manual', mode: 'interactive' }],
  fleetRefresh: vi.fn(async () => {}),
};
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: Object.assign(
    (selector?: (s: typeof fleetState) => unknown) => (selector ? selector(fleetState) : fleetState),
    { getState: () => fleetState },
  ),
}));

import ActivityLedger from '../../ActivityLedger';

function row(o: Partial<FleetTranscriptSummary>): FleetTranscriptSummary {
  return {
    claudeSessionId: 's', path: '/p/s.jsonl', cwd: '/repo-a', userMessages: 1, assistantMessages: 2,
    tokens: { input: 10, output: 5, cacheCreation: 0, cacheRead: 0 }, lastContextTokens: 12,
    models: ['claude-opus-5-5'], tools: [], bgProcsLaunched: 0, filesTouched: [],
    firstTimestamp: '2026-05-31T10:00:00Z', lastTimestamp: '2026-05-31T10:01:00Z', parseErrors: 0, totalLines: 3,
    ...o,
  } as unknown as FleetTranscriptSummary;
}

const ROWS = [
  row({ claudeSessionId: 'cs-a', path: '/p/a.jsonl', cwd: '/repo-a', lastTimestamp: '2026-05-31T10:05:00Z', tools: [{ name: 'Edit', count: 2 }], filesTouched: ['/repo-a/auth.rs'] }),
  row({ claudeSessionId: 'cs-b', path: '/p/b.jsonl', cwd: '/repo-b', lastTimestamp: '2026-05-31T10:01:00Z', tools: [{ name: 'Bash', count: 9 }] }),
];

function props(over: Partial<ActivityKitProps> = {}): ActivityKitProps {
  return {
    rows: ROWS, filtered: ROWS, loading: false, failed: false, query: '', setQuery: vi.fn(),
    onRefresh: vi.fn(), onOpen: vi.fn(), liveSessionIds: new Set(['cs-a']), ...over,
  };
}

describe('ActivityLedger', () => {
  beforeEach(() => { fleetState.fleetRefresh.mockClear(); });

  it('renders one ledger row per filtered transcript, the live one titled from the registry', () => {
    render(<ActivityLedger {...props()} />);
    const rows = screen.getAllByTestId('fleet-activity-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('Port the pager')).toBeInTheDocument();
    expect(rows[0]).toHaveAttribute('data-tone', 'primary');
    // The transcript with no registry row is muted and has no status mark.
    expect(rows[1]).toHaveClass('is-muted');
    expect(rows[1]).not.toHaveAttribute('data-tone');
  });

  it('selects the first row on arrival and shows its folio', () => {
    render(<ActivityLedger {...props()} />);
    expect(screen.getAllByTestId('fleet-activity-row')[0]).toHaveAttribute('aria-selected', 'true');
    expect(within(screen.getByTestId('kit-proto-ledger-folio')).getByText('Port the pager')).toBeInTheDocument();
  });

  it('a click selects the row and moves the folio to it', async () => {
    render(<ActivityLedger {...props()} />);
    await userEvent.click(screen.getAllByTestId('fleet-activity-row')[1]!);
    expect(screen.getAllByTestId('fleet-activity-row')[1]).toHaveAttribute('aria-selected', 'true');
    const folio = screen.getByTestId('kit-proto-ledger-folio');
    expect(within(folio).getAllByText('repo-b').length).toBeGreaterThan(0);
    expect(within(folio).getByText('Bash')).toBeInTheDocument();
  });

  it('Enter and the folio Open action call onOpen with the selected row', async () => {
    const onOpen = vi.fn();
    render(<ActivityLedger {...props({ onOpen })} />);
    await userEvent.click(screen.getAllByTestId('fleet-activity-row')[1]!);
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(onOpen).toHaveBeenLastCalledWith(ROWS[1]);
    await userEvent.click(screen.getByTestId('kit-proto-ledger-open'));
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('j moves the selection down and Esc closes the folio', () => {
    render(<ActivityLedger {...props()} />);
    fireEvent.keyDown(document.body, { key: 'j' });
    expect(screen.getAllByTestId('fleet-activity-row')[1]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByTestId('kit-proto-ledger-folio')).toBeNull();
  });

  it('shows ghost rows while the first load runs, and the no-match row when search empties the list', () => {
    const { rerender } = render(<ActivityLedger {...props({ rows: [], filtered: [], loading: true })} />);
    expect(screen.getByRole('status', { busy: true })).toBeInTheDocument();
    expect(screen.queryAllByTestId('fleet-activity-row')).toHaveLength(0);
    rerender(<ActivityLedger {...props({ filtered: [], query: 'zzz' })} />);
    expect(screen.getByTestId('fleet-activity-empty')).toBeInTheDocument();
  });
});
