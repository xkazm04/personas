/**
 * Goal card variant — "Ledger".
 *
 * Metaphor: a spreadsheet / list row. One line per goal, nothing wraps: status
 * glyph + title (truncated) on the left, then a compact right cluster — origin
 * chip, to-do count, a fixed-width progress bar, a percent, an overdue flag.
 * The inline checklist + manual nudger from the baseline card are dropped (they
 * live in the detail drawer), so a lane of goals stays scannable at a glance
 * instead of each card growing several rows tall.
 */
import { FolderKanban, ListChecks, Clock } from 'lucide-react';
import type { DevGoal } from '@/lib/bindings/DevGoal';
import type { DevGoalItem } from '@/lib/bindings/DevGoalItem';
import { goalStatusMeta, isOngoing } from './goalStatus';
import { goalAccentEdgeStyle } from './goalsTheme';

export interface GoalCardVariantProps {
  goal: DevGoal;
  items: DevGoalItem[];
  projectName?: string;
  onOpen?: () => void;
  /** Kept for prop parity with the baseline; compact cards don't toggle inline. */
  onToggleItem?: (itemId: string, done: boolean) => void;
}

export default function GoalCardLedger({ goal, items, projectName, onOpen }: GoalCardVariantProps) {
  const meta = goalStatusMeta(goal.status);
  const StatusIcon = meta.icon;
  const done = items.filter((i) => i.done).length;
  const total = items.length;
  const hasTodos = total > 0;
  const pct = hasTodos ? Math.round((done / total) * 100) : (goal.progress ?? 0);
  const overdue = !!goal.target_date && isOngoing(goal.status) && new Date(goal.target_date).getTime() < Date.now();

  return (
    <div
      data-testid="goal-card"
      onClick={onOpen}
      style={goalAccentEdgeStyle(goal.status)}
      title={goal.title}
      className="group flex items-center gap-2 rounded-modal border border-primary/10 bg-gradient-to-br from-card/60 to-card/20 pl-3 pr-2.5 py-1.5 cursor-pointer transition-[border-color,box-shadow] duration-200 hover:border-primary/25 hover:shadow-elevation-2"
    >
      <StatusIcon className={`w-3.5 h-3.5 shrink-0 ${meta.tint}`} />
      <span className="typo-caption text-foreground truncate flex-1 min-w-0">{goal.title}</span>

      {projectName && (
        <span
          className="hidden sm:inline-flex items-center gap-1 max-w-[92px] px-1.5 py-0.5 rounded-full border border-primary/15 bg-primary/5 text-[11px] text-foreground shrink-0"
          title={projectName}
        >
          <FolderKanban className="w-2.5 h-2.5 shrink-0 text-violet-400" />
          <span className="truncate">{projectName}</span>
        </span>
      )}

      {hasTodos && (
        <span className="inline-flex items-center gap-1 text-[11px] text-foreground tabular-nums shrink-0" title={`${done}/${total} to-dos done`}>
          <ListChecks className="w-3 h-3 text-primary/60" />{done}/{total}
        </span>
      )}

      <div className="w-12 h-1 rounded-full bg-primary/10 overflow-hidden shrink-0" aria-hidden>
        <div
          className={`h-full rounded-full ${hasTodos ? 'bg-emerald-500/60' : 'bg-primary/50'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[11px] text-foreground tabular-nums w-9 text-right shrink-0">{pct}%</span>

      {overdue && (
        <span title="Overdue" className="shrink-0">
          <Clock className="w-3 h-3 text-red-400" />
        </span>
      )}
    </div>
  );
}
