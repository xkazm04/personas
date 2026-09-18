// The ONE ranked next move for a project (registry: single-ranked-next-move).
// One row, not a list: the KPI, which cell it lives in, WHY it is off-track,
// the plain-language pace sentence, and its trend on the shared axis. When
// nothing is off-track the block says so rather than disappearing.
import type { DevKpiMeasurement } from '@/lib/bindings/DevKpiMeasurement';

import { useTranslation } from '@/i18n/useTranslation';
import { kpiOffTrackReason } from '../kpiMath';
import { paceSentence, TRACK_COLOR } from '../kpiMeta';
import { rankNextMove, type KpiProjectRollup } from '../kpiOverviewModel';
import type { TimeWindow } from '../kpiSample';
import { sparkValues } from './AttentionLedger.model';
import { LedgerSpark } from './AttentionLedgerSpark';

export function LedgerNextMove({
  project,
  trends,
  window,
  sparkGhost,
  onOpen,
}: {
  project: KpiProjectRollup;
  trends: Record<string, DevKpiMeasurement[]>;
  window: TimeWindow | null;
  sparkGhost: boolean;
  onOpen: (kpiId: string) => void;
}) {
  const { t, tx } = useTranslation();
  const o = t.kpis.overview;
  const kpi = rankNextMove(project);

  return (
    <section className="space-y-1.5">
      {/* muted-ok: structural block label, not body copy */}
      <h4 className="typo-label text-muted-foreground">{o.next_move_title}</h4>
      {!kpi ? (
        <p className="typo-caption text-foreground">{o.next_move_none}</p>
      ) : (
        <div
          className="flex items-center gap-3 pl-3"
          style={{ borderLeft: `3px solid ${TRACK_COLOR['off-track']}` }}
        >
          <div className="min-w-0 flex-1">
            <button
              type="button"
              className="typo-body text-foreground text-left hover:text-primary focus-ring rounded-interactive"
              aria-label={kpi.name}
              onClick={() => onOpen(kpi.id)}
            >
              {kpi.name}
            </button>
            {/* muted-ok: structural locator — which cell the KPI sits in + its trigger */}
            <p className="typo-caption text-muted-foreground truncate">
              {groupLabel(project, kpi.id)}
              {' · '}
              {reasonText(kpiOffTrackReason(kpi), o)}
            </p>
            <p className="typo-caption text-foreground">{paceSentence(kpi, t, tx)}</p>
          </div>
          <LedgerSpark
            values={sparkValues(kpi, trends[kpi.id], window)}
            color={TRACK_COLOR['off-track']}
            ghost={sparkGhost}
          />
        </div>
      )}
    </section>
  );
}

/** The cell this KPI sits in — the ledger names it so the brief is actionable
 *  without opening the project first. */
export function groupLabel(project: KpiProjectRollup, kpiId: string): string {
  return project.groups.find((g) => g.kpis.some((k) => k.id === kpiId))?.label ?? '—';
}

type OverviewStrings = { next_move_reason_floor: string; next_move_reason_crit: string; next_move_reason_pace: string };

function reasonText(reason: 'floor' | 'crit' | 'pace' | null, o: OverviewStrings): string {
  if (reason === 'floor') return o.next_move_reason_floor;
  if (reason === 'crit') return o.next_move_reason_crit;
  return o.next_move_reason_pace;
}
