import { useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import type { Translations } from '@/i18n/en';
import { MILESTONES, type Milestone } from './strategyPresets';
import type { DevCompetitionSlot } from '@/lib/bindings/DevCompetitionSlot';
import type { DevTask } from '@/lib/bindings/DevTask';
import { elapsedStr, durationStr } from './timeUtils';

interface SlotProgress {
  slot: DevCompetitionSlot;
  task: DevTask | null;
  currentMilestone: Milestone;
  detail: string;
  progressPct: number;
}

// Static class maps for the milestone colors (see strategyPresets MILESTONES).
// Tailwind's JIT only sees literal class strings — the previous
// `bg-${m.color}-400` interpolation produced never-generated classes, so
// milestone dots, bars, and labels silently rendered unstyled.
const MILESTONE_DOT: Record<string, string> = {
  blue: 'bg-blue-400', indigo: 'bg-indigo-400', violet: 'bg-violet-400',
  amber: 'bg-amber-400', emerald: 'bg-emerald-400',
};
const MILESTONE_BAR: Record<string, string> = {
  blue: 'bg-gradient-to-r from-blue-500 to-blue-400',
  indigo: 'bg-gradient-to-r from-indigo-500 to-indigo-400',
  violet: 'bg-gradient-to-r from-violet-500 to-violet-400',
  amber: 'bg-gradient-to-r from-amber-500 to-amber-400',
  emerald: 'bg-gradient-to-r from-emerald-500 to-emerald-400',
};
const MILESTONE_TEXT: Record<string, string> = {
  blue: 'text-blue-400', indigo: 'text-indigo-400', violet: 'text-violet-400',
  amber: 'text-amber-400', emerald: 'text-emerald-400',
};

/**
 * Parse the latest milestone from a task's output.
 * The task executor emits lines like:
 *   [Progress] {"milestone": "implementing", "detail": "Added middleware"}
 * We check the task's last_event or progress_pct to derive the milestone.
 * Since we can't read raw output here, we use progress_pct as a proxy.
 */
function deriveProgress(task: DevTask | null, t: Translations): { milestone: Milestone; detail: string } {
  // Every caption below was a raw English literal. Three of the four had an
  // exact equivalent in `status_tokens.execution` already, so they resolve
  // through the shared vocabulary rather than adding a fourth copy of
  // "Completed"/"Queued"/"Failed" to this file.
  if (!task) return { milestone: MILESTONES[0]!, detail: t.plugins.dev_lifecycle.racing_waiting };

  if (task.status === 'completed') {
    return { milestone: MILESTONES[MILESTONES.length - 1]!, detail: tokenLabel(t, 'execution', 'completed') };
  }
  if (task.status === 'failed') {
    return { milestone: MILESTONES[0]!, detail: task.error ?? tokenLabel(t, 'execution', 'failed') };
  }
  if (task.status === 'queued') {
    return { milestone: MILESTONES[0]!, detail: tokenLabel(t, 'execution', 'queued') };
  }

  // Use progress_pct from task to find the closest milestone
  const pct = task.progress_pct ?? 0;
  let current = MILESTONES[0]!;
  for (const m of MILESTONES) {
    if (pct >= m.progressPct) current = m;
  }
  return { milestone: current, detail: tokenLabel(t, 'task_phase', current.labelToken) };
}

interface RacingProgressProps {
  slots: { slot: DevCompetitionSlot; task: DevTask | null }[];
}

export function RacingProgress({ slots }: RacingProgressProps) {
  const { t } = useTranslation();
  const progresses: SlotProgress[] = useMemo(() =>
    slots.map(({ slot, task }) => {
      const { milestone, detail } = deriveProgress(task, t);
      return {
        slot, task,
        currentMilestone: milestone,
        detail,
        progressPct: task?.status === 'completed' ? 100
          : task?.status === 'failed' ? milestone.progressPct
          : milestone.progressPct,
      };
    }),
  [slots, t]);

  return (
    <div className="space-y-2">
      {/* Milestone legend */}
      <div className="flex items-center gap-1 typo-caption text-foreground overflow-x-auto pb-1">
        {MILESTONES.map((m, i) => (
          <span key={m.id} className="flex items-center gap-1 shrink-0">
            {i > 0 && <span className="text-foreground">→</span>}
            <span className={`w-1.5 h-1.5 rounded-full ${MILESTONE_DOT[m.color] ?? 'bg-blue-400'}`} />
            {tokenLabel(t, 'task_phase', m.labelToken)}
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
              <span className="typo-card-label w-16 shrink-0">
                {slot.strategy_label}
              </span>
              <div className="flex-1 h-2.5 bg-background/60 rounded-full overflow-hidden relative">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${
                    isDone ? 'bg-gradient-to-r from-emerald-500 to-emerald-400'
                    : isFailed ? 'bg-red-400'
                    : (MILESTONE_BAR[currentMilestone.color] ?? MILESTONE_BAR.blue)
                  }`}
                  style={{ width: `${progressPct}%` }}
                />
                {/* Calm leading-edge highlight — the fill's width transition
                    (duration-700 above) IS the motion; this static strip just
                    marks the current position without pulsing (loading-pattern
                    v2 §1: no animate-pulse on loading-adjacent chrome). */}
                {isRunning && (
                  <div
                    className="absolute top-0 h-full w-4 bg-secondary/20 rounded-full"
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
              <span className={`${MILESTONE_TEXT[currentMilestone.color] ?? MILESTONE_TEXT.blue} shrink-0`}>
                {tokenLabel(t, 'task_phase', currentMilestone.labelToken)}
              </span>
              <span className="text-foreground truncate flex-1">{detail}</span>
              {isRunning && task?.started_at && (
                <span className="text-foreground shrink-0">
                  {elapsedStr(new Date(task.started_at).getTime())}
                </span>
              )}
              {/* A FINISHED slot's time is the run's duration, not the time
                  since it started. This branch called `elapsedStr(started_at)`
                  — the same helper the running branch above uses — so a
                  completed racer's badge kept climbing on every 8s poll and
                  disagreed with CompetitionSlotRow, which prints
                  `durationStr(started_at, completed_at)` for the same slot. */}
              {isDone && task?.started_at && task?.completed_at && (
                <span className="text-emerald-400 shrink-0">
                  {durationStr(task.started_at, task.completed_at)}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
