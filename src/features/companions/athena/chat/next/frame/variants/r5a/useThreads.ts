/**
 * useThreads - the thread rail's read model: one lane per project with live
 * work (plus Athena's own lane), each holding what is BLOCKED ON YOU (its
 * gates) apart from what is running (its runs), with an age per run.
 *
 * It folds `useProcessColumns` (the same per-project columns Filament and
 * Spread read, so a pill here and the stage behind it agree) and adds the one
 * thing the columns drop: when each run last moved. Fleet sessions carry
 * `lastActivityMs`; Athena's live ops carry a duration; check-ins a time.
 *
 * TODO(prototype, 2026-10-07): athena chat round 5 - consolidate after the owner picks.
 */

import { useMemo } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { ATHENA_COLUMN, type ProjectColumn } from '../../../useProcessColumns';
import type { Workforce, WorkItem } from '../../../useWorkforce';

/** How a run draws: one closed vocabulary for the pill ticks and the board's marks. */
export type RunGlyph = 'run' | 'start' | 'queue' | 'idle' | 'stuck' | 'gate' | 'later';

export interface ThreadRun {
  id: string;
  label: string;
  state: string;
  glyph: RunGlyph;
  /** Epoch ms of the last movement, when known. */
  atMs: number | null;
  /** A scheduled check-in's time (ISO), when this run is one. */
  atIso: string | null;
  /** Athena's own op duration ("4m"), when this run is one. */
  duration: string | null;
  open?: () => void;
}

export interface ThreadLane {
  key: string;
  label: string;
  athena: boolean;
  gates: WorkItem[];
  runs: ThreadRun[];
  /** Runs that are moving right now. */
  live: number;
  /** Items in this lane waiting on the operator (what Alt+W opens): the pills sum to the capsule's count. */
  gated: number;
  /** Runs asking for input with no item of their own: a gate too, answered in their terminal. */
  asking: number;
}

const GLYPH: Record<string, RunGlyph> = {
  running: 'run',
  spawning: 'start',
  awaiting_input: 'gate',
  waiting: 'gate',
  blocked: 'gate',
  stale: 'stuck',
  failed: 'stuck',
  queued: 'queue',
  idle: 'idle',
};

const RANK: Record<RunGlyph, number> = { gate: 0, stuck: 1, run: 2, start: 3, queue: 4, later: 5, idle: 6 };

export function useThreads(columns: ProjectColumn[], workforce: Workforce): ThreadLane[] {
  const sessions = useSystemStore((s) => s.fleetSessions);
  return useMemo(() => {
    const since = new Map(sessions.map((s) => [`fleet:${s.id}`, Number(s.lastActivityMs)]));
    const opDuration = new Map(workforce.ops.map((o) => [`op:${o.id}`, o.duration]));
    const lanes: ThreadLane[] = [];
    for (const c of columns) {
      const runs: ThreadRun[] = c.processes.map((p) => {
        const schedule = p.kind === 'schedule';
        return {
          id: p.id,
          label: p.label,
          state: schedule ? 'scheduled' : p.state,
          glyph: schedule ? 'later' : (GLYPH[p.state] ?? 'idle'),
          atMs: since.get(p.id) ?? null,
          atIso: schedule && p.state ? p.state : null,
          duration: opDuration.get(p.id) ?? null,
          open: p.open,
        };
      });
      runs.sort((a, b) => RANK[a.glyph] - RANK[b.glyph]);
      const athena = c.key === ATHENA_COLUMN;
      // An MCP request IS its session's ask: count the pair once.
      const asking = runs.filter((r) => r.glyph === 'gate').length;
      const requests = c.decisions.filter((d) => d.kind === 'session_request').length;
      const lane: ThreadLane = {
        key: c.key,
        label: c.label,
        athena,
        gates: c.decisions,
        runs,
        live: runs.filter((r) => r.glyph === 'run' || r.glyph === 'start').length,
        gated: c.decisions.length,
        asking: Math.max(0, asking - requests),
      };
      // Athena's lane earns a pill only when she has something going.
      if (lane.gates.length > 0 || lane.runs.length > 0) lanes.push(lane);
    }
    return lanes;
  }, [columns, sessions, workforce.ops]);
}
