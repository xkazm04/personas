// KpiSignalBoard — the dashboard's combined signal surface: "Distance to
// target" grouped BY PROJECT, with the off-track error alerts injected inside
// each project's own card.
//
// One card per project: an alert BAND at the head of the card (that project's
// off-track KPIs as incident chips — category icon, value, off-track reason)
// with the project's full distance bars underneath. A healthy project renders
// as a plain card with no red at all. Everything clicks through to the KPI's
// detail modal.
//
// This replaces both the standalone "Needs attention" strip and the separate
// context-grouped distance chart — the alerts and the measurement now read
// together, per project.
import { FolderKanban, ShieldAlert } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import type { OffTrackReason } from './kpiMath';
import { categoryMeta } from './kpiMeta';
import { DistanceBars, type DistanceGroup, type DistanceRow } from './kpiDistance';

const isOff = (r: DistanceRow) => r.track === 'off-track';

export function KpiSignalBoard({
  projectGroups,
  onOpen,
}: {
  projectGroups: DistanceGroup[];
  onOpen: (kpiId: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4" data-testid="kpi-signal-board">
      {projectGroups.map((g) => {
        const off = g.rows.filter(isOff);
        return (
          <section
            key={g.key}
            className="rounded-card border border-primary/15 bg-secondary/10 p-4 [&_.recharts-wrapper]:outline-none [&_.recharts-surface]:outline-none [&_svg]:outline-none"
          >
            <div className="flex items-center gap-1.5 mb-3">
              <FolderKanban className="w-3.5 h-3.5 text-primary" aria-hidden />
              <h3 className="typo-overline text-foreground flex-1 truncate">{g.label}</h3>
              <OffCount n={off.length} />
              <span className="typo-caption text-foreground/70 tabular-nums">{g.rows.length}</span>
            </div>

            {/* The error alerts, injected at the head of the project's card. */}
            {off.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap rounded-card border border-status-error/30 bg-status-error/5 px-2.5 py-2 mb-3">
                <ShieldAlert className="w-4 h-4 text-status-error flex-shrink-0" aria-hidden />
                <span className="typo-overline text-status-error mr-1">{t.kpis.attention_label}</span>
                {off.map((row) => (
                  <IncidentChip key={row.id} row={row} onOpen={onOpen} />
                ))}
              </div>
            )}

            <DistanceBars rows={g.rows} onOpen={onOpen} />
          </section>
        );
      })}
    </div>
  );
}

/** "3 off track" — the per-project severity count, or nothing when healthy. */
function OffCount({ n }: { n: number }) {
  const { t, tx } = useTranslation();
  if (n === 0) return null;
  return <span className="typo-caption text-status-error tabular-nums">{tx(t.kpis.attn_off_count, { count: n })}</span>;
}

function useReasonLabel() {
  const { t } = useTranslation();
  return (reason: OffTrackReason | null): string | null => {
    switch (reason) {
      case 'floor': return t.kpis.attn_reason_floor;
      case 'crit': return t.kpis.attn_reason_crit;
      case 'pace': return t.kpis.attn_reason_pace;
      default: return null;
    }
  };
}

/** One off-track KPI in a project's alert band. */
function IncidentChip({ row, onOpen }: { row: DistanceRow; onOpen: (id: string) => void }) {
  const reasonLabel = useReasonLabel();
  const CatIcon = categoryMeta(row.category).icon;
  const reason = reasonLabel(row.reason);
  return (
    <button
      type="button"
      onClick={() => onOpen(row.id)}
      data-testid={`kpi-attention-${row.id}`}
      className="inline-flex items-center gap-1.5 rounded-interactive border border-status-error/40 bg-status-error/10 hover:bg-status-error/20 transition-colors px-2 py-1"
    >
      <CatIcon className="w-3.5 h-3.5 text-status-error flex-shrink-0" aria-hidden />
      <span className="typo-caption text-foreground font-medium">{row.name}</span>
      <span className="typo-caption text-foreground/80 tabular-nums">
        {row.current ?? '—'}/{row.target ?? '—'} {row.unit}
      </span>
      {reason && (
        <span className="typo-overline text-status-error border-l border-status-error/30 pl-1.5">{reason}</span>
      )}
    </button>
  );
}
