/**
 * GoalKpiLink — the goal ↔ KPI cross-reference shown at the top of the goal
 * detail drawer when a goal carries a `kpi_id` (the outcome layer it serves,
 * P4 derivation). Read-only projection: it reads the KPI and renders current
 * vs target plus the shared plain-language pace state (`paceSentence`), so a
 * non-technical user can see WHY an autonomously-derived goal exists and what
 * moving the needle will accomplish — without leaving the goal.
 *
 * Honesty: the subtitle states the system's own rule — a goal finishing is not
 * success; the next measurement decides — which is exactly why this panel shows
 * the KPI, not just the goal.
 *
 * Stays silent if the KPI was archived/removed (the soft `kpi_id` link can
 * dangle): a missing KPI renders nothing rather than an error box.
 */
import { useEffect, useState } from 'react';
import { Gauge, ArrowRight } from 'lucide-react';

import { getKpi } from '@/api/devTools/kpis';
import type { DevKpi } from '@/lib/bindings/DevKpi';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';

import { kpiTrack } from '../sub_kpis/kpiMath';
import { paceSentence, categoryMeta, TRACK_COLOR } from '../sub_kpis/kpiMeta';

/** Format a value with its unit: word-units get a space ("0 errors"), "%" doesn't. */
function fmt(v: number | null, unit: string): string {
  const num = v ?? '—';
  return unit && unit !== '%' ? `${num} ${unit}` : `${num}${unit}`;
}

export function GoalKpiLink({ kpiId }: { kpiId: string }) {
  const { t, tx } = useTranslation();
  const [kpi, setKpi] = useState<DevKpi | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setKpi(null);
    setMissing(false);
    getKpi(kpiId)
      .then((k) => { if (!cancelled) setKpi(k); })
      .catch((e) => { silentCatch('GoalKpiLink.getKpi')(e); if (!cancelled) setMissing(true); });
    return () => { cancelled = true; };
  }, [kpiId]);

  if (missing || !kpi) return null;

  const color = TRACK_COLOR[kpiTrack(kpi)];
  const cat = categoryMeta(kpi.category);
  const CatIcon = cat.icon;
  const unit = kpi.unit || '';

  return (
    <div
      className="mb-4 rounded-card border px-3.5 py-3"
      style={{
        borderColor: `color-mix(in srgb, ${color} 35%, transparent)`,
        background: `color-mix(in srgb, ${color} 7%, transparent)`,
      }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <Gauge className="w-4 h-4 shrink-0" style={{ color }} />
        <span className="typo-caption uppercase tracking-[0.18em] text-foreground">{t.kpis.goal_link_title}</span>
        <span className="ml-auto inline-flex items-center gap-1 typo-caption text-foreground/70">
          <CatIcon className="w-3 h-3" /> {cat.label(t)}
        </span>
      </div>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="typo-body font-semibold text-foreground">{kpi.name}</span>
        <span className="inline-flex items-center gap-1 typo-caption tabular-nums" style={{ color }}>
          {fmt(kpi.current_value, unit)}
          <ArrowRight className="w-3 h-3 opacity-60" />
          {fmt(kpi.target_value, unit)}
        </span>
      </div>
      <p className="typo-caption text-foreground/80 mt-1">{paceSentence(kpi, t, tx)}</p>
      <p className="typo-caption text-foreground/55 mt-1.5">{t.kpis.goal_link_subtitle}</p>
    </div>
  );
}
