// KpiNeedsAttention — the dashboard's "needs attention" surface. Prototype:
// three variants behind a `variant` prop. 'baseline' is the original flat
// cross-project chip strip; 'triage' and 'cockpit' both regroup into one row
// PER PROJECT (only projects that actually have off-track KPIs), with the KPIs
// laid out along the row. 'triage' reads as an incident list (severity pill +
// incident chips); 'cockpit' reads as an aligned mini-ledger.
import { useMemo } from 'react';
import { AlertTriangle, ShieldAlert } from 'lucide-react';

import type { DevKpi } from '@/lib/bindings/DevKpi';
import { useTranslation } from '@/i18n/useTranslation';
import { paceDescriptor, kpiOffTrackReason } from './kpiMath';
import { categoryMeta, TRACK_COLOR } from './kpiMeta';

export type NeedsAttentionVariant = 'baseline' | 'triage' | 'cockpit';

interface StripProps {
  offTrack: DevKpi[];
  projectName: (id: string) => string;
  onOpen: (kpiId: string) => void;
}

export function KpiNeedsAttention({ variant, ...props }: StripProps & { variant: NeedsAttentionVariant }) {
  if (props.offTrack.length === 0) return null;
  if (variant === 'triage') return <TriageStrip {...props} />;
  if (variant === 'cockpit') return <CockpitStrip {...props} />;
  return <BaselineStrip {...props} />;
}

// -- helpers -----------------------------------------------------------------

/** Group off-track KPIs by project (project name asc; KPIs by name asc). */
function useProjectGroups(offTrack: DevKpi[], projectName: (id: string) => string) {
  return useMemo(() => {
    const m = new Map<string, DevKpi[]>();
    for (const k of offTrack) {
      const arr = m.get(k.project_id);
      if (arr) arr.push(k);
      else m.set(k.project_id, [k]);
    }
    return [...m.entries()]
      .map(([id, kpis]) => ({ id, name: projectName(id), kpis: [...kpis].sort((a, b) => a.name.localeCompare(b.name)) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [offTrack, projectName]);
}

function useReasonLabels() {
  const { t } = useTranslation();
  return (kpi: DevKpi): string | null => {
    switch (kpiOffTrackReason(kpi)) {
      case 'floor': return t.kpis.attn_reason_floor;
      case 'crit': return t.kpis.attn_reason_crit;
      case 'pace': return t.kpis.attn_reason_pace;
      default: return null;
    }
  };
}

function DaysChip({ kpi }: { kpi: DevKpi }) {
  const { t, tx } = useTranslation();
  const d = paceDescriptor(kpi);
  if (d.daysLeft == null) return null;
  const overdue = d.daysLeft < 0;
  return (
    <span className={`typo-caption tabular-nums ${overdue ? 'text-status-error' : 'text-foreground/70'}`}>
      {overdue ? tx(t.kpis.attn_overdue, { days: Math.abs(d.daysLeft) }) : tx(t.kpis.attn_days_left, { days: d.daysLeft })}
    </span>
  );
}

// -- baseline (original flat strip) ------------------------------------------

function BaselineStrip({ offTrack, onOpen }: StripProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 flex-wrap rounded-card border border-status-error/30 bg-status-error/5 px-3 py-2.5">
      <AlertTriangle className="w-4 h-4 text-status-error flex-shrink-0" />
      <span className="typo-overline text-status-error">{t.kpis.attention_label}</span>
      {offTrack.map((kpi) => (
        <button
          key={kpi.id}
          type="button"
          onClick={() => onOpen(kpi.id)}
          className="typo-caption text-foreground rounded-interactive border border-status-error/40 bg-status-error/10 hover:bg-status-error/20 transition-colors px-2 py-0.5 tabular-nums"
          data-testid={`kpi-attention-${kpi.id}`}
        >
          <span className="font-medium">{kpi.name}</span>{' '}
          {kpi.current_value ?? '—'} / {kpi.target_value ?? '—'} {kpi.unit}
        </button>
      ))}
    </div>
  );
}

// -- triage (incident list, one project per row) -----------------------------

function TriageStrip({ offTrack, projectName, onOpen }: StripProps) {
  const { t, tx } = useTranslation();
  const groups = useProjectGroups(offTrack, projectName);
  const reasonLabel = useReasonLabels();

  return (
    <div className="rounded-card border border-status-error/30 bg-status-error/5 overflow-hidden" data-testid="kpi-attention-triage">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-status-error/20">
        <ShieldAlert className="w-4 h-4 text-status-error flex-shrink-0" />
        <span className="typo-overline text-status-error">{t.kpis.attention_label}</span>
      </div>
      <div className="divide-y divide-status-error/10">
        {groups.map((g) => (
          <div key={g.id} className="flex items-start gap-3 px-3 py-2.5">
            <div className="flex-shrink-0 w-40 min-w-0">
              <p className="typo-body text-foreground font-medium truncate">{g.name}</p>
              <p className="typo-caption text-status-error tabular-nums">
                {tx(t.kpis.attn_off_count, { count: g.kpis.length })}
              </p>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap flex-1">
              {g.kpis.map((kpi) => {
                const CatIcon = categoryMeta(kpi.category).icon;
                const reason = reasonLabel(kpi);
                return (
                  <button
                    key={kpi.id}
                    type="button"
                    onClick={() => onOpen(kpi.id)}
                    data-testid={`kpi-attention-${kpi.id}`}
                    className="group inline-flex items-center gap-1.5 rounded-interactive border border-status-error/40 bg-status-error/10 hover:bg-status-error/20 transition-colors px-2 py-1"
                  >
                    <CatIcon className="w-3.5 h-3.5 text-status-error flex-shrink-0" aria-hidden />
                    <span className="typo-caption text-foreground font-medium">{kpi.name}</span>
                    <span className="typo-caption text-foreground/80 tabular-nums">
                      {kpi.current_value ?? '—'}/{kpi.target_value ?? '—'} {kpi.unit}
                    </span>
                    {reason && (
                      <span className="typo-overline text-status-error border-l border-status-error/30 pl-1.5">
                        {reason}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// -- cockpit (aligned mini-ledger, one project per row) ----------------------

function CockpitStrip({ offTrack, projectName, onOpen }: StripProps) {
  const { t, tx } = useTranslation();
  const groups = useProjectGroups(offTrack, projectName);
  const reasonLabel = useReasonLabels();

  return (
    <div className="rounded-card border border-status-error/30 bg-status-error/5 overflow-hidden" data-testid="kpi-attention-cockpit">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-status-error/20">
        <ShieldAlert className="w-4 h-4 text-status-error flex-shrink-0" />
        <span className="typo-overline text-status-error">{t.kpis.attention_label}</span>
      </div>
      <div className="divide-y divide-status-error/10">
        {groups.map((g) => (
          <div key={g.id} className="px-3 py-2">
            <div className="flex items-center gap-2 mb-1">
              <span className="typo-caption text-foreground font-semibold truncate">{g.name}</span>
              <span className="typo-caption text-status-error tabular-nums">
                {tx(t.kpis.attn_off_count, { count: g.kpis.length })}
              </span>
            </div>
            <div className="space-y-0.5">
              {g.kpis.map((kpi) => {
                const d = paceDescriptor(kpi);
                const reason = reasonLabel(kpi);
                return (
                  <button
                    key={kpi.id}
                    type="button"
                    onClick={() => onOpen(kpi.id)}
                    data-testid={`kpi-attention-${kpi.id}`}
                    className="w-full flex items-center gap-3 rounded-interactive hover:bg-status-error/10 transition-colors px-2 py-1 text-left"
                  >
                    <span className="typo-caption text-foreground truncate flex-1 min-w-0">{kpi.name}</span>
                    <span className="hidden sm:block w-24 h-1.5 rounded-full bg-primary/10 overflow-hidden flex-shrink-0">
                      <span
                        className="block h-full rounded-full"
                        style={{ width: `${d.progressPct ?? 0}%`, background: TRACK_COLOR['off-track'] }}
                      />
                    </span>
                    <span className="typo-caption text-foreground tabular-nums w-24 text-right flex-shrink-0">
                      {kpi.current_value ?? '—'}/{kpi.target_value ?? '—'} {kpi.unit}
                    </span>
                    <span className="w-20 text-right flex-shrink-0"><DaysChip kpi={kpi} /></span>
                    {reason && (
                      <span className="typo-overline text-status-error w-24 text-right flex-shrink-0">{reason}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
