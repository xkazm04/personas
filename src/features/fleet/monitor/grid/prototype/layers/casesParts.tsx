// The parts CASES is drawn from: the fleet tally, and the grid that is layer
// 1's body. The project CARD itself lives in `casesCards` — it is a figure,
// drawn three ways, and the grid takes whichever one is being shown.

import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Button } from '@/features/shared/components/buttons';
import { SQUARE_STATE_ORDER, SQUARE_VISUAL, type SquareState } from '../../fleetGridModel';
import type { ProjectUnit } from './useFleetLayers';
import type { FollowUpKind, ProjectCardComponent } from './casesCards';

/** Layer 1's body. The grid keeps a stable order (the model sorts once), so a
 *  project stays where the operator last found it. */
export function CaseGrid({
  units, onOpen, onResolve, Card,
}: {
  units: readonly ProjectUnit[];
  onOpen: (projectId: string) => void;
  onResolve: (unit: ProjectUnit, kind: FollowUpKind) => void;
  Card: ProjectCardComponent;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="pc-grid"
      role="list"
      aria-label={t.monitor.conv_projects}
    >
      {units.map((u) => (
        <div role="listitem" key={u.projectId} className="contents">
          <Card unit={u} onOpen={onOpen} onResolve={onResolve} />
        </div>
      ))}
    </div>
  );
}

/** The state key as count pills — the same four states, colours and filter
 *  behaviour the production header gives the board, so this surface never
 *  invents a second vocabulary for the same facts. */
export function FleetTally({
  totals, active, onPick,
}: {
  totals: Record<SquareState, number>;
  active: SquareState | null;
  onPick: (s: SquareState) => void;
}) {
  const { t, tx } = useTranslation();
  const labels: Record<SquareState, string> = {
    running: t.monitor.grid_state_running,
    attention: t.monitor.grid_state_attention,
    failed: t.monitor.grid_state_failed,
    idle: t.monitor.grid_state_idle,
  };
  return (
    <div className="flex flex-shrink-0 items-center gap-1.5" data-testid="layers-tally">
      {SQUARE_STATE_ORDER.map((s) => (
        <Button
          key={s}
          variant="ghost"
          size="xs"
          onClick={() => onPick(s)}
          aria-pressed={active === s}
          aria-label={tx(t.monitor.grid_filter_state_aria, { state: labels[s] })}
          data-testid={`layers-tally-${s}`}
          className={`rounded-full border px-2 py-0.5 ${
            active === s ? 'border-primary/60 bg-primary/15' : 'border-border bg-secondary/20 hover:border-primary/30'
          }`}
        >
          <span className="flex items-center gap-1.5 typo-caption text-foreground">
            <span className={`h-2 w-2 flex-shrink-0 rounded-full ${SQUARE_VISUAL[s].accent} ${SQUARE_VISUAL[s].pulse ? 'animate-pulse' : ''}`} />
            <span>{labels[s]}</span>
            <span className="tabular-nums"><Numeric value={totals[s]} /></span>
          </span>
        </Button>
      ))}
    </div>
  );
}
