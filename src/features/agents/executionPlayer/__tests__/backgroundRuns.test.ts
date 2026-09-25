/**
 * Background runs lane policy (scan-sweep challenge-2026-09-23, agents-deployment-B).
 *
 * A run started while another is focused becomes a background run. These cases
 * pin what the mini player lets you do with one: stop it while it is live, open
 * it at any time, dismiss it once it is terminal, and keep a failure on screen
 * until it is dismissed instead of fading it after 10 s.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useOverviewStore } from '@/stores/overviewStore';
import { useSystemStore } from '@/stores/systemStore';
import {
  backgroundLaneActions,
  backgroundSummary,
  openBackgroundRun,
  shouldAutoFade,
} from '../backgroundRuns';

const T0 = Date.parse('2026-09-24T10:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

describe('backgroundLaneActions', () => {
  it('case 1: a live run can be stopped and opened, not dismissed', () => {
    expect(backgroundLaneActions({ status: 'running' })).toEqual({ stop: true, open: true, dismiss: false });
    expect(backgroundLaneActions({ status: 'queued' })).toEqual({ stop: true, open: true, dismiss: false });
  });

  it('case 2: a failed run can be opened and dismissed, not stopped', () => {
    expect(backgroundLaneActions({ status: 'failed' })).toEqual({ stop: false, open: true, dismiss: true });
  });
});

describe('shouldAutoFade', () => {
  it('case 3: a failure stays until dismissed; a completed run fades after 10 s', () => {
    expect(shouldAutoFade({ status: 'failed', terminalAt: iso(T0) }, T0 + 60_000)).toBe(false);
    expect(shouldAutoFade({ status: 'completed', terminalAt: iso(T0) }, T0 + 11_000)).toBe(true);
    // Not yet 10 s, and never for a live run.
    expect(shouldAutoFade({ status: 'completed', terminalAt: iso(T0) }, T0 + 5_000)).toBe(false);
    expect(shouldAutoFade({ status: 'running' }, T0 + 60_000)).toBe(false);
  });
});

describe('backgroundSummary', () => {
  it('case 6: the chip still counts a failure after the old 10 s fade window', () => {
    const summary = backgroundSummary([
      { status: 'failed', terminalAt: iso(T0 - 60_000) },
      { status: 'running' },
    ]);
    expect(summary).toEqual({ running: 1, failed: 1 });
  });
});

describe('openBackgroundRun', () => {
  beforeEach(() => {
    useOverviewStore.setState({ pendingExecutionFocus: null, overviewTab: 'home' });
    useSystemStore.setState({ sidebarSection: 'personas' });
  });

  it('case 5: hands the run to the executions list through the pendingExecutionFocus door', () => {
    openBackgroundRun('bg1');
    expect(useOverviewStore.getState().pendingExecutionFocus).toBe('bg1');
    expect(useOverviewStore.getState().overviewTab).toBe('executions');
    expect(useSystemStore.getState().sidebarSection).toBe('overview');
  });
});
