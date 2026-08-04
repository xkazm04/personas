/**
 * Render-cost guard for the monitor ledger.
 *
 * The monitor is mounted while ~50 sessions stream `FLEET_SESSION_STATE`
 * events. Before the memoized-row split, ONE session's stats moving rebuilt
 * every terminal object and re-rendered all 50 rows. This test pins the new
 * contract: a single-session change costs a single row render.
 *
 * Row renders are counted through `costRatio`, which every row body calls
 * exactly once (the Effort cell).
 */
import { describe, it, expect, vi } from 'vitest';
import { useMemo, useRef } from 'react';
import { render, act } from '@testing-library/react';

import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { FleetMonitorStats } from '@/lib/bindings/FleetMonitorStats';

const counter = vi.hoisted(() => ({ rows: 0 }));

vi.mock('../monitorMeta', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../monitorMeta')>();
  return {
    ...actual,
    costRatio: (t: Parameters<typeof actual.costRatio>[0]) => {
      counter.rows += 1;
      return actual.costRatio(t);
    },
  };
});

import { MonitorLedger } from '../MonitorLedger';
import { sessionsToMonitorModel } from '../monitorModel';
import type { MonitorTerminal } from '../monitorTypes';

const NOOP = () => {};
const N = 50;
const NOW = 1_800_000_000_000;

const SESSIONS: FleetSession[] = Array.from({ length: N }, (_, i) => ({
  id: `s${i}`,
  projectLabel: `repo-${i % 4}`,
  name: `session ${i}`,
  title: null,
  state: i % 5 === 0 ? 'awaiting_input' : 'running',
  dozing: false,
  mode: 'interactive',
  lastActivityMs: NOW - i * 60_000,
  childPid: 1000 + i,
} as unknown as FleetSession));

function statsFor(bumpedId: string | null, bump: number): Map<string, FleetMonitorStats> {
  const m = new Map<string, FleetMonitorStats>();
  for (const s of SESSIONS) {
    m.set(s.id, {
      sessionId: s.id,
      claudeSessionId: `claude-${s.id}`,
      screenHealth: 'working',
      bgProcsLaunched: 2,
      subagentsActive: 1,
      subagentsTotal: 3,
      // Spread across the fleet so the bumped row stays mid-pack — see the
      // maxTokens note in the assertion below.
      outputTokens: 10_000 + Number(s.id.slice(1)) * 1_000 + (s.id === bumpedId ? bump : 0),
      contextTokens: 60_000,
      memMb: 220,
    } as unknown as FleetMonitorStats);
  }
  return m;
}

function Harness({ stats }: { stats: Map<string, FleetMonitorStats> }) {
  const prev = useRef<MonitorTerminal[]>([]);
  const model = useMemo(() => {
    const next = sessionsToMonitorModel(SESSIONS, stats, prev.current);
    prev.current = next;
    return next;
  }, [stats]);
  return <MonitorLedger fleet={model} onOpen={NOOP} armedId={null} />;
}

describe('monitor ledger render cost', () => {
  it('re-renders only the row whose stats changed', () => {
    const { rerender } = render(<Harness stats={statsFor(null, 0)} />);
    expect(counter.rows).toBe(N); // first paint renders every row

    counter.rows = 0;
    act(() => {
      rerender(<Harness stats={statsFor('s7', 5_000)} />);
    });

    // maxTokens is derived from the fleet max; bumping a mid-pack row leaves it
    // unchanged, so exactly one row's data slice moved.
    expect(counter.rows).toBe(1);
  });

  it('reuses terminal objects for sessions whose data did not move', () => {
    const first = sessionsToMonitorModel(SESSIONS, statsFor(null, 0));
    const second = sessionsToMonitorModel(SESSIONS, statsFor('s7', 5_000), first);
    const changed = second.filter((t, i) => t !== first[i]);
    expect(changed.map((t) => t.id)).toEqual(['s7']);
  });
});
