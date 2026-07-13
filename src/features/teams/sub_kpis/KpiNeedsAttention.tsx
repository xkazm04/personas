// KpiNeedsAttention — the dashboard's "needs attention" surface: one row PER
// PROJECT (only projects that actually have off-track KPIs), rendered as an
// incident list — a severity count plus a horizontal run of incident chips
// (category icon · value · off-track reason). Clicking a chip opens the KPI's
// full-screen detail modal.
import { useMemo } from 'react';
import { ShieldAlert } from 'lucide-react';

import type { DevKpi } from '@/lib/bindings/DevKpi';
import { useTranslation } from '@/i18n/useTranslation';
import { kpiOffTrackReason } from './kpiMath';
import { categoryMeta } from './kpiMeta';

interface StripProps {
  offTrack: DevKpi[];
  projectName: (id: string) => string;
  onOpen: (kpiId: string) => void;
}

export function KpiNeedsAttention(props: StripProps) {
  if (props.offTrack.length === 0) return null;
  return <TriageStrip {...props} />;
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
