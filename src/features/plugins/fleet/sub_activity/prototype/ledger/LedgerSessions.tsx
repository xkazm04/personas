/**
 * Section 2 of the Ledger port: the state filter and search over a sortable
 * ledger of sessions (mark | session | state | tokens | tools | files | turns |
 * age), the selected row's folio beside it. Loading draws ghost rows under the
 * permanent heads; failed, empty and no-match states are EmptyRows in the body.
 */
import type { RefObject } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  Section, Toolbar, Segmented, SearchField, LedgerBlock, ColHead, LedgerRow, RowPrimary, Figure,
  EmptyRow, GhostRows, LedgerSplit, ledgerCompact, type LedgerSpec, type SegmentOption,
} from '@/features/shared/components/kit-proto/ledger';
import { Button } from '@/features/shared/components/buttons';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';
import type { FleetActivitySurfaceProps as ActivityKitProps } from '../../FleetActivitySurface';
import { columnMax, STATE_ORDER, stateLabel, stateTone, type LedgerSession, type LedgerState, type SortKey } from './ledgerModel';
import { LedgerSessionFolio } from './LedgerSessionFolio';
import { searchKeys } from './useLedgerKeys';

const FA_SPEC: LedgerSpec = { meta: true, figs: 4, time: true };

export function LedgerSessions({ rows, loading, failed, query, setQuery, onOpen, onRefresh, all, visible, state, setState, sort, setSort, selected, onSelect, onClose, searchRef, onSearchDown }: ActivityKitProps & {
  all: LedgerSession[];
  visible: LedgerSession[];
  state: LedgerState | 'all';
  setState: (s: LedgerState | 'all') => void;
  sort: { key: SortKey; dir: 1 | -1 };
  setSort: (s: { key: SortKey; dir: 1 | -1 }) => void;
  selected: LedgerSession | null;
  onSelect: (key: string) => void;
  onClose: () => void;
  searchRef: RefObject<HTMLInputElement | null>;
  onSearchDown: () => void;
}) {
  const { t } = useTranslation();
  const f = t.plugins.fleet;
  const max = columnMax(all);

  const present = new Map<LedgerState, number>();
  for (const s of all) present.set(s.state, (present.get(s.state) ?? 0) + 1);
  const options: SegmentOption<LedgerState | 'all'>[] = [{ value: 'all', label: t.common.all, count: all.length }];
  for (const st of STATE_ORDER) {
    const n = present.get(st);
    if (n) options.push({ value: st, label: stateLabel(f, st), count: n, swatch: stateTone(st) ?? undefined, hollow: st === 'hibernated' });
  }
  const onSort = (key: string) => {
    const k = key as SortKey;
    setSort(sort.key === k ? { key: k, dir: sort.dir === 1 ? -1 : 1 } : { key: k, dir: -1 });
  };
  const clear = () => { setState('all'); setQuery(''); };

  let body;
  if (loading && rows.length === 0) body = <GhostRows spec={FA_SPEC} count={6} label={f.activity_loading} />;
  else if (failed) body = <EmptyRow title={f.activity_error} action={<Button variant="secondary" size="xs" onClick={onRefresh}>{t.common.retry}</Button>} />;
  else if (rows.length === 0) body = <EmptyRow title={f.activity_empty} data-testid="fleet-activity-empty" />;
  else if (visible.length === 0) body = <EmptyRow title={f.activity_no_matches} data-testid="fleet-activity-empty" action={<Button variant="secondary" size="xs" onClick={clear}>{f.filter_clear}</Button>} />;
  else body = visible.map((s) => (
    <LedgerRow
      key={s.key}
      spec={FA_SPEC}
      rowKey={s.key}
      data-testid="fleet-activity-row"
      tone={s.tone}
      hollow={s.hollow}
      muted={s.state === 'gone'}
      selected={selected?.key === s.key}
      wrapSelectedName={!!selected}
      onSelect={() => onSelect(s.key)}
      primary={<RowPrimary name={s.title ?? s.project} sub={<>{s.title ? <>{s.project}<span className="dot">·</span></> : null}{s.model}</>} />}
      meta={<><span className={`typo-caption${s.state === 'gone' ? ' quieter' : ''}`}>{stateLabel(f, s.state)}</span><span className="typo-caption quieter">{s.reason}</span></>}
      figures={[
        <Figure key="t" value={<Numeric>{ledgerCompact(s.tokens.total)}</Numeric>} of={s.tokens.total / max.tokens} split={s.cacheShare} />,
        <Figure key="o" value={<Numeric value={s.toolCalls} unit="count" />} of={s.toolCalls / max.tools} />,
        <Figure key="f" value={<Numeric value={s.files} unit="count" />} of={s.files / max.files} />,
        <Figure key="u" value={<Numeric value={s.turns} unit="count" />} of={s.turns / max.turns} />,
      ]}
      time={<RelativeTime timestamp={s.row.lastTimestamp} format="elapsed" showTooltip={false} />}
    />
  ));

  return (
    <Section
      id="fa-sessions"
      data-testid="fleet-activity-list"
      eyebrow={`2 / 3 · ${f.activity_eyebrow_transcripts}`}
      title={f.activity_sec_sessions}
      count={<><Numeric value={visible.length} unit="count" /> / <Numeric value={all.length} unit="count" /></>}
      status={<span className="legend"><span><i />{f.activity_legend_fresh}</span><span><i className="pale" />{f.insights_cache_read.toLowerCase()}</span></span>}
      actions={<Button variant="ghost" size="xs" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={onRefresh} loading={loading}>{t.common.refresh}</Button>}
    >
      <Toolbar>
        <Segmented label={t.common.status} value={state} options={options} onChange={(v) => setState(state === v && v !== 'all' ? 'all' : v)} />
        <SearchField
          ref={searchRef}
          value={query}
          onChange={setQuery}
          placeholder={f.activity_search_placeholder}
          data-testid="fleet-activity-search"
          onKeyDown={(e) => searchKeys(e, onSearchDown)}
        />
      </Toolbar>
      <LedgerSplit
        open={!!selected}
        table={(
          <LedgerBlock spec={FA_SPEC} label={f.activity_sec_sessions} head={(
            <ColHead
              spec={FA_SPEC}
              primary={f.monitor_col_session}
              meta={t.common.status}
              figs={[
                { label: f.insights_tokens, sort: 'tokens' }, { label: t.common.tools, sort: 'tools' },
                { label: f.activity_col_files, sort: 'files' }, { label: f.insights_turns, sort: 'turns' },
              ]}
              time={{ label: f.monitor_col_age, sort: 'lastMs' }}
              sortKey={sort.key}
              sortDir={sort.dir}
              onSort={onSort}
            />
          )}>
            {body}
          </LedgerBlock>
        )}
        folio={selected ? <LedgerSessionFolio session={selected} onClose={onClose} onOpen={() => onOpen(selected.row)} /> : null}
      />
    </Section>
  );
}
