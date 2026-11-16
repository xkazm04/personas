import { useMemo } from 'react';
import { Activity, ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useAthenaStore } from './athenaStore';
import { TaskTag } from './TaskTag';

import Button from '@/features/shared/components/buttons/Button';

/**
 * Persistent, turn-independent tray of every in-flight background Task
 * (Athena async-UX phase 2). Unlike the in-chat task tags (pinned to the
 * message that spawned them), this shows ALL queued/running tasks across the
 * whole session in one place, so parallel work from different turns is
 * glanceable above the composer. Reads the unified `companion://job` row map
 * (`jobsById`); renders nothing when idle.
 */
export function ActivityTray() {
  const { t, tx } = useTranslation();
  // Lifted into the store so a `ref:job/…` link can unfold the tray.
  const collapsed = useAthenaStore((s) => s.activityTrayCollapsed);
  const setCollapsed = useAthenaStore((s) => s.setActivityTrayCollapsed);
  const jobsById = useAthenaStore((s) => s.jobsById);
  const inTurnToolJobs = useAthenaStore((s) => s.inTurnToolJobs);

  const running = useMemo(
    () =>
      [...Object.values(jobsById), ...Object.values(inTurnToolJobs)]
        .filter((j) => j.status === 'queued' || j.status === 'running')
        // running first, then by recency (newest queued on top)
        .sort((a, b) => {
          if (a.status !== b.status) return a.status === 'running' ? -1 : 1;
          return (b.createdAt || '').localeCompare(a.createdAt || '');
        }),
    [jobsById, inTurnToolJobs],
  );

  if (running.length === 0) return null;

  const Chevron = collapsed ? ChevronRight : ChevronDown;
  const count = running.length;

  return (
    <div
      className="mx-3 mb-1.5 rounded-card border border-status-info/20 bg-status-info/10/[0.04]"
      data-testid="companion-activity-tray"
      data-task-count={count}
    >
      <Button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        variant="ghost"
        size="sm"
        block
      >
        <Chevron className="w-3.5 h-3.5 shrink-0 text-foreground" />
        <Activity className="w-3.5 h-3.5 shrink-0 text-status-info animate-pulse" />
        <span className="flex-1 text-left font-medium">
          {tx(
            count === 1 ? t.athena.tasks_running_one : t.athena.tasks_running_other,
            { count },
          )}
        </span>
      </Button>
      {!collapsed && (
        <div className="px-2 pb-2 space-y-1">
          {running.map((job) => (
            <TaskTag key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}
