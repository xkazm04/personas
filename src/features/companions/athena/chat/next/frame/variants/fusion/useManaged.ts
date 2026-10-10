/**
 * Fusion · what Athena manages, by CATEGORY - the rich overview Current's side
 * panel gives (`fleet/FleetStatsSidePanel.tsx`: fleet terminals, her live ops,
 * Run Desk tasks, her own check-ins) plus the personas running for her, each
 * item reduced to one of four states the rail can draw: working, waiting on
 * you, stuck, idle.
 *
 * Same sources as the panel, so a circle and the surface behind it never
 * disagree: `fleetSessions` (kept live by the app-root fleet bridge), the
 * operative-memory digest (`workforce.ops`), Run Desk tasks and scheduled
 * check-ins as `useProcessColumns` already polls them, and for personas the
 * app's own execution feed plus the in-app process tracker (deduped by run).
 *
 * TODO(prototype, 2026-10-07): athena chat fusion - consolidate after the owner picks.
 */

import { useMemo } from 'react';
import { Bot, CalendarClock, ListChecks, Sparkles, SquareTerminal, type LucideIcon } from 'lucide-react';
import { openDevToolsTab, navigateToProcess } from '@/features/fleet/monitor/navigateToProcess';
import { useAgentStore } from '@/stores/agentStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { useSystemStore } from '@/stores/systemStore';
import type { ProjectColumn } from '../../../useProcessColumns';
import type { Workforce } from '../../../useWorkforce';
import { FUSION_COPY as F } from './copy';

export type ManagedState = 'working' | 'waiting' | 'stuck' | 'idle';
export type CategoryKey = 'fleet' | 'personas' | 'runners' | 'ops' | 'schedules';

export interface ManagedItem {
  id: string;
  label: string;
  state: ManagedState;
  /** When it last moved (ms), for a live relative age. */
  at: number | null;
  /** A short fact in place of an age: a project, a duration. */
  note: string | null;
  /** A check-in's due moment (ISO), drawn by the shared `AbsoluteTime`. */
  dueAt?: string | null;
  open?: () => void;
}

export interface ManagedCategory {
  key: CategoryKey;
  label: string;
  /** The category's own ink (identity), never a state colour. */
  ink: string;
  icon: LucideIcon;
  items: ManagedItem[];
  counts: Record<ManagedState, number>;
  openPage?: () => void;
}

export const STATE_ORDER: ManagedState[] = ['waiting', 'stuck', 'working', 'idle'];
export const STATE_INK: Record<ManagedState, string> = {
  working: 'var(--status-info)',
  waiting: 'var(--status-warning)',
  stuck: 'var(--status-error)',
  idle: 'var(--muted-dark)',
};

const RANK: Record<ManagedState, number> = { waiting: 0, stuck: 1, working: 2, idle: 3 };
const GONE = new Set(['exited', 'finished', 'hibernated']);

function fleetState(s: string): ManagedState {
  if (s === 'awaiting_input') return 'waiting';
  if (s === 'stale' || s === 'exited_failed') return 'stuck';
  if (s === 'running' || s === 'spawning') return 'working';
  return 'idle';
}
function genericState(s: string): ManagedState {
  if (s === 'running' || s === 'spawning') return 'working';
  if (s === 'waiting' || s === 'blocked' || s === 'awaiting_input' || s === 'input_required' || s === 'draft_ready') return 'waiting';
  if (s === 'failed' || s === 'stale') return 'stuck';
  return 'idle';
}
function openTerminal(id: string) {
  const sys = useSystemStore.getState();
  sys.fleetSetActiveSession(id);
  sys.fleetSetGridOpen(true);
}
function openPersona(personaId: string) {
  useSystemStore.getState().setSidebarSection('personas');
  useAgentStore.getState().selectPersona(personaId);
}

function category(key: CategoryKey, ink: string, icon: LucideIcon, items: ManagedItem[], openPage?: () => void): ManagedCategory {
  const counts: Record<ManagedState, number> = { working: 0, waiting: 0, stuck: 0, idle: 0 };
  for (const it of items) counts[it.state] += 1;
  items.sort((a, b) => RANK[a.state] - RANK[b.state] || (b.at ?? 0) - (a.at ?? 0));
  return { key, label: F.categories[key]!, ink, icon, items, counts, openPage };
}

export function useManaged(workforce: Workforce, columns: ProjectColumn[]): ManagedCategory[] {
  const sessions = useSystemStore((s) => s.fleetSessions);
  const executions = useOverviewStore((s) => s.globalExecutions);
  const processes = useOverviewStore((s) => s.activeProcesses);

  return useMemo(() => {
    const fleet: ManagedItem[] = sessions
      .filter((s) => !GONE.has(s.state))
      .map((s) => ({
        id: `fleet:${s.id}`,
        label: s.name ?? s.title ?? s.projectLabel,
        state: fleetState(s.state),
        at: Number(s.lastActivityMs) || null,
        note: s.projectLabel,
        open: () => openTerminal(s.id),
      }));

    const personas: ManagedItem[] = [];
    const seen = new Set<string>();
    for (const p of Object.values(processes)) {
      if (!p.personaId || p.status === 'completed' || p.status === 'cancelled') continue;
      if (p.runId) seen.add(p.runId);
      personas.push({
        id: `proc:${p.domain}:${p.runId ?? ''}`,
        label: p.label ?? p.domain,
        state: genericState(p.status),
        at: p.startedAt,
        note: null,
        open: p.navigateTo ? () => navigateToProcess(p, () => {}) : () => openPersona(p.personaId!),
      });
    }
    for (const e of executions) {
      if ((e.status !== 'running' && e.status !== 'queued') || seen.has(e.id)) continue;
      personas.push({
        id: `exec:${e.id}`,
        label: e.personaName ?? e.personaId,
        state: genericState(e.status),
        at: Date.parse(e.startedAt ?? e.createdAt) || null,
        note: null,
        open: () => openPersona(e.personaId),
      });
    }

    const marks = columns.flatMap((c) => c.processes);
    const runners: ManagedItem[] = marks
      .filter((m) => m.kind === 'rundesk')
      .map((m) => ({ id: m.id, label: m.label, state: genericState(m.state), at: null, note: null, open: m.open }));
    const schedules: ManagedItem[] = marks
      .filter((m) => m.kind === 'schedule')
      .map((m) => ({ id: m.id, label: m.label, state: 'idle' as const, at: null, note: null, dueAt: m.state || null }));
    const ops: ManagedItem[] = workforce.ops.map((o) => ({
      id: `op:${o.id}`,
      label: o.intent,
      state: genericState(o.status),
      at: null,
      note: o.duration || null,
    }));

    return [
      category('fleet', 'var(--role-external)', SquareTerminal, fleet, () => openDevToolsTab('fleet')),
      category('personas', 'var(--role-agent)', Bot, personas, () => useSystemStore.getState().setSidebarSection('personas')),
      category('runners', 'var(--brand-emerald)', ListChecks, runners, () => openDevToolsTab('task-runner')),
      category('ops', 'var(--primary)', Sparkles, ops),
      category('schedules', 'var(--role-human)', CalendarClock, schedules),
    ];
  }, [sessions, executions, processes, columns, workforce.ops]);
}
