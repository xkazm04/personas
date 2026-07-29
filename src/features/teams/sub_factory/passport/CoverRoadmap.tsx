// The cover's MINIMIZED roadmap — a direct door into the Ship layer from the
// passport wall. One pip per milestone (filled = shipped, ringed = the active
// cut, hollow = planned) over a single line naming the NEXT milestone. The
// whole strip is one button: clicking it opens the project on its Ship tab
// instead of the default Overview, so the roadmap is reachable in one click
// from L1.
//
// Data derives from dev_milestones rows only — no percentages are stored; the
// full exit-criteria machinery stays in the Ship tab (useShipData).
import { ChevronRight, Flag } from 'lucide-react';

import type { DevMilestone } from '@/lib/bindings/DevMilestone';
import { useTranslation } from '@/i18n/useTranslation';

import { deriveShipVelocity } from '../l2/ship/shipVelocity';
import { INK } from './passportInk';

export type CoverMilestoneStatus = 'planned' | 'active' | 'shipped';

export interface CoverRoadmapStep {
  id: string;
  name: string;
  status: CoverMilestoneStatus;
}

export interface CoverRoadmapVM {
  steps: CoverRoadmapStep[];
  shipped: number;
  /** First unshipped milestone (active before planned) — the "next" line. */
  next: { name: string; targetDate: string | null; status: CoverMilestoneStatus } | null;
  /**
   * Cycle-time forecast for that next milestone, derived from this project's
   * own cut-to-ship history. Null below the evidence bar (see shipVelocity),
   * so the cover shows a date only when the rows actually support one.
   */
  forecast: { date: string; late: boolean } | null;
}

/** dev_milestones rows → the cover's minimized view model. Ordered by
 *  order_index so the pips read left-to-right as the plan was cut. */
export function buildCoverRoadmap(rows: DevMilestone[]): CoverRoadmapVM {
  const ordered = [...rows].sort((a, b) => a.order_index - b.order_index);
  const steps: CoverRoadmapStep[] = ordered.map((m) => ({
    id: m.id,
    name: m.name,
    status: (m.status === 'shipped' || m.status === 'active' ? m.status : 'planned') as CoverMilestoneStatus,
  }));
  const nextRow = ordered.find((m) => m.status === 'active') ?? ordered.find((m) => m.status !== 'shipped') ?? null;
  const velocity = deriveShipVelocity(rows);
  const f = velocity?.forecast;
  return {
    steps,
    shipped: steps.filter((s) => s.status === 'shipped').length,
    next: nextRow
      ? {
        name: nextRow.name,
        targetDate: nextRow.target_date,
        status: nextRow.status === 'active' ? 'active' : 'planned',
      }
      : null,
    forecast: f && nextRow && f.milestoneId === nextRow.id ? { date: f.date, late: f.late } : null,
  };
}

/** Pips beyond this collapse into a "+N" tail — the cover stays one line. */
const MAX_PIPS = 7;

const PIP_STYLE: Record<CoverMilestoneStatus, React.CSSProperties> = {
  shipped: { background: INK.emerald, boxShadow: `0 0 6px ${INK.emerald}66` },
  active: { background: INK.teal, boxShadow: `0 0 8px ${INK.teal}99`, outline: `2px solid ${INK.teal}44`, outlineOffset: 2 },
  planned: { background: 'rgba(148,163,184,.22)' },
};

export function CoverRoadmap({ roadmap, projectName, onOpenShip }: {
  roadmap: CoverRoadmapVM;
  projectName: string;
  /** Opens the project's L2 on the Ship tab. Absent → the strip is inert. */
  onOpenShip?: () => void;
}) {
  const { t, tx } = useTranslation();
  const shown = roadmap.steps.slice(0, MAX_PIPS);
  const overflow = roadmap.steps.length - shown.length;
  const empty = roadmap.steps.length === 0;

  const body = (
    <>
      <span className="flex items-center gap-2 min-w-0">
        <Flag className="w-5 h-5 shrink-0" style={{ color: empty ? INK.blue : INK.teal }} aria-hidden />
        {empty ? (
          <span className="typo-body-lg font-medium truncate" style={{ color: INK.blue }}>{t.ship.cover_empty}</span>
        ) : (
          <>
            <span className="flex items-center gap-1.5 shrink-0" aria-hidden>
              {shown.map((s) => (
                <span key={s.id} className="w-2.5 h-2.5 rounded-full" style={PIP_STYLE[s.status]} title={s.name} />
              ))}
              {overflow > 0 && (
                <span className="typo-body-lg font-medium text-foreground/70 leading-none">+{overflow}</span>
              )}
            </span>
            <span className="ml-auto shrink-0 typo-body-lg font-medium tabular-nums text-foreground/70">
              {tx(t.ship.cover_shipped_count, { shipped: roadmap.shipped, total: roadmap.steps.length })}
            </span>
          </>
        )}
        {onOpenShip && (
          <ChevronRight className="w-5 h-5 shrink-0 text-primary/60 opacity-0 group-hover/roadmap:opacity-100 transition-opacity" aria-hidden />
        )}
      </span>
      <span className="mt-1 flex items-baseline gap-1.5 min-w-0">
        <span className="typo-body-lg text-foreground/70 shrink-0">{t.ship.cover_next}</span>
        <span className="typo-body-lg font-medium truncate text-foreground">
          {roadmap.next ? roadmap.next.name : t.ship.cover_all_shipped}
        </span>
        {roadmap.next?.targetDate && (
          <span className="typo-body-lg tabular-nums text-foreground/70 shrink-0">{roadmap.next.targetDate}</span>
        )}
        {roadmap.next && roadmap.forecast && (
          <span
            className="typo-body-lg tabular-nums shrink-0"
            style={{ color: roadmap.forecast.late ? INK.amber : INK.teal }}
            data-testid="cover-roadmap-forecast"
          >
            {tx(t.ship.cover_forecast, { date: roadmap.forecast.date })}
          </span>
        )}
      </span>
    </>
  );

  const shared = 'mt-3 pt-2.5 border-t border-dashed border-foreground/10 min-w-0 flex flex-col text-left';

  if (!onOpenShip) {
    return <div className={shared} data-testid="cover-roadmap">{body}</div>;
  }
  return (
    <button
      type="button"
      onClick={onOpenShip}
      aria-label={tx(t.ship.cover_open_aria, { name: projectName })}
      title={tx(t.ship.cover_open_aria, { name: projectName })}
      className={`group/roadmap w-full rounded-card transition-colors hover:bg-primary/[0.05] focus-ring ${shared}`}
      data-testid="cover-roadmap"
    >
      {body}
    </button>
  );
}
