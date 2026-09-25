/**
 * useProcessColumns — the Frame right panel's model: one column per affected
 * project, each holding what waits on the operator (decisions) apart from what
 * is running (processes).
 *
 * Processes come in four kinds with their NATIVE state colours, the same ones
 * their home surfaces paint: fleet sessions use `FLEET_STATE_META` (the Fleet
 * page and footer), Run Desk tasks their queue status, Athena's live ops their
 * digest status, and her scheduled check-ins a single "later" tone. Run Desk
 * tasks and schedules are polled the way `FleetStatsSidePanel` polls them
 * (mount + every 20 s, failures silent so a lane degrades instead of erroring).
 */

import { useEffect, useMemo, useState } from 'react';
import { tasksPage } from '@/api/devTools/devTools';
import { companionListProactiveMessages, type ProactiveMessage } from '@/api/companion';
import type { DevTask } from '@/lib/bindings/DevTask';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import { FLEET_STATE_META } from '@/features/plugins/fleet/fleetStateMeta';
import { openDevToolsTab } from '@/features/fleet/monitor/navigateToProcess';
import type { WorkItem, Workforce } from './useWorkforce';

export type ProcessKind = 'fleet' | 'liveop' | 'rundesk' | 'schedule';

export interface ProcessMark {
  id: string;
  kind: ProcessKind;
  label: string;
  /** Native state word from the owning surface. */
  state: string;
  /** Native dot/fill class from the owning surface's palette. */
  dot: string;
  /** Needs the operator (awaiting input, stale, failed). */
  urgent: boolean;
  open?: () => void;
}

export interface ProjectColumn {
  key: string;
  label: string;
  decisions: WorkItem[];
  processes: ProcessMark[];
}

export const ATHENA_COLUMN = '__athena';

const FLEET_DOT = new Map(FLEET_STATE_META.map((m) => [m.id as string, m.dot]));
const RUNDESK_DOT: Record<string, string> = {
  running: 'bg-status-info',
  queued: 'bg-status-neutral',
  failed: 'bg-status-error',
};
const OP_DOT: Record<string, string> = {
  running: 'bg-primary',
  waiting: 'bg-status-warning',
  blocked: 'bg-status-warning',
  failed: 'bg-status-error',
};

// The repo's one door into a Dev Tools tab; a new setPluginTab write here
// would be another ungated arrival (census: ungated-plugin-destination-write).
const openRunDesk = () => openDevToolsTab('task-runner');

function openTerminal(id: string) {
  const sys = useSystemStore.getState();
  sys.fleetSetActiveSession(id);
  sys.fleetSetGridOpen(true);
}

function useRunnerAndSchedules() {
  const [tasks, setTasks] = useState<DevTask[]>([]);
  const [schedules, setSchedules] = useState<ProactiveMessage[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => {
      tasksPage(undefined, ['running', 'queued'], 12)
        .then((p) => alive && setTasks(p?.tasks ?? []))
        .catch(silentCatch('athena_chat_next_runner_tasks'));
      companionListProactiveMessages(true, 30)
        .then((msgs) => {
          if (!alive) return;
          setSchedules(
            (msgs ?? [])
              .filter((m) => m.scheduledFor && m.status === 'queued')
              .sort((a, b) => (a.scheduledFor ?? '').localeCompare(b.scheduledFor ?? ''))
              .slice(0, 8),
          );
        })
        .catch(silentCatch('athena_chat_next_schedules'));
    };
    load();
    const id = setInterval(load, 20_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return { tasks, schedules };
}

export function useProcessColumns(workforce: Workforce, athenaLabel: string): ProjectColumn[] {
  const sessions = useSystemStore((s) => s.fleetSessions);
  const projects = useSystemStore((s) => s.projects);
  const { tasks, schedules } = useRunnerAndSchedules();

  return useMemo(() => {
    const cols = new Map<string, ProjectColumn>();
    const col = (key: string, label: string) => {
      let c = cols.get(key);
      if (!c) {
        c = { key, label, decisions: [], processes: [] };
        cols.set(key, c);
      }
      return c;
    };
    const athena = col(ATHENA_COLUMN, athenaLabel);

    for (const s of sessions) {
      if (s.state === 'exited' || s.state === 'finished' || s.state === 'hibernated') continue;
      col(s.projectLabel, s.projectLabel).processes.push({
        id: `fleet:${s.id}`,
        kind: 'fleet',
        label: s.name ?? s.title ?? s.projectLabel,
        state: s.state,
        dot: FLEET_DOT.get(s.state) ?? 'bg-muted-dark',
        urgent: s.state === 'awaiting_input' || s.state === 'stale',
        open: () => openTerminal(s.id),
      });
    }
    const projectName = new Map((projects ?? []).map((p) => [p.id, p.name]));
    for (const t of tasks) {
      const name = t.project_id ? (projectName.get(t.project_id) ?? null) : null;
      (name ? col(name, name) : athena).processes.push({
        id: `task:${t.id}`,
        kind: 'rundesk',
        label: t.title,
        state: t.status,
        dot: RUNDESK_DOT[t.status] ?? 'bg-status-neutral',
        urgent: t.status === 'failed',
        open: openRunDesk,
      });
    }
    for (const o of workforce.ops) {
      athena.processes.push({
        id: `op:${o.id}`,
        kind: 'liveop',
        label: o.intent,
        state: o.status,
        dot: OP_DOT[o.status] ?? 'bg-status-neutral',
        urgent: o.status === 'waiting' || o.status === 'blocked',
      });
    }
    for (const m of schedules) {
      athena.processes.push({
        id: `sched:${m.id}`,
        kind: 'schedule',
        label: m.message,
        state: m.scheduledFor ?? '',
        dot: 'bg-brand-purple',
        urgent: false,
      });
    }
    for (const it of workforce.items) {
      (it.project ? col(it.project, it.project) : athena).decisions.push(it);
    }

    // Athena first, then projects with decisions, then by urgency and size.
    const rest = [...cols.values()].filter((c) => c.key !== ATHENA_COLUMN && (c.decisions.length || c.processes.length));
    rest.sort(
      (a, b) =>
        b.decisions.length - a.decisions.length ||
        Number(b.processes.some((p) => p.urgent)) - Number(a.processes.some((p) => p.urgent)) ||
        b.processes.length - a.processes.length,
    );
    return [athena, ...rest];
  }, [sessions, projects, tasks, schedules, workforce.ops, workforce.items, athenaLabel]);
}
