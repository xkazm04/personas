/**
 * Observability (composition kit): the healing timeline. Each resilience chain is a DataTable
 * row whose Mark is its outcome (a running retry glows); picking one hangs its steps on the
 * detail pane's spine (HealingChainDetail). The patterns healing learned are Rows in a level-2
 * Section under the chains.
 */
import { useMemo } from 'react';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { DataTable, ListRow, Meta, Rows, Section, UnitStrip, type KitState, type TableRow } from '@/features/shared/components/kit';
import type { HealingTimelineEvent } from '@/lib/bindings/HealingTimelineEvent';
import { chainMark, groupChains, type ChainGroup } from '../libs/issueModel';
import type { ObservabilityWords } from '../libs/useObservabilityWords';

type Col = 'chain' | 'steps' | 'age';

export function useChains(events: readonly HealingTimelineEvent[]) {
  return useMemo(() => groupChains(events), [events]);
}

export function HealingTimeline({ chains, knowledge, loading, selectedId, onSelect, w }: {
  chains: readonly ChainGroup[];
  knowledge: readonly HealingTimelineEvent[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (chainId: string) => void;
  w: ObservabilityWords;
}) {
  const { o, t } = w;
  const rows: Array<TableRow<Col>> = chains.map((g) => {
    const retries = g.events.filter((e) => e.eventType === 'retry').length;
    const m = chainMark(g);
    const state: KitState[] = [];
    if (g.chainId === selectedId) state.push('selected');
    if (m.glyph === 'live') state.push('live');
    if (g.outcome?.autoFixed || g.outcome?.status === 'resolved') state.push('muted');
    return {
      id: g.chainId,
      state,
      mark: { ...m, label: g.outcome?.title ?? g.trigger?.title ?? g.chainId },
      cells: {
        chain: (
          <div className="k-cell2">
            <span className="k-row__name typo-body k-strong">{g.trigger?.title ?? g.chainId}</span>
            <span className="k-row__meta typo-caption">
              <Meta parts={[
                g.trigger?.isCircuitBreaker ? o.healing_issues_panel.circuit_breaker_label : null,
                g.trigger?.severity, g.trigger?.category,
                retries > 0 ? w.tx(o.healing_timeline.retry_badge, { count: retries }) : null,
                g.outcome?.title,
              ]} />
            </span>
          </div>
        ),
        steps: (
          <span className="k-fig">
            <UnitStrip size="pip" label={t.agents.executions.tab_chain} segments={[{ n: g.events.length, tone: 'primary', glyph: 'soft' }]} />
            <span className="typo-data k-regular">{g.events.length}</span>
          </span>
        ),
        age: g.trigger
          ? <span className="typo-data k-regular k-quiet"><RelativeTime timestamp={g.trigger.timestamp} format="elapsed" showTooltip={false} /></span>
          : null,
      },
    };
  });

  // One element: this is the Split's main column, and a fragment would spill into the pane's.
  return (
    <div className="min-w-0">
      <DataTable<Col>
        label={o.observability_extra.healing_view_timeline}
        loading={loading && chains.length === 0}
        onRowClick={onSelect}
        rowTestId="obs-chain-row"
        cols={[
          { key: 'chain', label: t.agents.executions.tab_chain },
          { key: 'steps', label: t.agents.executions.trace, num: true },
          { key: 'age', label: o.incidents.ledger.col_age, num: true },
        ]}
        rows={rows}
        empty={{ title: o.healing_timeline.no_events, hint: o.healing_timeline.no_events_hint, tone: 'success' }}
      />
      {knowledge.length > 0 && (
        <Section level={2} title={o.healing_timeline.knowledge_base} count={knowledge.length} desc={o.healing_timeline.patterns_hint}>
          <Rows count={knowledge.length} empty={{ title: '' }}>
            {knowledge.map((e) => (
              <ListRow
                key={e.id}
                size="s"
                name={e.title}
                meta={e.suggestedFix ?? e.description}
                mark={{ tone: 'info', glyph: 'soft', label: o.healing_timeline.knowledge_base }}
                time={<RelativeTime timestamp={e.timestamp} format="elapsed" showTooltip={false} />}
              />
            ))}
          </Rows>
        </Section>
      )}
    </div>
  );
}
