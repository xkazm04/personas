// The register: every deed, grouped by whose move it is, with the filter box
// `/` lands in and the sort the page shares with the Board. In unclaimed mode
// (`u`) the same column lists the ground nobody claims instead.
import type { ReactNode, RefObject } from 'react';

import type { TDevTools } from '@/features/plugins/dev-tools/sub_context/contextLedgerShared';

import { FEATURE_MOVES, FEATURE_SORTS, type FeatureSort } from '../featureRules';
import { moveLabel, type TFeatures } from '../featuresModel';
import { groupTone, type CadFilter, type CadRow } from './cadastreModel';
import { RegisterRow } from './RegisterRow';

export interface RegisterProps {
  visible: CadRow[];
  total: number;
  sort: FeatureSort;
  onSort: (s: FeatureSort) => void;
  filter: CadFilter | null;
  onClearFilter: () => void;
  query: string;
  onQuery: (q: string) => void;
  filterRef: RefObject<HTMLInputElement | null>;
  listRef: RefObject<HTMLDivElement | null>;
  focus: string | null;
  /** The listbox's active option (a deed row, or an unclaimed context in `u` mode). */
  activeDescendant: string | undefined;
  hotClaims: ReadonlySet<string>;
  onOpen: (key: string, el: HTMLElement) => void;
  onPreview: (key: string | null) => void;
  /** Unclaimed mode: the list that replaces the deeds, and its count line. */
  unclaimedList: ReactNode | null;
  unclaimedCount: string;
  t: TFeatures;
  tDev: TDevTools;
  tx: (template: string, vars: Record<string, string | number>) => string;
  language: string;
}

function sortLabel(s: FeatureSort, t: TFeatures): string {
  switch (s) {
    case 'name': return t.sort_name;
    case 'score': return t.sort_score;
    case 'span': return t.sort_span;
    default: return t.sort_move;
  }
}

function flatHeading(s: FeatureSort, t: TFeatures): string {
  switch (s) {
    case 'name': return t.cadastre_by_name;
    case 'score': return t.cadastre_by_score;
    default: return t.cadastre_by_span;
  }
}

export function Register(p: RegisterProps) {
  const { t, tx } = p;
  const og = p.filter === 'unclaimed';
  const count = og
    ? p.unclaimedCount
    : p.visible.length === p.total
      ? tx(p.total === 1 ? t.cadastre_deeds_one : t.cadastre_deeds_other, { count: p.total })
      : tx(t.cadastre_count_of, { shown: p.visible.length, total: p.total });

  const row = (r: CadRow) => (
    <RegisterRow
      key={r.key}
      r={r}
      focused={r.key === p.focus}
      claimsHot={p.hotClaims.has(r.key)}
      withSpan={p.sort === 'span'}
      onOpen={p.onOpen}
      onPreview={p.onPreview}
      t={t}
      tDev={p.tDev}
      tx={tx}
      language={p.language}
    />
  );

  let body: ReactNode;
  if (og) body = p.unclaimedList;
  else if (p.visible.length === 0) {
    body = (
      <div className="empty">
        {tx(t.cadastre_no_match, { query: p.query })} <kbd className="kbd">Esc</kbd> {t.cadastre_no_match_clear}
      </div>
    );
  } else if (p.sort === 'move') {
    body = FEATURE_MOVES.map((move) => {
      const rows = p.visible.filter((r) => r.row.move === move);
      if (rows.length === 0) return null;
      return [
        <div key={`g-${move}`} className={`grp g-${groupTone(move)}`} role="presentation" data-role="cad-group">
          {moveLabel(move, t)}
          <span className="n">{rows.length}</span>
        </div>,
        ...rows.map(row),
      ];
    });
  } else {
    body = [
      <div key="g-flat" className="grp" role="presentation" data-role="cad-group">
        {flatHeading(p.sort, t)}
        <span className="n">{p.visible.length}</span>
      </div>,
      ...p.visible.map(row),
    ];
  }

  return (
    <aside className="register" data-role="cad-register" aria-label={t.cadastre_register_label}>
      <div className="reg-head">
        <div className="reg-title" data-role="cad-register-title">
          <h2>{og ? t.cadastre_unclaimed_title : t.cadastre_register_title}</h2>
          <span className="dim" data-testid="cad-register-count">{count}</span>
        </div>
        <label className="search" data-role="cad-search">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <circle cx="7" cy="7" r="5" />
            <path d="M11 11l3.5 3.5" />
          </svg>
          <input
            ref={p.filterRef}
            className="input"
            type="search"
            value={p.query}
            onChange={(e) => p.onQuery(e.target.value)}
            placeholder={og ? t.cadastre_search_unclaimed : t.cadastre_search_placeholder}
            aria-label={og ? t.cadastre_search_unclaimed : t.cadastre_search_placeholder}
            autoComplete="off"
            data-testid="cad-search"
          />
          <kbd className="kbd">/</kbd>
        </label>
        <div className="sortrow">
          {p.filter ? (
            <>
              <span className={`fpill ${p.filter === 'waiting' ? 'gate' : p.filter === 'trouble' ? 'trouble' : 'open'}`}>
                {p.filter === 'waiting' ? t.cadastre_only_waiting : p.filter === 'trouble' ? t.cadastre_only_trouble : t.cadastre_only_unclaimed}
              </span>
              <button type="button" className="fclear" onClick={p.onClearFilter} data-testid="cad-filter-clear">
                {og ? t.cadastre_clear_register : t.cadastre_clear_all}
                <kbd className="kbd">Esc</kbd>
              </button>
            </>
          ) : (
            <>
              <div className="seg" role="group" aria-label={t.sort_label}>
                {FEATURE_SORTS.map((s) => (
                  <button key={s} type="button" className={p.sort === s ? 'is-on' : ''} aria-pressed={p.sort === s} onClick={() => p.onSort(s)}>
                    {sortLabel(s, t)}
                  </button>
                ))}
              </div>
              <kbd className="kbd">s</kbd>
            </>
          )}
        </div>
      </div>
      <div
        ref={p.listRef}
        className="reg-list"
        tabIndex={0}
        role="listbox"
        aria-label={og ? t.cadastre_unclaimed_title : t.cadastre_register_title}
        aria-activedescendant={p.activeDescendant}
        onMouseLeave={() => p.onPreview(null)}
        data-testid="cad-list"
      >
        {body}
      </div>
      <div className="reg-foot">
        <span><kbd className="kbd">j</kbd><kbd className="kbd">k</kbd> {t.cadastre_foot_move}</span>
        <span><kbd className="kbd">Enter</kbd> {og ? t.cadastre_foot_open_context : t.cadastre_foot_open}</span>
      </div>
    </aside>
  );
}
