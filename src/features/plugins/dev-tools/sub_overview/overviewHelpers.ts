/**
 * Tauri rejects with a serialised `AppError` object — `{ error, kind }`. Plain
 * `String(err)` collapses to `[object Object]`, so we extract the message
 * field explicitly. Prefer `error` (the human-readable string) over iterating
 * Object.values, which could surface the `kind` discriminator instead.
 */
export function formatErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    if (typeof obj.error === 'string') return obj.error;
    if (typeof obj.message === 'string') return obj.message;
    for (const v of Object.values(obj)) {
      if (typeof v === 'string') return v;
    }
    try { return JSON.stringify(obj); } catch (err) { silentCatch("features/plugins/dev-tools/sub_overview/overviewHelpers:catch1")(err); }
  }
  return String(err);
}

// ---------------------------------------------------------------------------
// "Today" activity feed — cross-tab timeline
// ---------------------------------------------------------------------------

import type { DevScan } from '@/lib/bindings/DevScan';
import type { DevTask } from '@/lib/bindings/DevTask';
import type { DevGoalSignal } from '@/lib/bindings/DevGoalSignal';
import { silentCatch } from '@/lib/silentCatch';
import { interpolate } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/en';

/** The slice of the `project_overview` catalog the Today feed labels read. */
export type TodayCopy = Pick<
  Translations['project_overview'],
  | 'today_scan' | 'today_agents_one' | 'today_agents_other' | 'today_ideas_one' | 'today_ideas_other'
  | 'today_task_created' | 'today_task_failed' | 'today_task_completed'
>;


export type ActivityKind =
  | 'scan_run'
  | 'task_created'
  | 'task_completed'
  | 'task_failed'
  | 'goal_signal';

export interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  timestamp: string;
  /** Short label, e.g. "Scan: 4 agents → 12 ideas" or "Task completed: Fix XYZ" */
  label: string;
  /** Identifier of the source row when click-jump is supported. */
  sourceId?: string;
}

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function tsMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return isNaN(t) ? null : t;
}

/**
 * Build a chronological feed of today's notable events from the project's
 * stored data — no backend query, just selecting + sorting what's already
 * in the Zustand slice. Capped at 30 entries so the panel stays scannable.
 */
export function buildTodayActivity(
  scans: DevScan[],
  tasks: DevTask[],
  signals: DevGoalSignal[],
  copy: TodayCopy,
): ActivityEvent[] {
  const since = startOfToday();
  const events: (ActivityEvent & { _ts: number })[] = [];

  for (const s of scans) {
    const t = tsMs(s.created_at);
    if (t === null || t < since) continue;
    const agentCount = s.scan_type.split(',').filter(Boolean).length;
    events.push({
      _ts: t,
      id: `scan-${s.id}`,
      kind: 'scan_run',
      timestamp: s.created_at,
      label: interpolate(copy.today_scan, {
        agents: interpolate(agentCount === 1 ? copy.today_agents_one : copy.today_agents_other, { count: agentCount }),
        ideas: interpolate(s.idea_count === 1 ? copy.today_ideas_one : copy.today_ideas_other, { count: s.idea_count }),
      }),
    });
  }

  for (const task of tasks) {
    const created = tsMs(task.created_at);
    if (created !== null && created >= since) {
      events.push({
        _ts: created,
        id: `task-created-${task.id}`,
        kind: 'task_created',
        timestamp: task.created_at,
        label: interpolate(copy.today_task_created, { title: task.title }),
        sourceId: task.id,
      });
    }
    const completed = tsMs(task.completed_at);
    if (completed !== null && completed >= since) {
      const isFail = task.status === 'failed';
      events.push({
        _ts: completed,
        id: `task-end-${task.id}`,
        kind: isFail ? 'task_failed' : 'task_completed',
        timestamp: task.completed_at!,
        label: interpolate(isFail ? copy.today_task_failed : copy.today_task_completed, { title: task.title }),
        sourceId: task.id,
      });
    }
  }

  for (const sig of signals) {
    const t = tsMs(sig.created_at);
    if (t === null || t < since) continue;
    const delta = sig.delta != null ? ` (${sig.delta > 0 ? '+' : ''}${sig.delta}%)` : '';
    events.push({
      _ts: t,
      id: `signal-${sig.id}`,
      kind: 'goal_signal',
      timestamp: sig.created_at,
      label: `${sig.message ?? sig.signal_type}${delta}`,
      sourceId: sig.goal_id,
    });
  }

  events.sort((a, b) => b._ts - a._ts);
  return events.slice(0, 30).map(({ _ts: _, ...rest }) => rest);
}

/**
 * Where a "Today" row jumps to. One predicate for both questions the row asks
 * (is it clickable? where does it go?): the row rendered every `scan_run` as a
 * button while the handler returned early on its missing `sourceId`, so a
 * scan row was a control that did nothing.
 */
export function activityJumpTarget(event: ActivityEvent): 'task' | 'goal' | 'skills' | null {
  switch (event.kind) {
    case 'scan_run':
      return 'skills';
    case 'task_created':
    case 'task_completed':
    case 'task_failed':
      return event.sourceId ? 'task' : null;
    case 'goal_signal':
      return event.sourceId ? 'goal' : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Vital-signs tinting
// ---------------------------------------------------------------------------

import type { RepoStats, MonitoringStats } from './adapters';

export type VitalTone = 'success' | 'warning' | 'error' | 'info' | 'neutral';

export interface VitalTones {
  issue: VitalTone;
  pr: VitalTone;
  commits: VitalTone;
  unresolved: VitalTone;
  events24: VitalTone;
  events7: VitalTone;
}

/**
 * Threshold-derived tints for the pulse strip. The one invariant worth stating:
 * **an unprobed source is never a passing gate.** When `monitorStats` is null
 * the project has no monitoring link at all, so its event tiles render "—" and
 * must stay `neutral`; only a *linked* zero earns `success`. Tinting a missing
 * probe green congratulates an unmonitored repo for having no errors.
 */
export function computeVitalTones(
  repoStats: RepoStats | null,
  monitorStats: MonitoringStats | null,
): VitalTones {
  return {
    issue: !repoStats || repoStats.openIssues === 0 ? 'neutral' : repoStats.openIssues > 50 ? 'error' : 'warning',
    pr: !repoStats || repoStats.openPullRequests === 0 ? 'neutral' : 'info',
    commits: !repoStats || repoStats.commitsLastWeek === 0 ? 'warning' : 'success',
    unresolved: !monitorStats || monitorStats.unresolvedIssues === null ? 'neutral'
      : monitorStats.unresolvedIssues === 0 ? 'success'
        : monitorStats.unresolvedIssues > 5 ? 'error' : 'warning',
    events24: !monitorStats || monitorStats.eventsLast24h === null ? 'neutral'
      : monitorStats.eventsLast24h === 0 ? 'success'
        : monitorStats.eventsLast24h > 100 ? 'error' : 'warning',
    events7: !monitorStats || monitorStats.eventsLastWeek === null ? 'neutral'
      : monitorStats.eventsLastWeek === 0 ? 'success' : 'info',
  };
}
