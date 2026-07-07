import { useMemo, useState } from 'react';
import { RefreshCw, Search, X } from 'lucide-react';
import { UnifiedTable, type TableColumn } from '@/features/shared/components/display/UnifiedTable';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { useTranslation } from '@/i18n/useTranslation';
import type { SharedEventCatalogEntry } from '@/lib/bindings/SharedEventCatalogEntry';
import { useSharedEvents } from './useSharedEvents';
import { FeedIcon, LastChangeCell } from './sharedEventsUi';
import { WatchToggle, HistoryButton } from './SubscribeControls';
import { EventHistoryModal } from './EventHistoryModal';

/**
 * Watchtower variant — the marketplace reframed as a *change-activity monitor*.
 * Same UnifiedTable primitive as Registry, but the mental model flips from
 * "browse a catalog" to "watch what's moving": rows default-sort by most-recent
 * change, the Latest-change column carries a summary snippet, subscribing is a
 * "watch" switch (not a pill), watched feeds are accent-pinned, and a
 * "Watching only" filter narrows to your subscriptions.
 */
export function SharedEventsWatchtowerVariant() {
  const { t } = useTranslation();
  const m = t.triggers.marketplace;
  const { catalog, loading, refresh, subscribe, unsubscribe, subByEntryId, activityBySlug } =
    useSharedEvents();

  const [search, setSearch] = useState('');
  const [watchingOnly, setWatchingOnly] = useState(false);
  const [historyEntry, setHistoryEntry] = useState<SharedEventCatalogEntry | null>(null);

  const data = useMemo(() => {
    const q = search.trim().toLowerCase();
    return catalog.filter((e) => {
      if (watchingOnly && !subByEntryId.has(e.id)) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        e.slug.toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q)
      );
    });
  }, [catalog, search, watchingOnly, subByEntryId]);

  const columns = useMemo<TableColumn<SharedEventCatalogEntry>[]>(() => [
    {
      key: 'feed',
      label: m.col_feed,
      width: 'minmax(200px, 1.3fr)',
      sortable: true,
      sortFn: (a, b) => a.name.localeCompare(b.name),
      render: (e) => (
        <div className="flex items-center gap-2.5 min-w-0">
          <FeedIcon entry={e} className="w-8 h-8" />
          <div className="min-w-0">
            <span className="typo-body font-medium text-foreground truncate block">{e.name}</span>
            <span className="typo-caption text-foreground/50 capitalize">{e.category}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'last_change',
      label: m.col_last_change,
      width: 'minmax(260px, 1.8fr)',
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
  ], [m, activityBySlug, subByEntryId, subscribe, unsubscribe]);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Filter bar */}
      <div className="flex items-center gap-3 px-4 py-2">
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
          rowHeight={60}
          density="comfortable"
          tableId="shared-events-watchtower"
          ariaLabel={m.view_watchtower}
          isLoading={loading}
          emptyTitle={loading ? t.triggers.loading_catalog : t.triggers.no_feeds}
          emptyDescription={t.triggers.no_feeds_hint}
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
