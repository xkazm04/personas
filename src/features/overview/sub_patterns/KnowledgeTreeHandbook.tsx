// Variant B — HANDBOOK. Metaphor: a printed engineering reference.
//
// The baseline's row is a label ("Debounce resize observers") with status and
// kind beside it — to recognise a practice you read titles one at a time. Here
// the entry LEADS WITH THE CLAIM: the `statement` is set as body copy at the
// largest type on the row, with the evidence count as a citation marker and the
// title/kind/altitude demoted to a quiet reference line underneath. You read
// what the practice asserts, not what someone named it.
//
// The index carries hierarchy through TYPE SCALE, not indentation: areas are
// small-caps section rules with a running count; clusters are flush-left
// entries set larger than their own heading, exactly as a printed index does.
// Nothing is indented, so nothing has to be traced back to a parent.
import { useCallback, useMemo, useState } from 'react';
import { Library } from 'lucide-react';

import { DataGrid, type DataGridColumn } from '@/features/shared/components/display/DataGrid';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';

import { KnowledgeStatusChip } from '@/features/plugins/dev-tools/sub_workspaces/centerShared';
import { buildTerritories, type Territory } from './knowledgeCartogramModel';
import {
  applyView,
  PracticeFilters,
  selectColumn,
  useKnowledgeReview,
  type KnowledgeReviewState,
  type KnowledgeTreeProps,
} from './knowledgeTableShared';
import type { KnowledgeItemView } from './libraryModel';

export default function KnowledgeTreeHandbook(props: KnowledgeTreeProps) {
  const { items, onRowClick } = props;
  const { tx } = useTranslation();
  const state = useKnowledgeReview(props);
  const tw = state.tw;

  const [scopePath, setScopePath] = useState('');
  const areas = useMemo(() => buildTerritories(items), [items]);

  const scope = useCallback(
    (i: KnowledgeItemView) =>
      !scopePath || i.topic === scopePath || i.topic.startsWith(`${scopePath}/`),
    [scopePath],
  );
  const rows = useMemo(() => applyView(items, scope, state), [items, scope, state]);

  const columns = useMemo<DataGridColumn<KnowledgeItemView>[]>(
    () => [
      ...(state.hasBulk ? [selectColumn(state)] : []),
      {
        key: 'entry',
        label: tw.col_practice,
        width: 'minmax(0, 1fr)',
        render: (r: KnowledgeItemView) => <HandbookEntry item={r} state={state} />,
      },
    ],
    [state, tw],
  );

  return (
    <div className="flex min-h-0 h-full gap-6">
      <aside className="w-64 shrink-0 overflow-y-auto pr-1">
        <button
          type="button"
          onClick={() => setScopePath('')}
          className={`w-full flex items-baseline justify-between gap-2 py-1 text-left focus-ring rounded-interactive ${
            scopePath === '' ? 'text-primary' : 'text-foreground hover:text-primary'
          }`}
        >
          <span className="typo-title">{tw.index_all_areas}</span>
          <span className="typo-data text-foreground">{items.length}</span>
        </button>
        {areas.map((area) => (
          <IndexSection
            key={area.path}
            area={area}
            scopePath={scopePath}
            uncategorized={tw.map_uncategorized}
            onSelect={setScopePath}
          />
        ))}
      </aside>

      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        <div className="flex items-start gap-3 pb-2 flex-wrap">
          <span className="typo-caption mt-1.5">
            {scopePath
              ? tx(tw.branch_summary, { topic: scopePath, count: rows.length })
              : tx(tw.all_topics_summary, { count: rows.length })}
          </span>
          <div className="ml-auto">
            <PracticeFilters state={state} showFacets showSort />
          </div>
        </div>

        <DataGrid
          columns={columns}
          data={rows}
          getRowKey={(r) => r.id}
          onRowClick={onRowClick ? (r) => onRowClick(r, rows) : undefined}
          pageSize={25}
          density="compact"
          emptyIcon={Library}
          emptyTitle={tw.library_empty_title}
          emptyDescription={tw.library_empty_desc}
          className="flex-1 min-h-0 rounded-card border border-primary/10"
          {...state.selectionProps(rows)}
        />
      </div>
    </div>
  );
}

/* -- index ----------------------------------------------------------------- */

/** One area: a small-caps section rule with its running count, then its
 *  clusters set FLUSH LEFT at body scale. Depth reads from the type, not from
 *  an indent — which is the whole point of the variant. */
function IndexSection({
  area,
  scopePath,
  uncategorized,
  onSelect,
}: {
  area: Territory;
  scopePath: string;
  uncategorized: string;
  onSelect: (path: string) => void;
}) {
  return (
    <section className="mt-4">
      <button
        type="button"
        onClick={() => onSelect(area.path)}
        className={`w-full flex items-center gap-2 text-left focus-ring rounded-interactive ${
          scopePath === area.path ? 'text-primary' : 'text-foreground/85 hover:text-primary'
        }`}
      >
        <span className="typo-label truncate">{area.label || uncategorized}</span>
        <span className="flex-1 h-px bg-primary/15" />
        <span className="typo-data text-foreground">{area.total}</span>
      </button>
      {area.children.map((cluster) => (
        <button
          key={cluster.path}
          type="button"
          onClick={() => onSelect(cluster.path)}
          className={`w-full flex items-baseline gap-2 py-0.5 text-left focus-ring rounded-interactive ${
            scopePath === cluster.path ? 'text-primary' : 'text-foreground hover:text-primary'
          }`}
        >
          <span className="typo-body truncate">{cluster.label}</span>
          <span className="flex-1" />
          {cluster.pending > 0 && (
            <span className="typo-caption text-status-warning">{cluster.pending}</span>
          )}
          <span className="typo-data text-foreground">{cluster.total}</span>
        </button>
      ))}
    </section>
  );
}

/* -- entry ----------------------------------------------------------------- */

const META_ITEM = 'pl-2 border-l border-primary/15 first:pl-0 first:border-l-0';

/** Claim first, apparatus second. */
function HandbookEntry({ item, state }: { item: KnowledgeItemView; state: KnowledgeReviewState }) {
  const { tx } = useTranslation();
  const { tw, statusLabel, kindLabel } = state;
  const evidence = item.evidenceCount ?? 1;
  const abstraction =
    item.abstraction === 'macro'
      ? tw.abstraction_macro
      : item.abstraction === 'meso'
        ? tw.abstraction_meso
        : item.abstraction === 'micro'
          ? tw.abstraction_micro
          : null;

  return (
    <div className="min-w-0 py-1">
      <p className="typo-body-lg text-foreground">
        {item.statement}
        {evidence > 1 && (
          <Tooltip content={tx(tw.evidence_sites, { count: evidence })}>
            <sup className="typo-label text-primary ml-1 align-super">{evidence}</sup>
          </Tooltip>
        )}
      </p>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={META_ITEM}>
          <KnowledgeStatusChip status={item.status} label={statusLabel[item.status]} />
        </span>
        <span className={`${META_ITEM} typo-caption truncate max-w-xs`}>
          {item.title}
        </span>
        <span className={`${META_ITEM} typo-caption`}>
          {kindLabel[item.kind]}
        </span>
        {abstraction && (
          <span className={`${META_ITEM} typo-caption`}>{abstraction}</span>
        )}
        <span className={`${META_ITEM} typo-caption`}>{item.topic}</span>
        <span className={META_ITEM}>
          <RelativeTime timestamp={item.updatedAt} className="typo-caption" />
        </span>
      </p>
    </div>
  );
}
