/**
 * GoalCard — the goal board card.
 *
 * A single-line card whose background fills left-to-right in proportion to
 * completion (emerald when a checklist drives it, violet for manual progress),
 * with the title + percent riding on top. No inline checklist, manual nudger, or
 * separate meta row — the whole card is the gauge, so a lane of goals reads like
 * a stack of fuel bars and stays scannable instead of each card growing several
 * rows tall. To-dos and progress nudging live in the detail drawer, opened by
 * clicking the card.
 */
import { FolderKanban, ListChecks, Clock, Gauge } from 'lucide-react';
import type { DevGoal } from '@/lib/bindings/DevGoal';
import type { DevGoalItem } from '@/lib/bindings/DevGoalItem';
import type { DevKpi } from '@/lib/bindings/DevKpi';
import { useTranslation } from '@/i18n/useTranslation';
import { kpiTrack } from '../sub_kpis/kpiMath';
import { TRACK_COLOR } from '../sub_kpis/kpiMeta';
import { goalStatusMeta, isOngoing } from './goalStatus';
import { goalAccentEdgeStyle } from './goalsTheme';

export interface GoalCardProps {
  goal: DevGoal;
  items: DevGoalItem[];
  /** Origin-project name — shown as a chip in cross-project scope; undefined hides it. */
  projectName?: string;
  /**
   * The KPI this goal serves, resolved by the board.
   *
   * `goal.kpi_id` alone is not enough to paint anything useful — the NAME and
   * the PACE are what tell you whether this card is the one to work — so the
   * board looks the KPI up once for every card rather than each card fetching
   * its own. A dangling `kpi_id` (archived / removed KPI) resolves to undefined
   * and the chip simply does not render, the same silence `GoalKpiLink` keeps
   * in the drawer.
   */
  kpi?: DevKpi;
  onOpen?: () => void;
}

export default function GoalCard({ goal, items, projectName, kpi, onOpen }: GoalCardProps) {
  const { t } = useTranslation();
  const meta = goalStatusMeta(goal.status);
  const StatusIcon = meta.icon;
  const done = items.filter((i) => i.done).length;
  const total = items.length;
  const hasTodos = total > 0;
  const pct = hasTodos ? Math.round((done / total) * 100) : (goal.progress ?? 0);
  const overdue = !!goal.target_date && isOngoing(goal.status) && new Date(goal.target_date).getTime() < Date.now();
  const fill = hasTodos ? 'rgba(16,185,129,0.16)' : 'rgba(139,92,246,0.14)';
  // The outcome tint. A goal percent says how much of the PLAN is done; the KPI
  // pace says whether the NUMBER is moving — and only one of those is the
  // reason the goal exists. Painting them in one row without naming which is
  // which is how a board of title bars ends up ranking the wrong work first.
  const kpiColor = kpi ? TRACK_COLOR[kpiTrack(kpi)] : null;

  return (
    <div
      data-testid="goal-card"
      onClick={onOpen}
      style={goalAccentEdgeStyle(goal.status)}
      title={goal.title}
      className="group relative overflow-hidden rounded-modal border border-primary/10 bg-gradient-to-br from-card/60 to-card/20 cursor-pointer transition-[border-color,box-shadow] duration-200 hover:border-primary/25 hover:shadow-elevation-2"
    >
      {/* Ambient completion fill — the gauge. */}
      <div
        aria-hidden
        className="absolute inset-y-0 left-0 transition-[width] duration-300"
        style={{ width: `${pct}%`, background: fill }}
      />
      <div className="relative flex items-center gap-2 pl-3 pr-2.5 py-2">
        <StatusIcon className={`w-3.5 h-3.5 shrink-0 ${meta.tint}`} />
        <span className="typo-caption text-foreground truncate flex-1 min-w-0">{goal.title}</span>

        {projectName && (
          <span
            className="hidden sm:inline-flex items-center gap-1 max-w-[92px] px-1.5 py-0.5 rounded-full border border-primary/15 bg-background/40 text-[11px] text-foreground shrink-0"
            title={projectName}
          >
            <FolderKanban className="w-2.5 h-2.5 shrink-0 text-violet-400" />
            <span className="truncate">{projectName}</span>
          </span>
        )}

        {kpi && kpiColor && (
          <span
            data-testid="goal-card-kpi"
            aria-label={t.kpis.goal_link_title}
            className="hidden sm:inline-flex items-center gap-1 max-w-[110px] px-1.5 py-0.5 rounded-full border text-[11px] shrink-0"
            style={{
              color: kpiColor,
              borderColor: `color-mix(in srgb, ${kpiColor} 40%, transparent)`,
              background: `color-mix(in srgb, ${kpiColor} 10%, transparent)`,
            }}
          >
            <Gauge className="w-2.5 h-2.5 shrink-0" />
            <span className="truncate">{kpi.name}</span>
          </span>
        )}

        {hasTodos && (
          <span className="inline-flex items-center gap-1 text-[11px] text-foreground tabular-nums shrink-0" title={`${done}/${total} to-dos done`}>
            <ListChecks className="w-3 h-3 text-primary/60" />{done}/{total}
          </span>
        )}

        {overdue && (
          <span title="Overdue" className="shrink-0">
            <Clock className="w-3 h-3 text-red-400" />
          </span>
        )}

        <span className="text-[11px] text-foreground tabular-nums w-9 text-right shrink-0">{pct}%</span>
      </div>
    </div>
  );
}
