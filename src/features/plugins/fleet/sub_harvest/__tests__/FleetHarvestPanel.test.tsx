/**
 * Unit tests for FleetHarvestPanel - the run picker and its report.
 *
 * The fleet API is mocked at the module boundary; useTranslation is real. What
 * these pin is that the report on screen (and in the Copy button) always
 * belongs to the run whose chip is selected, even when reads resolve out of
 * order.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { FleetRunReport } from '@/lib/bindings/FleetRunReport';
import type { FleetRunSummary } from '@/lib/bindings/FleetRunSummary';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

vi.mock('@/api/fleet/fleet', () => ({
  listRuns: vi.fn(),
  runReport: vi.fn(),
}));

import * as fleetApi from '@/api/fleet/fleet';
import { preloadSectionsAsync } from '@/i18n/useTranslation';
import { FleetHarvestPanel } from '../FleetHarvestPanel';

// `plugins` is a code-split i18n section; await it so labels are real.
beforeAll(() => preloadSectionsAsync('en', ['plugins']));

const run = (runId: string, runLabel: string): FleetRunSummary => ({
  runId, runLabel, startedAtMs: 1n, sessionCount: 1, finishedCount: 1,
});

const report = (runId: string, label: string): FleetRunReport => ({
  runId,
  runLabel: runId,
  startedAtMs: 1n,
  sessions: [{
    sessionId: `${runId}-s`, claudeSessionId: null, label, projectLabel: 'repo',
    state: 'finished', summary: null,
    tokens: { input: 1n, output: 1n, cacheCreation: 0n, cacheRead: 0n },
    filesTouched: 1, userMessages: 1, assistantMessages: 1, createdAtMs: 1n, lastActivityMs: 1n,
  }],
  totals: {
    sessionCount: 1, finishedCount: 1, activeCount: 0, exitedCount: 0,
    tokens: { input: 1n, output: 1n, cacheCreation: 0n, cacheRead: 0n }, filesTouched: 1,
  },
} as unknown as FleetRunReport);

describe('FleetHarvestPanel', () => {
  beforeEach(() => {
    vi.mocked(fleetApi.listRuns).mockReset().mockResolvedValue([run('a', 'Run A'), run('b', 'Run B')]);
    vi.mocked(fleetApi.runReport).mockReset();
  });

  it('keeps the selected run when the previous run\'s report resolves late', async () => {
    let resolveA: (r: FleetRunReport) => void = () => {};
    vi.mocked(fleetApi.runReport).mockImplementation((id: string) =>
      id === 'a'
        ? new Promise<FleetRunReport>((r) => { resolveA = r; })
        : Promise.resolve(report('b', 'Session of B')),
    );
    render(<FleetHarvestPanel open onClose={() => {}} />);

    // Run A is auto-selected and its read hangs; the operator picks B.
    await userEvent.click(await screen.findByTestId('fleet-harvest-run-b'));
    await screen.findByText(/Session of B/);

    await act(async () => { resolveA(report('a', 'Session of A')); });
    expect(screen.getByText(/Session of B/)).toBeInTheDocument();
    expect(screen.queryByText(/Session of A/)).not.toBeInTheDocument();
  });

  it('never shows the previous run\'s report while the new one loads', async () => {
    vi.mocked(fleetApi.runReport).mockImplementation((id: string) =>
      id === 'a' ? Promise.resolve(report('a', 'Session of A')) : new Promise<FleetRunReport>(() => {}),
    );
    render(<FleetHarvestPanel open onClose={() => {}} />);
    await screen.findByText(/Session of A/);

    await userEvent.click(screen.getByTestId('fleet-harvest-run-b'));
    expect(screen.queryByText(/Session of A/)).not.toBeInTheDocument();
  });
});
