/**
 * Gate K prototype, Spine & Lens: the Sessions section. Toolbar (state filter, search, refresh),
 * then a DataTable whose rows carry their status on the spine and their figures as unit strips.
 */
import type { ReactNode, Ref } from 'react';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import {
  ChipView, DataTable, Dot, KitButton, Meta, SearchField, Section, Segmented, Toolbar, UnitStrip, apportion,
  type KitState, type SegmentOption, type TableRow,
} from '@/features/shared/components/kit';
import { STATE_GLYPH, STATE_ORDER, TOKEN_PARTS, type SpineSession, type SpineState } from './activitySpineModel';
import type { SpineWords } from './useSpineWords';

type Col = 's' | 'tok' | 'calls' | 'files' | 'turns' | 'age';
export type StateFilter = SpineState | 'all';

const fig = (strip: ReactNode, value: ReactNode) => (
  <span className="k-fig">{strip}<span className="typo-data k-regular">{value}</span></span>
);

export interface SessionsProps {
  all: readonly SpineSession[];
  shown: readonly SpineSession[];
  selected: string | null;
  loading: boolean;
  failed: boolean;
  stateFilter: StateFilter;
  setStateFilter: (v: StateFilter) => void;
  tool: string | null;
  clearTool: () => void;
  query: string;
  setQuery: (q: string) => void;
  clearFilters: () => void;
  onRefresh: () => void;
  onSelect: (id: string) => void;
  searchRef: Ref<HTMLInputElement>;
  w: SpineWords;
}

export function ActivitySpineSessions(p: SessionsProps) {
  const { w } = p;
  const present = STATE_ORDER.filter((st) => p.all.some((s) => s.state === st));
  const options: Array<SegmentOption<StateFilter>> = [
    { v: 'all', label: w.t.common.all, count: p.all.length },
    ...present.map((st) => ({ v: st, label: w.state[st], count: p.all.filter((s) => s.state === st).length, ...STATE_GLYPH[st] })),
  ];
  const rows: Array<TableRow<Col>> = p.shown.map((s) => {
    const state: KitState[] = [];
    if (s.id === p.selected) state.push('selected');
    if (s.state === 'running') state.push('live');
    if (s.state === 'gone') state.push('muted');
    const name = s.title ?? s.project ?? w.t.overview.activity.unknown;
    return {
      id: s.id,
      state,
      mark: { ...STATE_GLYPH[s.state], label: w.state[s.state] },
      cells: {
        s: (
          <div className="k-cell2">
            <span className={`k-row__name typo-body ${s.title ? 'k-strong' : 'k-quiet k-regular'}`}>{name}</span>
            <span className="k-row__meta typo-caption"><Meta parts={[s.title ? s.project : null, s.model, w.state[s.state]]} /></span>
          </div>
        ),
        tok: fig(
          <UnitStrip size="s" rows={2} label={w.f.insights_tokens} segments={apportion(TOKEN_PARTS.map((t) => ({ value: s.tokens[t.k], tone: t.tone })), 100_000)} />,
          <Numeric value={s.tokens.total} unit="compact" />,
        ),
        calls: fig(<UnitStrip size="pip" label={w.toolCalls} segments={[{ n: s.toolCalls / 10, tone: 'primary', glyph: 'soft' }]} />, s.toolCalls),
        files: fig(<UnitStrip size="s" label={w.files} segments={[{ n: s.row.filesTouched.length, tone: 'highlight' }]} />, s.row.filesTouched.length),
        turns: <span className="typo-data k-regular">{s.row.userMessages + s.row.assistantMessages}</span>,
        age: <span className="typo-data k-regular k-quiet"><RelativeTime timestamp={s.row.lastTimestamp} format="elapsed" showTooltip={false} /></span>,
      },
    };
  });
  const filteredOut = p.all.length > 0;
  return (
    <Section
      id="s-fa-sessions"
      eyebrow={w.eyebrow}
      title={w.sessions}
      count={p.all.length}
      meta={
        <span className="k-legend-row typo-caption">
          {TOKEN_PARTS.map((t) => <span key={t.k}><Dot tone={t.tone} />{w.tokenLabels[t.k]}</span>)}
        </span>
      }
    >
      <Toolbar label={w.t.common.search}>
        <Segmented label={w.f.search_placeholder} options={options} value={p.stateFilter} onChange={p.setStateFilter} />
        <SearchField value={p.query} onChange={p.setQuery} placeholder={w.f.activity_search_placeholder} inputRef={p.searchRef} testId="fleet-activity-search" />
        {p.tool && <ChipView chip={{ id: p.tool, label: `${p.tool} ×`, state: 'selected', onPress: p.clearTool }} />}
        <KitButton onClick={p.onRefresh} loading={p.loading}>{w.t.common.refresh}</KitButton>
      </Toolbar>
      <DataTable<Col>
        label={w.sessions}
        loading={p.loading && p.all.length === 0}
        onRowClick={p.onSelect}
        rowTestId="kit-spine-row"
        cols={[
          { key: 's', label: w.f.monitor_col_session },
          { key: 'tok', label: w.f.insights_tokens, num: true },
          { key: 'calls', label: w.toolCalls, num: true },
          { key: 'files', label: <span className="k-cap inline-block">{w.files}</span>, num: true },
          { key: 'turns', label: w.f.insights_turns, num: true },
          { key: 'age', label: w.f.monitor_col_age, num: true },
        ]}
        rows={rows}
        empty={
          p.failed
            ? { title: w.f.activity_error, tone: 'warning', action: <KitButton onClick={p.onRefresh}>{w.t.common.refresh}</KitButton> }
            : filteredOut
              ? { title: w.f.activity_no_matches, action: <KitButton onClick={p.clearFilters}>{w.f.filter_clear}</KitButton> }
              : { title: w.f.activity_empty }
        }
        pager={
          <>
            <span className="typo-data k-regular k-quiet">{w.tx(rows.length === 1 ? w.f.sessions_one : w.f.sessions_other, { count: rows.length })}</span>
            <span className="typo-caption k-legend-row">
              <span>{w.f.insights_tokens} <UnitStrip size="s" label={w.f.insights_tokens} segments={[{ n: 1, tone: 'external' }]} /> = 100k</span>
              <span>{w.toolCalls} <UnitStrip size="pip" label={w.toolCalls} segments={[{ n: 1, tone: 'primary', glyph: 'soft' }]} /> = 10</span>
              <span><span className="k-cap inline-block">{w.files}</span> <UnitStrip size="s" label={w.files} segments={[{ n: 1, tone: 'highlight' }]} /> = 1</span>
            </span>
          </>
        }
      />
    </Section>
  );
}
