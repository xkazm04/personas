// Approvals › Pending — a HISTORY view's list of what still waits, with the
// Decision Deck as the one place a verdict is made.
//
// This replaced the inline `TriageFocus` the pending filter used to render.
// Deciding happens in the global deck (`openDecisionDeck`): "Decide N" opens
// the gates chip's queue from its most urgent card, and a row opens the same
// queue with that review on top. The checkboxes stay because the bulk bar
// (approve / reject a selection) is a list act, not a card act.
//
// The list is the shared `UnifiedTable` (the same header, striping and resize as
// the Events and Incidents ledgers). It used to be a stack of `DecisionRow`
// cards, which read as a different product beside them.
import { useMemo, useState } from 'react';
import { Cloud, CheckSquare, Layers, Square } from 'lucide-react';

import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import Button from '@/features/shared/components/buttons/Button';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { TableTag } from '@/features/shared/components/display/TableCells';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { UnifiedTable, type TableColumn } from '@/features/shared/components/display/UnifiedTable';
import { useTranslation } from '@/i18n/useTranslation';
import type { ManualReviewItem } from '@/lib/types/types';

import { openChipDeck, reviewDecisionId } from '../libs/decisionDeckDoors';
import { resolveReviewSeverity } from '../libs/reviewHelpers';
import { AutoResolvedBadge } from './AutoResolvedBadge';
import { SeverityIndicator } from './ReviewListItem';

interface PendingDecisionListProps {
  reviews: ManualReviewItem[];
  /** The pending total across every page (L0 counts), not just the loaded rows. */
  pendingTotal: number;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  /** L2 lazy-load — callback ref for the keyset sentinel at the list end. */
  sentinelRef?: (el: HTMLElement | null) => void;
  hasMore?: boolean;
}

/** Most urgent first when sorted descending. */
const SEVERITY_RANK: Record<string, number> = { critical: 5, error: 4, high: 3, warning: 2, info: 1 };
const severityRank = (r: ManualReviewItem) => SEVERITY_RANK[(r.severity ?? '').trim().toLowerCase()] ?? 0;
const ALL = 'all';

export function PendingDecisionList({
  reviews,
  pendingTotal,
  selectedIds,
  onToggleSelect,
  sentinelRef,
  hasMore,
}: PendingDecisionListProps) {
  const { t, tx } = useTranslation();
  const count = Math.max(pendingTotal, reviews.length);

  // Column filters work over the rows loaded so far (the list is keyset-paged);
  // options come from those same rows, so a filter never offers an empty result.
  const [personaFilter, setPersonaFilter] = useState(ALL);
  const [severityFilter, setSeverityFilter] = useState(ALL);
  const personaOptions = useMemo(() => {
    const names = [...new Set(reviews.map((r) => r.persona_name || '—'))].sort((a, b) => a.localeCompare(b));
    return [{ value: ALL, label: t.common.all }, ...names.map((n) => ({ value: n, label: n }))];
  }, [reviews, t]);
  const severityOptions = useMemo(() => {
    const seen = [...new Set(reviews.map((r) => (r.severity ?? '').trim().toLowerCase()))].sort(
      (a, b) => (SEVERITY_RANK[b] ?? 0) - (SEVERITY_RANK[a] ?? 0),
    );
    return [{ value: ALL, label: t.common.all }, ...seen.map((v) => ({ value: v, label: resolveReviewSeverity(v).label }))];
  }, [reviews, t]);
  const visible = useMemo(
    () => reviews.filter((r) =>
      (personaFilter === ALL || (r.persona_name || '—') === personaFilter)
      && (severityFilter === ALL || (r.severity ?? '').trim().toLowerCase() === severityFilter)),
    [reviews, personaFilter, severityFilter],
  );

  const columns = useMemo<TableColumn<ManualReviewItem>[]>(() => [
    {
      key: 'select',
      label: '',
      width: '44px',
      render: (review) => (
        <span className="flex" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onToggleSelect(review.id)}
            role="checkbox"
            aria-checked={selectedIds.has(review.id)}
            aria-label={t.overview.dc_select_review}
          >
            {selectedIds.has(review.id) ? (
              <CheckSquare className="w-3.5 h-3.5 text-primary" />
            ) : (
              <Square className="w-3.5 h-3.5" />
            )}
          </Button>
        </span>
      ),
    },
    {
      key: 'persona',
      label: t.overview.events.col_persona,
      width: 'minmax(160px, 1fr)',
      sortable: true,
      sortFn: (a, b) => (a.persona_name || '').localeCompare(b.persona_name || ''),
      filterOptions: personaOptions,
      filterValue: personaFilter,
      onFilterChange: setPersonaFilter,
      render: (review) => (
        <span className="flex min-w-0 items-center gap-2">
          <PersonaIcon icon={review.persona_icon ?? null} color={review.persona_color ?? null} display="framed" frameSize="md" />
          <span className="truncate typo-body text-foreground">{review.persona_name || '—'}</span>
        </span>
      ),
    },
    {
      key: 'decision',
      label: t.overview.dc_col_decision,
      width: 'minmax(260px, 3fr)',
      sortable: true,
      sortFn: (a, b) => (a.title || a.content).localeCompare(b.title || b.content),
      render: (review) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate typo-body text-foreground">{review.title || review.content.slice(0, 80)}</span>
          {review.source === 'cloud' && <TableTag icon={<Cloud className="w-3 h-3" />}>Cloud</TableTag>}
          <AutoResolvedBadge review={review} />
        </span>
      ),
    },
    {
      key: 'severity',
      label: t.overview.incidents.filter_severity_label,
      width: 'minmax(120px, 0.7fr)',
      sortable: true,
      sortFn: (a, b) => severityRank(a) - severityRank(b),
      filterOptions: severityOptions,
      filterValue: severityFilter,
      onFilterChange: setSeverityFilter,
      render: (review) => (
        <TableTag icon={<SeverityIndicator severity={review.severity} />}>{resolveReviewSeverity(review.severity).label}</TableTag>
      ),
    },
    {
      key: 'created',
      label: t.overview.events.col_created,
      width: 'minmax(110px, 0.6fr)',
      align: 'right',
      sortable: true,
      sortFn: (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at),
      render: (review) => <RelativeTime timestamp={review.created_at} className="typo-body text-foreground" />,
    },
  ], [t, selectedIds, onToggleSelect, personaOptions, personaFilter, severityOptions, severityFilter]);

  return (
    <div className="flex-1 min-h-0 flex flex-col" data-testid="pending-decision-list">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-primary/10 flex-shrink-0">
        <p className="flex-1 min-w-0 typo-body text-foreground">{t.overview.dc_pending_lead}</p>
        <Tooltip content={t.overview.dc_decide_tip} placement="bottom">
          <Button
            variant="primary"
            size="sm"
            icon={<Layers className="w-3.5 h-3.5" aria-hidden />}
            onClick={(e) => openChipDeck('gates', undefined, e.currentTarget)}
            data-testid="pending-decide-all"
            data-count={count}
          >
            {tx(t.overview.dc_decide_n, { count })}
          </Button>
        </Tooltip>
      </div>

      <div role="group" className="flex-1 min-h-0 overflow-y-auto" aria-label={t.overview.dc_pending_list_aria}>
        <UnifiedTable<ManualReviewItem>
          columns={columns}
          data={visible}
          getRowKey={(review) => review.id}
          onRowClick={(review) =>
            openChipDeck(
              'gates',
              reviewDecisionId(review.id),
              document.querySelector(`[data-testid="review-row-${review.id}"]`),
            )
          }
          rowAttrs={(review) => ({ testId: `review-row-${review.id}` })}
          tableId="overview-pending-decisions"
          density="compact"
          borderless
          emptyTitle={t.overview.dc_pending_list_aria}
        />
        {/* Keyset sentinel: scrolling near it pulls the next page. No spinner —
            the next page's rows ARE the progress. */}
        {hasMore && <div ref={sentinelRef} aria-hidden className="h-8" />}
      </div>
    </div>
  );
}
