import { useMemo, useState } from 'react';
import { RefreshCw, Search, X } from 'lucide-react';
import { UnifiedTable, type TableColumn } from '@/features/shared/components/display/UnifiedTable';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { FEEDS_GLYPH } from '@/features/shared/glyph/glyphs/feedsGlyph';
import { useTranslation } from '@/i18n/useTranslation';
import type { SharedEventCatalogEntry } from '@/lib/bindings/SharedEventCatalogEntry';
import { useSharedEvents } from './useSharedEvents';
import { FeedIcon, LastChangeCell } from './sharedEventsUi';
import { WatchToggle, HistoryButton } from './SubscribeControls';
import { EventHistoryModal } from './EventHistoryModal';

/**
 * Marketplace — the Watchtower table: a change-activity monitor over the shared
 * curated event feeds (connector API-update feeds). Built on the app's shared
 * UnifiedTable so it matches every other data table (Activity, Event log).
 *
 * Rows default-sort by most-recent change; the Latest-change column carries a
 * summary snippet; subscribing is a "watch" switch; watched feeds are
 * accent-pinned; Category is its own filterable column; a per-row action opens
 * the change-history modal for that feed.
 */
export function SharedEventsTab() {
  const { t } = useTranslation();
  const m = t.triggers.marketplace;
  const { catalog, loading, refresh, subscribe, unsubscribe, subByEntryId, activityBySlug, categories } =
    useSharedEvents();

  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [watchingOnly, setWatchingOnly] = useState(false);
  const [historyEntry, setHistoryEntry] = useState<SharedEventCatalogEntry | null>(null);

  const data = useMemo(() => {
    const q = search.trim().toLowerCase();
    return catalog.filter((e) => {
      if (watchingOnly && !subByEntryId.has(e.id)) return false;
      if (catFilter !== 'all' && e.category !== catFilter) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        e.slug.toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q)
      );
    });
  }, [catalog, search, catFilter, watchingOnly, subByEntryId]);

  const columns = useMemo<TableColumn<SharedEventCatalogEntry>[]>(() => [
    {
      key: 'feed',
      label: m.col_feed,
      width: 'minmax(200px, 1.4fr)',
      sortable: true,
      sortFn: (a, b) => a.name.localeCompare(b.name),
      render: (e) => (
        <div className="flex items-center gap-2.5 min-w-0">
          <FeedIcon entry={e} className="w-8 h-8" />
          <span className="typo-body font-medium text-foreground truncate">{e.name}</span>
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
      width: 'minmax(240px, 1.7fr)',
      sortable: true,
      sortFn: (a, b) =>
        (activityBySlug.get(b.slug)?.lastFiredAt ?? '').localeCompare(
          activityBySlug.get(a.slug)?.lastFiredAt ?? '',
        ),
      render: (e) => <LastChangeCell activity={activityBySlug.get(e.slug)} showSummary />,
    },
    {
      key: 'status',
      label: m.col_status,
      width: '150px',
      render: (e) => (
        <WatchToggle
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
  ], [m, t.common.all, categories, catFilter, activityBySlug, subByEntryId, subscribe, unsubscribe]);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Filter bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-primary/5">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-foreground/50" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.triggers.search_feeds}
            className="w-full pl-8 pr-7 py-1.5 typo-caption rounded-input bg-secondary/50 border border-primary/10 text-foreground placeholder:text-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2">
              <X className="w-3 h-3 text-foreground/60 hover:text-foreground" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <AccessibleToggle
            checked={watchingOnly}
            onChange={() => setWatchingOnly((v) => !v)}
            size="sm"
            label={m.watching_only}
          />
          <span className="typo-caption text-foreground/70">{m.watching_only}</span>
        </div>
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
          rowHeight={52}
          density="compact"
          tableId="shared-events-marketplace"
          ariaLabel={m.view_watchtower}
          isLoading={loading}
          emptyTitle={loading ? t.triggers.loading_catalog : t.triggers.no_feeds}
          emptyDescription={t.triggers.no_feeds_hint}
          emptyGlyph={loading ? undefined : FEEDS_GLYPH}
          defaultSortKey="last_change"
          defaultSortDir="desc"
          rowAccent={(e) => (subByEntryId.has(e.id) ? 'border-l-emerald-400' : undefined)}
        />
      </div>
      {historyEntry && (
        <EventHistoryModal entry={historyEntry} onClose={() => setHistoryEntry(null)} />
      )}
    </div>
  );
}
