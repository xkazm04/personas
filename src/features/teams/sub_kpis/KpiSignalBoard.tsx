// KpiSignalBoard — /prototype: combining the dashboard's "Needs attention" and
// "Distance to target" sections into one surface. Three variants behind a
// `variant` prop:
//   · 'separate' — baseline: the attention strip stacked above the distance
//                  chart (today's layout);
//   · 'unified'  — ONE pace board. Every KPI is a pace row grouped by context;
//                  off-track rows are flagged + pinned to the top of their
//                  group, so "needs attention" is emphasis inside the board
//                  rather than a separate strip;
//   · 'split'    — the attention list and the distance chart side by side in a
//                  two-pane grid, so triage and full-picture read together.
import { Gauge, ShieldAlert } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import type { DevKpi } from '@/lib/bindings/DevKpi';
import type { OffTrackReason } from './kpiMath';
import { DistanceBars, type DistanceGroup, type DistanceRow } from './kpiDistance';
import { KpiNeedsAttention } from './KpiNeedsAttention';

export type SignalVariant = 'separate' | 'unified' | 'split';

interface BoardProps {
  offTrack: DevKpi[];
  distanceGroups: DistanceGroup[];
  projectName: (id: string) => string;
  onOpen: (kpiId: string) => void;
}

export function KpiSignalBoard({ variant, ...props }: BoardProps & { variant: SignalVariant }) {
  if (variant === 'unified') return <UnifiedBoard {...props} />;
  if (variant === 'split') return <SplitBoard {...props} />;
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

// -- shared chrome -----------------------------------------------------------

function Panel({ title, icon: Icon, right, children }: { title: string; icon: typeof Gauge; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-primary/15 bg-secondary/10 p-4 [&_.recharts-wrapper]:outline-none [&_.recharts-surface]:outline-none [&_svg]:outline-none">
      <div className="flex items-center gap-1.5 mb-3">
        <Icon className="w-3.5 h-3.5 text-primary" aria-hidden />
        <h3 className="typo-overline text-foreground flex-1">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

/** The grouped distance chart body (recharts bars per context group). */
function DistanceChart({ distanceGroups, onOpen }: { distanceGroups: DistanceGroup[]; onOpen: (id: string) => void }) {
  return (
    <div className="space-y-4">
      {distanceGroups.map((g) => (
        <div key={g.key}>
          {distanceGroups.length > 1 && (
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

// -- separate (baseline: strip stacked above distance) -----------------------

function SeparateBoard({ offTrack, distanceGroups, projectName, onOpen }: BoardProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <KpiNeedsAttention offTrack={offTrack} projectName={projectName} onOpen={onOpen} />
      <Panel title={t.kpis.chart_distance_title} icon={Gauge}>
        <DistanceChart distanceGroups={distanceGroups} onOpen={onOpen} />
      </Panel>
    </div>
  );
}

// -- unified (one pace board, off-track pinned + flagged) --------------------

function PaceRow({ row, reasonLabel, onOpen }: { row: DistanceRow; reasonLabel: (r: OffTrackReason | null) => string | null; onOpen: (id: string) => void }) {
  const off = row.track === 'off-track';
  const reason = off ? reasonLabel(row.reason) : null;
  return (
    <button
      type="button"
      onClick={() => onOpen(row.id)}
      data-testid={`kpi-pace-${row.id}`}
      className={`w-full flex items-center gap-3 rounded-interactive px-2 py-1.5 text-left transition-colors ${
        off ? 'bg-status-error/8 hover:bg-status-error/15' : 'hover:bg-secondary/30'
      }`}
    >
      <span className="typo-caption text-foreground truncate flex-1 min-w-0">{row.name}</span>
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

function UnifiedBoard({ distanceGroups, onOpen }: BoardProps) {
  const { t, tx } = useTranslation();
  const reasonLabel = useReasonLabel();
  const offCount = distanceGroups.reduce((n, g) => n + g.rows.filter((r) => r.track === 'off-track').length, 0);

  return (
    <Panel
      title={t.kpis.chart_distance_title}
      icon={Gauge}
      right={
        offCount > 0 ? (
          <span className="typo-caption text-status-error tabular-nums">{tx(t.kpis.attn_off_count, { count: offCount })}</span>
        ) : undefined
      }
    >
      <div className="space-y-4" data-testid="kpi-signal-unified">
        {distanceGroups.map((g) => {
          // Off-track first (attention), then by name — the "needs attention"
          // emphasis, folded into the pace list.
          const rows = [...g.rows].sort(
            (a, b) => Number(b.track === 'off-track') - Number(a.track === 'off-track') || a.name.localeCompare(b.name),
          );
          const offInGroup = rows.filter((r) => r.track === 'off-track').length;
          return (
            <div key={g.key}>
              {distanceGroups.length > 1 && (
                <div className="flex items-center gap-2 mb-1">
                  <span className="typo-caption text-foreground font-medium truncate">{g.label}</span>
                  <span className="typo-caption text-foreground/70 tabular-nums">{rows.length}</span>
                  {offInGroup > 0 && (
                    <span className="typo-overline text-status-error">{tx(t.kpis.attn_off_count, { count: offInGroup })}</span>
                  )}
                </div>
              )}
              <div className="space-y-0.5">
                {rows.map((row) => (
                  <PaceRow key={row.id} row={row} reasonLabel={reasonLabel} onOpen={onOpen} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// -- split (attention + distance side by side) -------------------------------

function SplitBoard({ offTrack, distanceGroups, projectName, onOpen }: BoardProps) {
  const { t } = useTranslation();
  const hasAttention = offTrack.length > 0;

  if (!hasAttention) {
    return (
      <Panel title={t.kpis.chart_distance_title} icon={Gauge}>
        <DistanceChart distanceGroups={distanceGroups} onOpen={onOpen} />
      </Panel>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start" data-testid="kpi-signal-split">
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <ShieldAlert className="w-3.5 h-3.5 text-status-error" aria-hidden />
          <h3 className="typo-overline text-status-error">{t.kpis.attention_label}</h3>
        </div>
        <KpiNeedsAttention offTrack={offTrack} projectName={projectName} onOpen={onOpen} />
      </div>
      <Panel title={t.kpis.chart_distance_title} icon={Gauge}>
        <DistanceChart distanceGroups={distanceGroups} onOpen={onOpen} />
      </Panel>
    </div>
  );
}
