/**
 * Unit tests for FleetSessionInsights (P2.1 transcript-intelligence panel).
 * The fleet API is mocked at the module boundary; useTranslation is real.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

import type { FleetTranscriptSummary } from '@/lib/bindings/FleetTranscriptSummary';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

// The component prefers the incremental `sessionMetadata` rollup and falls
// back to `readTranscript` when it returns null. Default the rollup to null so
// the existing assertions (which drive `readTranscript`) exercise the fallback.
vi.mock('@/api/fleet/fleet', () => ({
  sessionMetadata: vi.fn().mockResolvedValue(null),
  readTranscript: vi.fn(),
}));

import * as fleetApi from '@/api/fleet/fleet';
import { FleetSessionInsights } from '../FleetSessionInsights';
import { __resetInsightsCacheForTests } from '../insightsCache';

const SUMMARY = {
  claudeSessionId: 'sess1',
  path: '/x.jsonl',
  cwd: '/proj',
  userMessages: 3,
  assistantMessages: 7,
  tokens: { input: 1000, output: 200, cacheCreation: 0, cacheRead: 5000 },
  models: ['claude-opus-4-8'],
  tools: [{ name: 'Bash', count: 12 }, { name: 'Edit', count: 4 }],
  filesTouched: ['/proj/a.rs', '/proj/b.rs'],
  firstTimestamp: '2026-05-31T10:00:00Z',
  lastTimestamp: '2026-05-31T10:05:00Z',
  parseErrors: 0,
  totalLines: 30,
} as unknown as FleetTranscriptSummary;

describe('FleetSessionInsights', () => {
  beforeEach(() => {
    __resetInsightsCacheForTests();
    vi.mocked(fleetApi.readTranscript).mockReset();
  });

  it('fetches + renders the transcript rollup', async () => {
    vi.mocked(fleetApi.readTranscript).mockResolvedValue(SUMMARY);
    render(<FleetSessionInsights claudeSessionId="sess1" />);

    await screen.findByTestId('fleet-insights');
    expect(fleetApi.readTranscript).toHaveBeenCalledWith('sess1');
    // Tools + files surfaced.
    expect(screen.getByText('Bash')).toBeInTheDocument();
    expect(screen.getByText('Edit')).toBeInTheDocument();
    expect(screen.getByText('/proj/a.rs')).toBeInTheDocument();
    expect(screen.getByText('claude-opus-4-8')).toBeInTheDocument();
  });

  it('shows the empty state and does not fetch when unbound', () => {
    render(<FleetSessionInsights claudeSessionId={null} />);
    expect(screen.getByText(/No transcript yet/i)).toBeInTheDocument();
    expect(fleetApi.readTranscript).not.toHaveBeenCalled();
  });

  it('shows an error + retry when the read fails', async () => {
    // Lazy rejection (created on call, immediately awaited+caught by the
    // component) so vitest doesn't flag a transient unhandled rejection.
    vi.mocked(fleetApi.readTranscript).mockImplementationOnce(() => Promise.reject(new Error('nope')));
    render(<FleetSessionInsights claudeSessionId="sess1" />);
    expect(await screen.findByText(/Couldn't read/i)).toBeInTheDocument();
  });

  it('keeps the newer session when an older read resolves after a switch', async () => {
    // The focus pane re-points one mounted panel at a new session. A read for
    // the previous session that lands late must not repaint its data here.
    let resolveOld: (v: FleetTranscriptSummary) => void = () => {};
    vi.mocked(fleetApi.readTranscript).mockImplementation((id: string) =>
      id === 'old'
        ? new Promise<FleetTranscriptSummary>((r) => { resolveOld = r; })
        : Promise.resolve({ ...SUMMARY, claudeSessionId: 'new', tools: [{ name: 'Grep', count: 1 }] } as FleetTranscriptSummary),
    );
    const { rerender } = render(<FleetSessionInsights claudeSessionId="old" />);
    rerender(<FleetSessionInsights claudeSessionId="new" />);
    await screen.findByText('Grep');

    await act(async () => {
      resolveOld({ ...SUMMARY, claudeSessionId: 'old', tools: [{ name: 'Bash', count: 99 }] } as FleetTranscriptSummary);
    });
    expect(screen.getByText('Grep')).toBeInTheDocument();
    expect(screen.queryByText('Bash')).not.toBeInTheDocument();
  });
});
