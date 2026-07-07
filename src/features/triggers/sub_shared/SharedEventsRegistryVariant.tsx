import { useMemo, useState } from 'react';
import { RefreshCw, Star, Users } from 'lucide-react';
import { UnifiedTable, type TableColumn } from '@/features/shared/components/display/UnifiedTable';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { useTranslation } from '@/i18n/useTranslation';
import type { SharedEventCatalogEntry } from '@/lib/bindings/SharedEventCatalogEntry';
import { useSharedEvents } from './useSharedEvents';
import { FeedIcon, LastChangeCell } from './sharedEventsUi';
import { SubscribeButton, HistoryButton } from './SubscribeControls';
import { EventHistoryModal } from './EventHistoryModal';

/**
 * Registry variant — the marketplace as a dense, engineering-grade record: every
 * feed is one row in a sortable, filterable, searchable table (mirrors the app's
 * UnifiedTable used by the Activity / Event log). The mental model is a *catalog
 * you scan and query*, not cards you browse. Scales to hundreds of feeds.
 */
export function SharedEventsRegistryVariant() {
  const { t } = useTranslation();
  const m = t.triggers.marketplace;
  const { catalog, loading, refresh, subscribe, unsubscribe, subByEntryId, activityBySlug, categories } =
    useSharedEvents();

  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [historyEntry, setHistoryEntry] = useState<SharedEventCatalogEntry | null>(null);

  const data = useMemo(() => {
    const q = search.trim().toLowerCase();
    return catalog.filter((e) => {
      if (catFilter !== 'all' && e.category !== catFilter) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        e.slug.toLowerCase().includes(q) ||
        (e.publisher ?? '').toLowerCase().includes(q)
      );
    });
  }, [catalog, search, catFilter]);

  const columns = useMemo<TableColumn<SharedEventCatalogEntry>[]>(() => [
    {
      key: 'feed',
      label: m.col_feed,
      width: 'minmax(220px, 1.7fr)',
      searchable: true,
      searchValue: search,
      onSearchChange: setSearch,
      sortable: true,
      sortFn: (a, b) => a.name.localeCompare(b.name),
      render: (e) => (
        <div className="flex items-center gap-2.5 min-w-0">
          <FeedIcon entry={e} className="w-8 h-8" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="typo-body font-medium text-foreground truncate">{e.name}</span>
              {e.isFeatured && <Star className="w-3 h-3 text-amber-400 flex-shrink-0" />}
            </div>
            {e.description && (
              <p className="typo-caption text-foreground/55 truncate">{e.description}</p>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'category',
      label: m.col_category,
      width: '150px',
      sortable: true,
      filterOptions: [
        { value: 'all', label: t.common.all },
        ...categories.map((c) => ({ value: c, label: c })),
      ],
      filterValue: catFilter,
      onFilterChange: setCatFilter,
      render: (e) => <span className="typo-caption text-foreground/80 capitalize">{e.category}</span>,
    },
    {
      key: 'last_change',
      label: m.col_last_change,
      width: 'minmax(170px, 1fr)',
      sortable: true,
      sortFn: (a, b) =>
        (activityBySlug.get(b.slug)?.lastFiredAt ?? '').localeCompare(
          activityBySlug.get(a.slug)?.lastFiredAt ?? '',
        ),
      render: (e) => <LastChangeCell activity={activityBySlug.get(e.slug)} />,
    },
    {
      key: 'publisher',
      label: m.col_publisher,
      width: '130px',
      sortable: true,
      sortFn: (a, b) => (a.publisher ?? '').localeCompare(b.publisher ?? ''),
      render: (e) => <span className="typo-caption text-foreground/70 truncate">{e.publisher ?? '—'}</span>,
    },
    {
      key: 'subscribers',
      label: m.col_subscribers,
      width: '110px',
      align: 'right',
      sortable: true,
      sortFn: (a, b) => Number(a.subscriberCount) - Number(b.subscriberCount),
      render: (e) => (
        <span className="inline-flex items-center gap-1 typo-caption text-foreground/70">
          <Users className="w-3 h-3" />
          <Numeric value={Number(e.subscriberCount)} />
        </span>
      ),
    },
    {
      key: 'status',
      label: m.col_status,
      width: '150px',
      render: (e) => (
        <SubscribeButton
          entryId={e.id}
          subscription={subByEntryId.get(e.id)}
          subscribe={subscribe}
          unsubscribe={unsubscribe}
        />
      ),
    },
    {
      key: 'actions',
      label: m.col_actions,
      width: '64px',
      align: 'right',
      render: (e) => <HistoryButton onOpen={() => setHistoryEntry(e)} />,
    },
  ], [m, t.common.all, search, catFilter, categories, activityBySlug, subByEntryId, subscribe, unsubscribe]);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="flex items-center justify-end px-4 py-2">
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-1.5 px-2.5 py-1.5 typo-caption font-medium rounded-card text-foreground hover:bg-secondary/50 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          {t.common.refresh}
        </button>
      </div>
      <div className="flex-1 min-h-0 px-4 pb-4">
        <UnifiedTable
          columns={columns}
          data={data}
          getRowKey={(e) => e.id}
          onRowClick={(e) => setHistoryEntry(e)}
          rowHeight={56}
          density="compact"
          tableId="shared-events-registry"
          ariaLabel={m.view_registry}
          isLoading={loading}
          emptyTitle={loading ? t.triggers.loading_catalog : t.triggers.no_feeds}
          emptyDescription={t.triggers.no_feeds_hint}
          defaultSortKey="feed"
          defaultSortDir="asc"
        />
      </div>
      {historyEntry && (
        <EventHistoryModal entry={historyEntry} onClose={() => setHistoryEntry(null)} />
      )}
    </div>
  );
}
