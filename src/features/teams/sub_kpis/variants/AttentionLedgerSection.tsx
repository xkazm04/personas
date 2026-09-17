// One project's brief: who it is, what it is made of (with the denominator
// printed), the single next move, and what changed. No map, no grid — the
// section is read top to bottom like a paragraph.
import type { DevKpiMeasurement } from '@/lib/bindings/DevKpiMeasurement';

import { useTranslation } from '@/i18n/useTranslation';
import type { KpiFocus, KpiProjectRollup } from '../kpiOverviewModel';
import type { TimeWindow } from '../kpiSample';
import { LedgerChanges } from './AttentionLedgerChanges';
import { LedgerNextMove } from './AttentionLedgerNextMove';

export function LedgerSection({
  project,
  trends,
  window,
  sparkGhost,
  onFocus,
  onOpen,
}: {
  project: KpiProjectRollup;
  trends: Record<string, DevKpiMeasurement[]>;
  window: TimeWindow | null;
  sparkGhost: boolean;
  onFocus: (focus: KpiFocus) => void;
  onOpen: (kpiId: string) => void;
}) {
  const { t, tx } = useTranslation();
  const o = t.kpis.overview;

  return (
    <section
      className="rounded-card border border-primary/15 bg-secondary/10 p-4 space-y-3"
      data-testid={`kpi-ledger-section-${project.projectId}`}
    >
      <header className="space-y-0.5">
        <button
          type="button"
          className="typo-title text-foreground text-left hover:text-primary focus-ring rounded-interactive"
          aria-label={tx(o.lane_open, { project: project.label })}
          onClick={() => onFocus({ projectId: project.projectId, groupId: null })}
        >
          {project.label}
        </button>
        {/* muted-ok: structural counters + denominator, not prose */}
        <p className="typo-caption text-muted-foreground">
          {tx(o.rest_counts, {
            count: project.total,
            met: project.met,
            onTrack: project.onTrack,
            unmeasured: project.total - project.measured,
          })}
          {' · '}
          {tx(o.measured_of, { measured: project.measured, total: project.total })}
        </p>
        {project.groupsUnknown && (
          <p className="typo-caption text-foreground">{o.groups_unknown}</p>
        )}
      </header>
      <LedgerNextMove
        project={project}
        trends={trends}
        window={window}
        sparkGhost={sparkGhost}
        onOpen={onOpen}
      />
      <LedgerChanges
        project={project}
        trends={trends}
        window={window}
        sparkGhost={sparkGhost}
        onOpen={onOpen}
      />
    </section>
  );
}
