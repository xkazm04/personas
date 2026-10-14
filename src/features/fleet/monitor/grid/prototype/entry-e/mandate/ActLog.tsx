// The act log: counted filters (all / by steward / by you / revertible /
// reverted) over one page of acts, newest first, one row each: what was
// decided, by whom, under which scope and envelope version, and whether it
// can still be taken back. The selected row is what V (revert) and N (narrow)
// act on; ↑/↓ (or j/k) move it.

import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { ChipRow, ListRow, Rows } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { CharterAct } from '@/lib/bindings/CharterAct';
import { actorLabel, asScope, scopeLabel } from './mandateCopy';
import { ACT_FILTERS, actMatches, type ActFilter, type ActLogState } from './useActLog';

const SHOWN = 200;

export function filterLabel(m: ReturnType<typeof useTranslation>['t']['monitor'], f: ActFilter): string {
  switch (f) {
    case 'all': return m.ml_filter_all;
    case 'steward': return m.ml_filter_steward;
    case 'you': return m.ml_filter_you;
    case 'revertible': return m.ml_filter_revertible;
    case 'reverted': return m.ml_filter_reverted;
  }
}

export function visibleActs(log: ActLogState, filter: ActFilter): CharterAct[] {
  return (log.acts ?? []).filter((a) => actMatches(filter, a)).slice(0, SHOWN);
}

export function ActLog({ log, filter, onFilter, rows, selected, onSelect, mandateName }: {
  log: ActLogState;
  filter: ActFilter;
  onFilter: (f: ActFilter) => void;
  /** `visibleActs(log, filter)`, computed once by the caller (its keys walk it). */
  rows: readonly CharterAct[];
  selected: number;
  onSelect: (i: number) => void;
  /** Names the mandate on each row (the fleet-wide log); omitted on a mandate page. */
  mandateName?: (charterId: string) => string;
}) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const chips = ACT_FILTERS.map((f) => ({
    id: f,
    label: filterLabel(m, f),
    count: log.acts ? log.counts[f] : undefined,
    state: f === filter ? ('selected' as const) : undefined,
    onPress: () => onFilter(f),
  }));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" data-testid="mandate-act-log">
      <ChipRow chips={chips} label={m.ml_act_filters_aria} emptyLabel={null} />
      <p className="typo-caption text-status-error" role="status">{log.failed ? m.ml_acts_failed : null}</p>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Rows
          loading={log.acts === null && !log.failed}
          count={rows.length}
          label={m.ml_act_log}
          empty={{ title: filter === 'all' ? m.ml_acts_empty : m.ml_acts_empty_filter, testId: 'mandate-act-log-empty' }}
        >
          {rows.map((a, i) => {
            const scope = asScope(a.scope);
            const meta = [
              actorLabel(m, a.actor),
              scope ? scopeLabel(m, scope) : null,
              tx(m.ml_act_version, { version: a.envelopeVersion }),
              mandateName ? mandateName(a.charterId) : null,
              a.revertedAt ? m.ml_act_reverted : !a.reversible ? m.ml_act_final : null,
            ].filter(Boolean).join(' · ');
            return (
              <ListRow
                key={a.id}
                testId="mandate-act-row"
                name={<span className="typo-code">{a.verdict} · {a.itemKind} {a.itemId}</span>}
                meta={meta}
                mark={{
                  tone: a.revertedAt ? 'neutral' : a.actor === 'operator' ? 'human' : 'agent',
                  label: actorLabel(m, a.actor),
                }}
                time={<RelativeTime timestamp={a.createdAt} />}
                state={i === selected ? 'selected' : undefined}
                onPress={() => onSelect(i)}
              />
            );
          })}
        </Rows>
      </div>
    </div>
  );
}
