// L2 Overview (composition kit): the selected context's detail layer (the side
// pane on a wide surface, the drawer on a narrow one). Its signals as a
// KeyValueGrid, and its proposed KPIs as Rows with Accept / Reject: the review
// queue the hover-persistent tooltip used to carry, now reachable by keyboard
// and without chasing a portal with the pointer.
import type { DevKpi } from '@/lib/bindings/DevKpi';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { KeyValueGrid, KitButton, ListRow, Meta, Rows, Section } from '@/features/shared/components/kit';
import type { FactoryWords } from '../useFactoryWords';
import type { FactoryL2Data } from './factoryL2Data';
import { coverageOf, type Cell } from './overviewModel';

const num = (v: number | null, unit: string) => (v != null ? `${v} ${unit}`.trim() : '-');

export function FactoryContextDetail({ cell, groupName, data, onDecide, onNote, w }: {
  cell: Cell | null;
  groupName: string;
  data: FactoryL2Data;
  onDecide: (k: DevKpi, status: 'active' | 'archived') => void;
  onNote: (s: string) => void;
  w: FactoryWords;
}) {
  if (!cell) return <Section title={w.context} state="empty" empty={{ title: w.L.noContexts }} />;
  const name = cell.ctx.business_feature?.trim() || cell.ctx.name;
  const proposals = data.proposalsByContext.get(cell.ctx.id) ?? [];
  const cov = coverageOf(data, cell.ctx.id);
  const cat: Record<string, string> = {
    technical: w.t.kpis.category_technical, quality: w.t.kpis.category_quality,
    traffic: w.t.kpis.category_traffic, value: w.t.kpis.category_value,
  };
  return (
    <Section
      id="s-fac-context"
      eyebrow={`${groupName} · ${w.kind[cell.kind]}`}
      title={name}
      meta={<Meta parts={[cell.ctx.category, cell.ctx.name !== name ? cell.ctx.name : null]} />}
      actions={
        <KitButton onClick={() => onNote(w.L.scanContextNote(name))} testId="factory-context-scan">{w.L.scanContext}</KitButton>
      }
    >
      <Section level={2} title={w.t.common.status}>
        <KeyValueGrid
          min="120px"
          items={[
            {
              k: w.L.worstKpi,
              v: cell.kpiPct == null ? null : `${cell.kpiPct}% ${w.L.ofTarget}`,
              none: cell.kpiCount > 0 ? w.t.kpis.track_unmeasured : w.t.kpis.define_kpi,
            },
            { k: w.kpis, v: cell.kpiCount },
            { k: w.errors, v: cell.errs, none: w.L.notWired },
            { k: w.cost, v: cell.costUsd == null ? null : <Numeric value={cell.costUsd} unit="usd" precision={2} />, none: w.L.notWired },
            { k: w.features, v: cov.features },
            { k: w.goals, v: cov.goals },
          ]}
        />
      </Section>
      <Section level={2} title={w.L.proposed} count={proposals.length}>
        {/* The anchor keeps the old tooltip's test id: tours and guides that
            pointed at the proposals keep finding them. */}
        <div data-testid="factory-kpi-tooltip">
          <Rows count={proposals.length} empty={{ title: w.L.noProposed }}>
            {proposals.map((k) => (
              <ListRow
                key={k.id}
                size="l"
                name={k.name}
                meta={<Meta parts={[cat[k.category] ?? k.category, `${num(k.baseline_value, k.unit)} → ${num(k.target_value, k.unit)}`, k.needed_connector]} />}
                mark={{ tone: 'agent', glyph: 'soft', label: w.L.proposed }}
                figures={
                  <>
                    <KitButton quiet onClick={() => onDecide(k, 'archived')} testId={`factory-tip-reject-${k.id}`}>{w.t.kpis.reject_button}</KitButton>
                    <KitButton onClick={() => onDecide(k, 'active')} testId={`factory-tip-accept-${k.id}`}>{w.t.kpis.accept_button}</KitButton>
                  </>
                }
              />
            ))}
          </Rows>
        </div>
      </Section>
    </Section>
  );
}
