// Factory L2 — tab (b) Context map. The Dev Tools Context Map's CONTENT
// (groups → contexts with KPI-health tinting, runtime cost/error chips, and
// feature coverage) re-painted in the cockpit ink. Read-focused during the
// dual-run: authoring (scans, group editing, use-case triage) stays in the
// Dev Tools original until the Factory version proves itself.
import { useMemo, useState } from 'react';
import { AlertTriangle, CircleDollarSign, Layers } from 'lucide-react';

import type { DevContext } from '@/lib/bindings/DevContext';
import { Numeric } from '@/features/shared/components/display/Numeric';
import type { ContextKpiStatus } from '@/features/plugins/dev-tools/sub_context/contextKpiStatus';

import { INK } from '../passport/passportInk';
import type { FactoryL2Data } from './factoryL2Data';

const STATUS_HUE: Record<ContextKpiStatus, string> = {
  'off-track': INK.red,
  'on-track': INK.teal,
  met: INK.emerald,
  unmeasured: 'rgba(148,163,184,.45)',
  none: 'rgba(148,163,184,.45)',
};

function ContextPlate({ ctx, data }: { ctx: DevContext; data: FactoryL2Data }) {
  const status = data.kpiStatusByContext.get(ctx.id) ?? 'none';
  const hue = STATUS_HUE[status];
  const cost = data.runtime.costByContext.get(ctx.id);
  const errs = data.runtime.errorsByContext.get(ctx.id);
  const features = data.featureCountByContext.get(ctx.id) ?? 0;
  const neutral = status === 'none' || status === 'unmeasured';

  return (
    <div
      className="min-w-0 px-2.5 pt-1.5 pb-2 rounded-card"
      style={{
        background: neutral ? 'rgba(148,163,184,.04)' : `${hue}0d`,
        border: `1px solid ${neutral ? 'rgba(148,163,184,.16)' : `${hue}3d`}`,
      }}
      title={ctx.description ?? ctx.name}
      data-testid={`factory-ctx-${ctx.id}`}
    >
      <span className="flex items-center gap-1.5 min-w-0">
        <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: hue, boxShadow: neutral ? undefined : `0 0 5px ${hue}88` }} />
        <span className="typo-caption font-medium text-foreground/90 truncate">{ctx.name}</span>
        {ctx.category && <span className="ml-auto text-[9.5px] uppercase tracking-wide text-foreground/35 shrink-0">{ctx.category}</span>}
      </span>
      <span className="flex items-center gap-2.5 mt-1.5 min-w-0 text-[10.5px] tabular-nums">
        <span className="flex items-center gap-1" style={{ color: errs != null ? (errs >= 25 ? INK.red : errs > 0 ? INK.amber : INK.emerald) : 'rgba(148,163,184,.4)' }} title={errs != null ? `${errs} unresolved error events attributed to this context's files` : 'monitoring not wired'}>
          <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden />
          {errs != null ? errs : '·'}
        </span>
        <span className="flex items-center gap-1" style={{ color: cost != null ? (cost >= 18 ? INK.red : cost >= 6 ? INK.amber : INK.emerald) : 'rgba(148,163,184,.4)' }} title={cost != null ? `$${cost.toFixed(2)} /30d flows through this context (full cost of every feature slicing it)` : 'LLM tracking not wired'}>
          <CircleDollarSign className="w-3 h-3 shrink-0" aria-hidden />
          {cost != null ? <Numeric value={cost} precision={0} /> : '·'}
        </span>
        <span className="flex items-center gap-1 text-foreground/45 ml-auto" title={`${features} active features slice this context`}>
          <Layers className="w-3 h-3 shrink-0" aria-hidden />
          {features}
        </span>
      </span>
    </div>
  );
}

export function FactoryContextTab({ data }: { data: FactoryL2Data }) {
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);

  const byGroup = useMemo(() => {
    const m = new Map<string | null, DevContext[]>();
    for (const c of data.contexts) {
      const k = c.group_id ?? null;
      const list = m.get(k);
      if (list) list.push(c);
      else m.set(k, [c]);
    }
    return m;
  }, [data.contexts]);

  if (!data.loading && data.groups.length === 0 && data.contexts.length === 0) {
    return (
      <p className="typo-caption text-foreground/45 rounded-card border border-dashed border-foreground/15 px-3 py-5 text-center" data-testid="factory-context-tab">
        No context map yet — run a codebase scan from Dev Tools → Context Map, then come back.
      </p>
    );
  }

  const ungrouped = byGroup.get(null) ?? [];

  return (
    <div data-testid="factory-context-tab">
      <p className="typo-caption text-foreground/45 mb-2.5">
        {data.contexts.length} contexts · {data.groups.length} groups · {data.useCaseState.active.length} features — tinted by KPI health; authoring stays in Dev Tools → Context Map for now.
      </p>
      <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))' }}>
        {data.groups.map((g) => {
          const cells = byGroup.get(g.id) ?? [];
          const statuses = cells.map((c) => data.kpiStatusByContext.get(c.id) ?? 'none');
          const worst =
            statuses.includes('off-track') ? INK.red
            : statuses.includes('on-track') ? INK.teal
            : statuses.includes('met') ? INK.emerald
            : 'rgba(148,163,184,.45)';
          const collapsed = openGroupId !== null && openGroupId !== g.id;
          return (
            <div key={g.id} className={`rounded-modal p-3 ${collapsed ? 'opacity-60' : ''}`} style={{ border: `1px solid ${worst}2e`, background: 'rgba(148,163,184,.025)' }}>
              <button
                type="button"
                className="flex items-baseline gap-2 mb-2 min-w-0 w-full text-left focus-ring rounded-interactive"
                onClick={() => setOpenGroupId(openGroupId === g.id ? null : g.id)}
                title={g.domain ? `${g.name} — ${g.domain}` : g.name}
              >
                <span className="w-1.5 h-1.5 rounded-full shrink-0 self-center" style={{ background: worst, boxShadow: `0 0 5px ${worst}66` }} />
                <span className="typo-caption font-semibold tracking-tight text-foreground/85 truncate">{g.name}</span>
                {g.domain && <span className="text-[9.5px] uppercase tracking-wide text-foreground/35 shrink-0">{g.domain}</span>}
                <span className="ml-auto text-[10px] tabular-nums text-foreground/35 shrink-0">{cells.length}</span>
              </button>
              <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))' }}>
                {cells.map((c) => <ContextPlate key={c.id} ctx={c} data={data} />)}
              </div>
            </div>
          );
        })}
        {ungrouped.length > 0 && (
          <div className="rounded-modal p-3" style={{ border: '1px dashed rgba(148,163,184,.25)', background: 'rgba(148,163,184,.02)' }}>
            <div className="flex items-baseline gap-2 mb-2">
              <span className="typo-caption font-semibold text-foreground/60">Ungrouped</span>
              <span className="ml-auto text-[10px] tabular-nums text-foreground/35">{ungrouped.length}</span>
            </div>
            <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))' }}>
              {ungrouped.map((c) => <ContextPlate key={c.id} ctx={c} data={data} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
