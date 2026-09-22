// SINCE THE LAST READING - the only part of the books that moved.
//
// It reads the append-only measurement log through `stateChanges`, which
// filters to PRODUCTION observations that were actually measured: a simulated
// or composed row never gets to speak for a state change. That filter is the
// defect the contest's blind judge found in the winning prototype, which let
// 39 simulation rows into a surface whose whole promise is honest measurement.
import { useMemo } from 'react';

import type { DevKpiMeasurement } from '@/lib/bindings/DevKpiMeasurement';
import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';

import type { Estate, EstateProject } from '../../estate/kpiEstate';
import { stateChanges, type StateChange } from '../AttentionLedger.model';
import type { LazyTrendsStatus } from '../../useKpiOverview';

const TRACK_TONE: Record<string, string> = {
  'off-track': 'var(--status-error)',
  'on-track': 'var(--primary)',
  met: 'var(--status-success)',
  unpaced: 'var(--status-warning)',
  unmeasured: 'var(--muted-foreground)',
};

export function BookChanges({
  estate,
  project,
  trends,
  status,
  onRetry,
  onOpen,
  limit = 8,
}: {
  estate: Estate;
  project: EstateProject | null;
  trends: Record<string, DevKpiMeasurement[]>;
  status: LazyTrendsStatus;
  onRetry: () => void;
  onOpen: (kpiId: string) => void;
  limit?: number;
}) {
  const { t, tx } = useTranslation();
  const o = t.kpis.overview;

  const changes = useMemo(() => {
    const scope = project ? [project] : estate.projects;
    return scope
      .flatMap((p) => stateChanges(p, trends, limit))
      .sort((a, b) => Number(b.to === 'off-track') - Number(a.to === 'off-track') || b.at - a.at)
      .slice(0, limit);
  }, [estate, project, trends, limit]);

  if (status === 'failed') {
    return (
      <div className="flex items-center gap-3">
        <p className="typo-caption text-foreground">{o.trends_failed}</p>
        <Button variant="ghost" size="sm" onClick={onRetry}>
          {o.retry}
        </Button>
      </div>
    );
  }

  return (
    <section className="space-y-1.5" data-testid="kpi-books-changes">
      <h3 className="typo-heading text-foreground">
        {changes.length > 0 ? tx(o.changes_count, { count: changes.length }) : o.changes_title}
      </h3>
      {changes.length === 0 ? (
        <p className="typo-caption text-foreground">
          {status === 'loading' ? o.changes_reading : o.changes_none}
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {changes.map((change) => (
            <li key={change.kpi.id}>
              <ChangeChip change={change} onOpen={() => onOpen(change.kpi.id)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ChangeChip({ change, onOpen }: { change: StateChange; onOpen: () => void }) {
  const { t, tx } = useTranslation();
  const o = t.kpis.overview;
  const label = (track: string) =>
    track === 'met'
      ? o.band_labels.met
      : track === 'on-track'
        ? o.count_on_track
        : track === 'off-track'
          ? o.count_off_track
          : track === 'unpaced'
            ? o.count_no_verdict
            : o.count_never_read;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex max-w-[22rem] items-baseline gap-2 rounded-interactive border border-card-border bg-secondary/15 px-2 py-1 text-left hover:bg-secondary/35 focus-ring"
    >
      <span className="min-w-0 flex-1 truncate typo-caption text-foreground">{change.kpi.name}</span>
      <span className="shrink-0 typo-caption" style={{ color: TRACK_TONE[change.to] }}>
        {tx(o.changes_from_to, { from: label(change.from), to: label(change.to) })}
      </span>
    </button>
  );
}
