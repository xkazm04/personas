// Per-context KPI health — the signal the group-row variants colour by.
//
// A context can carry several KPIs, so a single tint has to summarise them. The
// rule is worst-wins (one off-track KPI is the thing you need to see, however
// many others are met), and — importantly — "no KPIs" and "KPIs but no readings
// yet" both resolve to NEUTRAL. Colouring an unmeasured context green would be
// a lie, and colouring it red would be a false alarm; neither is a state the
// user can act on, so neither earns a colour.
import { kpiTrack } from '@/features/teams/sub_kpis/kpiMath';
import type { DevKpi } from '@/lib/bindings/DevKpi';

/** Worst-wins rollup of a context's KPIs. `none` = no KPIs at all; `unmeasured`
 *  = it has KPIs but none has a reading. Both render neutral. */
export type ContextKpiStatus = 'none' | 'unmeasured' | 'off-track' | 'on-track' | 'met';

/** Tailwind classes per status: a tinted surface + a matching border. Neutral
 *  states get the plain card treatment so the coloured ones actually pop. */
export const KPI_STATUS_SURFACE: Record<ContextKpiStatus, string> = {
  'off-track': 'bg-red-500/10 border-red-500/30 hover:border-red-500/50',
  'on-track': 'bg-primary/10 border-primary/25 hover:border-primary/45',
  met: 'bg-emerald-500/10 border-emerald-500/30 hover:border-emerald-500/50',
  unmeasured: 'bg-card/40 border-primary/10 hover:border-primary/30',
  none: 'bg-card/40 border-primary/10 hover:border-primary/30',
};

/** A small dot for legends / tile corners. Neutral statuses stay muted. */
export const KPI_STATUS_DOT: Record<ContextKpiStatus, string> = {
  'off-track': 'bg-red-400',
  'on-track': 'bg-primary',
  met: 'bg-emerald-400',
  unmeasured: 'bg-foreground/25',
  none: 'bg-foreground/15',
};

/** i18n key for the status label, so the variants stay translatable. */
export const KPI_STATUS_LABEL_KEY: Record<
  ContextKpiStatus,
  'ctx_kpi_off_track' | 'ctx_kpi_on_track' | 'ctx_kpi_met' | 'ctx_kpi_unmeasured' | 'ctx_kpi_none'
> = {
  'off-track': 'ctx_kpi_off_track',
  'on-track': 'ctx_kpi_on_track',
  met: 'ctx_kpi_met',
  unmeasured: 'ctx_kpi_unmeasured',
  none: 'ctx_kpi_none',
};

/** True when the status carries no actionable signal — used to decide whether a
 *  tile earns a colour at all. */
export function isNeutral(status: ContextKpiStatus): boolean {
  return status === 'none' || status === 'unmeasured';
}

/** Roll one context's KPIs up into a single status. */
export function rollupContextKpis(kpis: DevKpi[]): ContextKpiStatus {
  if (kpis.length === 0) return 'none';

  let sawMeasured = false;
  let sawOnTrack = false;
  let sawMet = false;

  for (const k of kpis) {
    const track = kpiTrack(k);
    if (track === 'unmeasured') continue;
    sawMeasured = true;
    // Worst wins — a single off-track KPI decides the context.
    if (track === 'off-track') return 'off-track';
    if (track === 'on-track') sawOnTrack = true;
    if (track === 'met') sawMet = true;
  }

  if (!sawMeasured) return 'unmeasured';
  if (sawOnTrack) return 'on-track';
  return sawMet ? 'met' : 'unmeasured';
}

/** contextId → status, over a project's non-archived KPIs. */
export function buildKpiStatusByContext(kpis: DevKpi[]): Map<string, ContextKpiStatus> {
  const byContext = new Map<string, DevKpi[]>();
  for (const k of kpis) {
    if (k.status === 'archived' || !k.context_id) continue;
    const list = byContext.get(k.context_id);
    if (list) list.push(k);
    else byContext.set(k.context_id, [k]);
  }
  const out = new Map<string, ContextKpiStatus>();
  for (const [cid, list] of byContext) out.set(cid, rollupContextKpis(list));
  return out;
}
