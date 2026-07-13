// KpiSignalBoard — /prototype: enriching "Distance to target" by grouping it
// BY PROJECT and injecting the off-track error alerts inside each project's
// group. Three variants behind a `variant` prop:
//   · 'separate' — baseline: attention strip stacked above a context-grouped
//                  distance chart (today's layout, kept for A/B);
//   · 'dossier'  — one card per project. An alert BAND is injected at the head
//                  of the card (that project's off-track KPIs as incident
//                  chips), with the project's full distance bars underneath;
//   · 'inline'   — one card per project, rendered as pace rows. Off-track KPIs
//                  are injected IN PLACE as expanded alert rows (reason + value
//                  + bar), pinned above the healthy rows. The alert *is* the row.
import { FolderKanban, Gauge, ShieldAlert } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import type { DevKpi } from '@/lib/bindings/DevKpi';
import type { OffTrackReason } from './kpiMath';
import { categoryMeta } from './kpiMeta';
import { DistanceBars, type DistanceGroup, type DistanceRow } from './kpiDistance';
import { KpiNeedsAttention } from './KpiNeedsAttention';

export type SignalVariant = 'separate' | 'dossier' | 'inline';

interface BoardProps {
  offTrack: DevKpi[];
  /** Distance rows grouped by context — the baseline's grouping. */
  distanceGroups: DistanceGroup[];
  /** Distance rows grouped by project — the enriched grouping. */
  projectGroups: DistanceGroup[];
  projectName: (id: string) => string;
  onOpen: (kpiId: string) => void;
}

export function KpiSignalBoard({ variant, ...props }: BoardProps & { variant: SignalVariant }) {
  if (variant === 'dossier') return <DossierBoard {...props} />;
  if (variant === 'inline') return <InlineBoard {...props} />;
  return <SeparateBoard {...props} />;
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

const isOff = (r: DistanceRow) => r.track === 'off-track';

// -- shared chrome -----------------------------------------------------------

function Panel({ title, icon: Icon, right, children }: { title: string; icon: typeof Gauge; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-primary/15 bg-secondary/10 p-4 [&_.recharts-wrapper]:outline-none [&_.recharts-surface]:outline-none [&_svg]:outline-none">
      <div className="flex items-center gap-1.5 mb-3">
        <Icon className="w-3.5 h-3.5 text-primary" aria-hidden />
        <h3 className="typo-overline text-foreground flex-1 truncate">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

/** The grouped distance chart body (recharts bars per group). */
function DistanceChart({ groups, onOpen }: { groups: DistanceGroup[]; onOpen: (id: string) => void }) {
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g.key}>
          {groups.length > 1 && (
            <div className="flex items-center gap-2 mb-1.5">
              <span className="typo-caption text-foreground font-medium truncate">{g.label}</span>
              <span className="typo-caption text-foreground tabular-nums">{g.rows.length}</span>
            </div>
          )}
          <DistanceBars rows={g.rows} onOpen={onOpen} />
        </div>
      ))}
    </div>
  );
}

/** "3 off track" — the per-project severity count, or nothing when healthy. */
function OffCount({ n }: { n: number }) {
  const { t, tx } = useTranslation();
  if (n === 0) return null;
  return <span className="typo-caption text-status-error tabular-nums">{tx(t.kpis.attn_off_count, { count: n })}</span>;
}

// -- separate (baseline: strip stacked above context-grouped distance) -------

function SeparateBoard({ offTrack, distanceGroups, projectName, onOpen }: BoardProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <KpiNeedsAttention offTrack={offTrack} projectName={projectName} onOpen={onOpen} />
      <Panel title={t.kpis.chart_distance_title} icon={Gauge}>
        <DistanceChart groups={distanceGroups} onOpen={onOpen} />
      </Panel>
    </div>
  );
}

// -- dossier (project card; alert band injected at the head) -----------------

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

function DossierBoard({ projectGroups, onOpen }: BoardProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4" data-testid="kpi-signal-dossier">
      {projectGroups.map((g) => {
        const off = g.rows.filter(isOff);
        return (
          <Panel
            key={g.key}
            title={g.label}
            icon={FolderKanban}
            right={
              <div className="flex items-center gap-2">
                <OffCount n={off.length} />
                <span className="typo-caption text-foreground/70 tabular-nums">{g.rows.length}</span>
              </div>
            }
          >
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
          </Panel>
        );
      })}
    </div>
  );
}

// -- inline (project card; off-track injected in place as alert rows) --------

function PaceRow({ row, onOpen }: { row: DistanceRow; onOpen: (id: string) => void }) {
  const reasonLabel = useReasonLabel();
  const off = isOff(row);
  const CatIcon = categoryMeta(row.category).icon;
  const reason = off ? reasonLabel(row.reason) : null;

  return (
    <button
      type="button"
      onClick={() => onOpen(row.id)}
      data-testid={off ? `kpi-attention-${row.id}` : `kpi-pace-${row.id}`}
      className={`w-full flex items-center gap-3 px-2.5 py-2 text-left transition-colors ${
        off
          ? 'rounded-card border border-status-error/35 bg-status-error/8 hover:bg-status-error/15'
          : 'rounded-interactive hover:bg-secondary/30'
      }`}
    >
      <CatIcon
        className={`w-3.5 h-3.5 flex-shrink-0 ${off ? 'text-status-error' : 'text-foreground/50'}`}
        aria-hidden
      />
      <span className={`typo-caption truncate flex-1 min-w-0 ${off ? 'text-foreground font-medium' : 'text-foreground'}`}>
        {row.name}
      </span>
      <span className="hidden sm:block w-32 h-1.5 rounded-full bg-primary/10 overflow-hidden flex-shrink-0">
        <span className="block h-full rounded-full" style={{ width: `${Math.min(100, row.pct)}%`, background: row.fill }} />
      </span>
      <span className="typo-caption text-foreground tabular-nums w-12 text-right flex-shrink-0">{row.pct}%</span>
      <span className="typo-caption text-foreground/80 tabular-nums w-24 text-right flex-shrink-0 hidden md:block">
        {row.current ?? '—'}/{row.target ?? '—'} {row.unit}
      </span>
      <span className="w-16 text-right flex-shrink-0">
        {reason && <span className="typo-overline text-status-error">{reason}</span>}
      </span>
    </button>
  );
}

function InlineBoard({ projectGroups, onOpen }: BoardProps) {
  return (
    <div className="space-y-4" data-testid="kpi-signal-inline">
      {projectGroups.map((g) => {
        // Off-track injected in place, pinned above the healthy rows.
        const rows = [...g.rows].sort(
          (a, b) => Number(isOff(b)) - Number(isOff(a)) || a.name.localeCompare(b.name),
        );
        const off = rows.filter(isOff);
        return (
          <Panel
            key={g.key}
            title={g.label}
            icon={FolderKanban}
            right={
              <div className="flex items-center gap-2">
                <OffCount n={off.length} />
                <span className="typo-caption text-foreground/70 tabular-nums">{rows.length}</span>
              </div>
            }
          >
            <div className="space-y-1">
              {rows.map((row) => (
                <PaceRow key={row.id} row={row} onOpen={onOpen} />
              ))}
            </div>
          </Panel>
        );
      })}
    </div>
  );
}
