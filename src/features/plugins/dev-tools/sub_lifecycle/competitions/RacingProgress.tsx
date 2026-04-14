import { useMemo } from 'react';
import { MILESTONES, type Milestone } from './strategyPresets';
import type { DevCompetitionSlot } from '@/lib/bindings/DevCompetitionSlot';
import type { DevTask } from '@/lib/bindings/DevTask';
import { elapsedStr } from './timeUtils';

interface SlotProgress {
  slot: DevCompetitionSlot;
  task: DevTask | null;
  currentMilestone: Milestone;
  detail: string;
  progressPct: number;
}

/**
 * Parse the latest milestone from a task's output.
 * The task executor emits lines like:
 *   [Progress] {"milestone": "implementing", "detail": "Added middleware"}
 * We check the task's last_event or progress_pct to derive the milestone.
 * Since we can't read raw output here, we use progress_pct as a proxy.
 */
function deriveProgress(task: DevTask | null): { milestone: Milestone; detail: string } {
  if (!task) return { milestone: MILESTONES[0]!, detail: 'Waiting...' };

  if (task.status === 'completed') {
    return { milestone: MILESTONES[MILESTONES.length - 1]!, detail: 'Finished' };
  }
  if (task.status === 'failed') {
    return { milestone: MILESTONES[0]!, detail: task.error ?? 'Failed' };
  }
  if (task.status === 'queued') {
    return { milestone: MILESTONES[0]!, detail: 'In queue' };
  }

  // Use progress_pct from task to find the closest milestone
  const pct = task.progress_pct ?? 0;
  let current = MILESTONES[0]!;
  for (const m of MILESTONES) {
    if (pct >= m.progressPct) current = m;
  }
  return { milestone: current, detail: current.label };
}

interface RacingProgressProps {
  slots: { slot: DevCompetitionSlot; task: DevTask | null }[];
  competitionStartedAt: string;
}

export function RacingProgress({ slots }: RacingProgressProps) {
  const progresses: SlotProgress[] = useMemo(() =>
    slots.map(({ slot, task }) => {
      const { milestone, detail } = deriveProgress(task);
      return {
        slot, task,
        currentMilestone: milestone,
        detail,
        progressPct: task?.status === 'completed' ? 100
          : task?.status === 'failed' ? milestone.progressPct
          : milestone.progressPct,
      };
    }),
  [slots]);

  return (
    <div className="space-y-2">
      {/* Milestone legend */}
      <div className="flex items-center gap-1 typo-caption text-foreground/60 overflow-x-auto pb-1">
        {MILESTONES.map((m, i) => (
          <span key={m.id} className="flex items-center gap-1 shrink-0">
            {i > 0 && <span className="text-foreground/20">→</span>}
            <span className={`w-1.5 h-1.5 rounded-full bg-${m.color}-400`} />
            {m.label}
          </span>
        ))}
      </div>

      {/* Racing bars */}
      {progresses.map(({ slot, task, currentMilestone, detail, progressPct }) => {
        const isRunning = task?.status === 'running';
        const isDone = task?.status === 'completed';
        const isFailed = task?.status === 'failed';
        const isDq = slot.disqualified;

        return (
          <div key={slot.id} className={`rounded-interactive border p-2.5 ${
            isDone ? 'border-emerald-500/25 bg-emerald-500/5'
            : isFailed || isDq ? 'border-red-500/15 bg-red-500/5 opacity-70'
            : isRunning ? 'border-blue-500/20 bg-blue-500/5'
            : 'border-primary/10 bg-card/20'
          }`}>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="typo-heading text-primary [text-shadow:_0_0_8px_color-mix(in_oklab,var(--primary)_35%,transparent)] w-16 shrink-0">
                {slot.strategy_label}
              </span>
              <div className="flex-1 h-2.5 bg-background/60 rounded-full overflow-hidden relative">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${
                    isDone ? 'bg-gradient-to-r from-emerald-500 to-emerald-400'
                    : isFailed ? 'bg-red-400'
                    : `bg-gradient-to-r from-${currentMilestone.color}-500 to-${currentMilestone.color}-400`
                  }`}
                  style={{ width: `${progressPct}%` }}
                />
                {isRunning && (
                  <div
                    className="absolute top-0 h-full w-4 bg-white/20 rounded-full animate-pulse"
                    style={{ left: `${Math.max(0, progressPct - 3)}%` }}
                  />
                )}
              </div>
              <span className={`typo-caption w-10 text-right shrink-0 ${
                isDone ? 'text-emerald-400' : isFailed ? 'text-red-400' : 'text-foreground'
              }`}>
                {progressPct}%
              </span>
            </div>
            <div className="flex items-center gap-3 typo-caption">
              <span className={`text-${currentMilestone.color}-400 shrink-0`}>
                {currentMilestone.label}
              </span>
              <span className="text-foreground truncate flex-1">{detail}</span>
              {isRunning && task?.started_at && (
                <span className="text-foreground/60 shrink-0">
                  {elapsedStr(new Date(task.started_at).getTime())}
                </span>
              )}
              {isDone && task?.started_at && task?.completed_at && (
                <span className="text-emerald-400 shrink-0">
                  {elapsedStr(new Date(task.started_at).getTime())}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
