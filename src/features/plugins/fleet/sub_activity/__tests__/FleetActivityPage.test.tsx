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

vi.mock('@/api/fleet/fleet', () => ({ recentTranscripts: vi.fn() }));

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
