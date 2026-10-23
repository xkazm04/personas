import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useOverviewStore } from '@/stores/overviewStore';
import { ideaScanOutcome, useIdeaScanBusy } from '../lib/useIdeaScanBusy';

function activeKeys(): string[] {
  return Object.keys(useOverviewStore.getState().activeProcesses).filter((k) => k.startsWith('idea_scan'));
}

describe('useIdeaScanBusy settles exactly the scan an event names', () => {
  beforeEach(() => {
    useOverviewStore.setState({ activeProcesses: {}, activeProcessCount: 0, recentProcesses: [] });
  });

  it('one project finishing releases only that project and ends only its drawer row', () => {
    const { result } = renderHook(() => useIdeaScanBusy());
    act(() => {
      result.current.begin('p1');
      result.current.attach('p1', 'job-1', 'Idea Scan (a)');
      result.current.begin('p2');
      result.current.attach('p2', 'job-2', 'Idea Scan (b)');
    });
    expect(activeKeys().sort()).toEqual(['idea_scan:job-1', 'idea_scan:job-2']);

    let settled: ReturnType<typeof result.current.settle> = null;
    act(() => { settled = result.current.settle('job-1', 'completed'); });
    expect(settled).toEqual({ slug: 'p1', outcome: 'completed' });
    expect([...result.current.busySlugs]).toEqual(['p2']);
    expect(activeKeys()).toEqual(['idea_scan:job-2']);
    const recent = useOverviewStore.getState().recentProcesses[0];
    expect(recent?.runId).toBe('job-1');
    expect(recent?.status).toBe('completed');
  });

  it('a cancelled scan is terminal too', () => {
    const { result } = renderHook(() => useIdeaScanBusy());
    act(() => { result.current.begin('p1'); result.current.attach('p1', 'job-1', 'x'); });
    act(() => { result.current.settle('job-1', 'cancelled'); });
    expect(result.current.busySlugs.size).toBe(0);
    expect(useOverviewStore.getState().recentProcesses[0]?.status).toBe('cancelled');
  });

  it('a running tick and a foreign job change nothing here', () => {
    const { result } = renderHook(() => useIdeaScanBusy());
    act(() => { result.current.begin('p1'); result.current.attach('p1', 'job-1', 'x'); });
    let running: ReturnType<typeof result.current.settle> = null;
    let foreign: ReturnType<typeof result.current.settle> = null;
    act(() => {
      running = result.current.settle('job-1', 'running');
      foreign = result.current.settle('job-9', 'completed');
    });
    expect(running).toBeNull();
    expect(foreign).toEqual({ slug: null, outcome: 'completed' });
    expect([...result.current.busySlugs]).toEqual(['p1']);
    expect(activeKeys()).toEqual(['idea_scan:job-1']);
  });
});

describe('ideaScanOutcome covers every status the idea scanner writes', () => {
  it('each non-running set_status literal in idea_scanner.rs is terminal here', () => {
    const src = readFileSync(
      resolve(__dirname, '../../../../../src-tauri/src/commands/infrastructure/idea_scanner.rs'),
      'utf8',
    );
    const statuses = new Set(
      [...src.matchAll(/IDEA_SCAN_JOBS\.set_status\(\s*&[\w_]+,\s*&[\w_]+,\s*"([a-z_]+)"/g)].map((m) => m[1]!),
    );
    expect(statuses.size).toBeGreaterThanOrEqual(3);
    for (const s of statuses) {
      if (s === 'running') expect(ideaScanOutcome(s)).toBeNull();
      else expect(ideaScanOutcome(s)).not.toBeNull();
    }
  });
});
