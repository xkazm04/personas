/**
 * The MINI RAIL: what the portfolio collapses into once a project is open.
 * One compact line - the Back control, then every project as a chip carrying
 * its name and a tiny proportional strip of its goals' status colours - so the
 * operator can switch project without climbing back to L0.
 */
import { ArrowLeft } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { DevGoal } from '@/lib/bindings/DevGoal';

import { GOAL_STATUSES, goalStatusLabel, goalStatusMeta, normalizeGoalStatus } from '../../../goalStatus';
import { useProgressView } from '../../canvasHost';
import type { LayerNav } from '../useLayers';

export function TrackRail({ nav }: { nav: LayerNav }) {
  const { tx } = useTranslation();
  const { model, dl } = useProgressView();

  return (
    <nav
      aria-label={dl.layers_projects}
      data-testid="layers-track-rail"
      className="flex items-center gap-2 px-3 py-2 border-b border-primary/10 bg-secondary/20"
    >
      <Button
        variant="ghost"
        size="sm"
        icon={<ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />}
        onClick={nav.back}
        data-testid="layers-track-back"
        className="shrink-0"
      >
        {dl.layers_back}
      </Button>
      <span aria-hidden="true" className="h-5 w-px bg-primary/15 shrink-0" />
      <ul className="flex items-center gap-1.5 overflow-x-auto min-w-0 py-0.5">
        {model.rows.map((row) => {
          const current = row.projectId === nav.projectId;
          return (
            <li key={row.projectId} className="shrink-0">
              <Tooltip content={tx(dl.layers_open_project, { project: row.name })}>
                <Button
                  variant={current ? 'secondary' : 'ghost'}
                  size="sm"
                  aria-current={current ? 'true' : undefined}
                  onClick={() => nav.openProject(row.projectId)}
                  data-testid={`layers-track-rail-${row.projectId}`}
                  className={`rounded-full ${current ? 'border-primary/40 bg-primary/10' : ''}`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className={`typo-body truncate max-w-[10rem] ${current ? 'text-primary' : 'text-foreground'}`}>
                      {row.name}
                    </span>
                    <GoalStrip goals={row.goals} />
                  </span>
                </Button>
              </Tooltip>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** A 44px bar split by status in the canonical status order. */
function GoalStrip({ goals }: { goals: readonly DevGoal[] }) {
  const { dl } = useProgressView();
  if (goals.length === 0) return null;
  const counts = new Map<string, number>();
  for (const g of goals) {
    const s = normalizeGoalStatus(g.status);
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const label = GOAL_STATUSES.filter((s) => counts.has(s))
    .map((s) => `${goalStatusLabel(dl, s)} ${counts.get(s)}`)
    .join(', ');
  return (
    <span role="img" aria-label={label} className="flex h-1.5 w-11 shrink-0 overflow-hidden rounded-full bg-primary/10">
      {GOAL_STATUSES.filter((s) => counts.has(s)).map((s) => (
        <span key={s} style={{ flexGrow: counts.get(s), background: goalStatusMeta(s).map.fill }} />
      ))}
    </span>
  );
}
