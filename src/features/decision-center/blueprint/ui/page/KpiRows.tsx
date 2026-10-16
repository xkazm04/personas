// The KPIs a lens is bound to on this feature (bp page/bits.tsx KpiRows): name, scope hint, health from the
// thresholds and status; the current value (counting); when it was measured, the baseline, target, watch and bad
// thresholds and which way is better. Hidden when no KPI applies; not shown for a past date (KPIs keep no history).
import { useMemo } from 'react';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useSheet } from '../../controller/SheetContext';
import type { Feature, LensDef } from '../../standard/load';
import { useHealthWord } from './bits';
import { contextsOf, lensKpis, type ScopeHint } from './kpis';
import { Count } from './motion';
import { dayFmt } from './values';

export function KpiRows({ f, d }: { f: Feature; d: LensDef }) {
  const s = useSheet(), { B, tx, language } = s.text, word = useHealthWord();
  const ctx = useMemo(() => contextsOf(s.data.structure), [s.data.structure]);
  const ks = useMemo(() => lensKpis(s.plan.S.kpis, d, f, ctx), [s.plan.S.kpis, d, f, ctx]);
  if (!ks.length) return null;
  const hint = (h: ScopeHint) => (h.kind === 'feature' ? B.pg_scope_feature : h.kind === 'context' ? tx(B.pg_scope_context, { name: h.name })
    : h.kind === 'group' ? tx(B.pg_scope_group, { name: h.name }) : h.kind === 'project' ? B.pg_scope_project : B.pg_scope_read);
  return (
    <div className="pg-kpis">
      <h4>{tx(B.pg_kpis, { count: ks.length })}</h4>
      {ks.map(({ k, hint: h, health }) => {
        const v = k.current?.value, u = k.unit ? (k.unit === '%' ? '%' : ' ' + k.unit) : '';
        const fmt = (n: number) => new Intl.NumberFormat(language, { maximumFractionDigits: Number.isInteger(n) ? 0 : 1 }).format(n) + u;
        return (
          <div key={k.slug} className={'kpi ' + (health ?? '')}>
            <span className="nm">{k.name}<em className="sc">{hint(h)}</em>{health ? <em className={'hl ' + health}>{word(health)}</em> : null}{k.status ? <em>{k.status}</em> : null}</span>
            <b className={health === 'bad' || health === 'watch' ? health : ''}>{typeof v === 'number' ? <Count k={f.id + ':kpi:' + k.slug} v={v} fmt={fmt} /> : B.pg_kpi_none}</b>
            <span className="mx">
              {k.current?.measured_at ? <em>{B.pg_kpi_measured} <RelativeTime timestamp={k.current.measured_at} showTooltip={false} /></em> : null}
              {k.baseline !== undefined && <em>{tx(B.pg_kpi_from, { value: fmt(k.baseline) })}</em>}
              {k.target !== undefined && <em>{k.target_date ? tx(B.pg_kpi_target_by, { value: fmt(k.target), date: dayFmt(language, k.target_date) }) : tx(B.pg_target, { value: fmt(k.target) })}</em>}
              {k.warn_at !== undefined && <em>{tx(B.pg_kpi_watch_at, { value: fmt(k.warn_at) })}</em>}
              {k.crit_at !== undefined && <em>{tx(B.pg_kpi_bad_at, { value: fmt(k.crit_at) })}</em>}
              {k.direction && <em>{k.direction === 'up' ? B.pg_kpi_up : B.pg_kpi_down}</em>}
            </span>
          </div>
        );
      })}
    </div>
  );
}
