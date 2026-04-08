import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Zap, RefreshCw, AlertCircle, CheckCircle2, Clock, Plus, Search, Bookmark, BookmarkX, X, BookOpen, Loader2 } from 'lucide-react';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { useSystemStore } from '@/stores/systemStore';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import DetailModal from '@/features/overview/components/dashboard/widgets/DetailModal';
import { UnifiedTable, type TableColumn } from '@/features/shared/components/display/UnifiedTable';
import { PersonaColumnFilter } from '@/features/shared/components/forms/PersonaColumnFilter';
import { ColumnDropdownFilter } from '@/features/shared/components/forms/ColumnDropdownFilter';
import { formatRelativeTime, EVENT_STATUS_COLORS, EVENT_TYPE_COLORS } from '@/lib/utils/formatters';
import type { PersonaEvent } from '@/lib/types/types';
import { seedMockEvent } from '@/api/overview/events';
import { useEventLog } from '../libs/useEventLog';
import { EventDetailContent } from './EventLogItem';
import { createLogger } from "@/lib/log";

const logger = createLogger("event-log");

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'pending', label: 'Pending' },
  { value: 'processed', label: 'Processed' },
  { value: 'processing', label: 'Processing' },
  { value: 'skipped', label: 'Skipped' },
];

const SOURCE_TYPE_LABELS: Record<string, string> = {
  persona: 'Event',
  user: 'Manual',
  system: 'System',
  scheduler: 'Scheduled',
};

const defaultStatus = { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' };

export default function EventLogList() {
  const {
    recentEvents, personas, availableTypes,
    statusFilter, setStatusFilter, typeFilter, setTypeFilter,
    sortDirection: _sortDirection, toggleSortDirection: _toggleSortDirection,
    selectedEvent, setSelectedEvent,
    selectedPersonaId, setSelectedPersonaId,
    isLoading, isRefreshing, isSearching,
    filteredEvents,
    handleRefresh, getPersona,
    // Search
    searchText, setSearchText, serverHasMore,
    // Cursor pagination
    loadOlder, hasMoreOlder, isLoadingOlder,
    // Saved views
    savedViews, activeViewId, saveCurrentView, applySavedView, removeSavedView, clearFilters,
  } = useEventLog();

  // Auto-load older events when the sentinel scrolls into view
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!hasMoreOlder || isLoadingOlder) return;
    const node = loadMoreSentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadOlder();
      },
      { rootMargin: '200px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMoreOlder, isLoadingOlder, loadOlder, filteredEvents.length]);

  const [copiedPayload, setCopiedPayload] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [viewName, setViewName] = useState('');
  const [triggerFilter, setTriggerFilter] = useState<string>('all');

  const handleSeedEvent = useCallback(async () => {
    try { await seedMockEvent(); await handleRefresh(); }
    catch (err) { logger.error('Failed to seed mock event', { error: err }); }
  }, [handleRefresh]);

  // Apply client-side trigger filter on top of server-filtered events
  const displayedEvents = useMemo(() => {
    if (triggerFilter === 'all') return filteredEvents;
    return filteredEvents.filter((e) => e.source_type === triggerFilter);
  }, [filteredEvents, triggerFilter]);

  // Unique trigger (source_type) values from current data for dropdown
  const triggerOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const e of filteredEvents) unique.add(e.source_type);
    const items = Array.from(unique)
      .sort((a, b) => (SOURCE_TYPE_LABELS[a] ?? a).localeCompare(SOURCE_TYPE_LABELS[b] ?? b))
      .map((v) => ({ value: v, label: SOURCE_TYPE_LABELS[v] ?? v }));
    return [{ value: 'all', label: 'All triggers' }, ...items];
  }, [filteredEvents]);

  const hasActiveFilters = statusFilter !== 'all' || typeFilter !== 'all' || selectedPersonaId || searchText.trim() || triggerFilter !== 'all';

  const handleSaveView = async () => {
    if (!viewName.trim()) return;
    await saveCurrentView(viewName.trim());
    setViewName('');
    setShowSaveDialog(false);
  };

  const typeOptions = [
    { value: 'all', label: 'All types' },
    ...[...availableTypes].sort((a, b) => a.localeCompare(b)).map((t) => ({ value: t, label: t.replace(/_/g, ' ') })),
  ];


  const columns: TableColumn<PersonaEvent>[] = [
    {
      key: 'trigger',
      label: 'Trigger',
      width: 'minmax(100px, 0.6fr)',
      filterComponent: (
        <ColumnDropdownFilter
          label="Trigger"
          value={triggerFilter}
          options={triggerOptions}
          onChange={setTriggerFilter}
        />
      ),
      render: (event) => {
        const label = SOURCE_TYPE_LABELS[event.source_type] ?? event.source_type;
        return <span className="text-sm text-foreground/70">{label}</span>;
      },
    },
    {
      key: 'persona',
      label: 'Persona',
      width: 'minmax(160px, 1fr)',
      filterComponent: (
        <PersonaColumnFilter
          value={selectedPersonaId}
          onChange={(v) => setSelectedPersonaId(v)}
          personas={personas}
        />
      ),
      render: (event) => {
        const targetPersona = getPersona(event.target_persona_id);
        if (targetPersona) {
          return <span className="text-sm text-foreground truncate">{targetPersona.name}</span>;
        }
        // Strip "persona:" prefix from source_type values
        const raw = event.source_type || '';
        const display = raw.startsWith('persona:') ? raw.slice(8) : '';
        return display
          ? <span className="text-sm text-foreground/70 truncate">{display}</span>
          : <span className="text-sm text-muted-foreground/40">—</span>;
      },
    },
    {
      key: 'type',
      label: 'Event Name',
      width: 'minmax(180px, 1.2fr)',
      filterOptions: typeOptions,
      filterValue: typeFilter,
      onFilterChange: setTypeFilter,
      render: (event) => {
        const typeColor = EVENT_TYPE_COLORS[event.event_type]?.tailwind ?? 'text-foreground/80';
        return <span className={`typo-heading truncate ${typeColor}`}>{event.event_type}</span>;
      },
    },
    {
      key: 'status',
      label: 'Status',
      width: 'minmax(140px, 0.8fr)',
      filterOptions: STATUS_OPTIONS,
      filterValue: statusFilter,
      onFilterChange: setStatusFilter,
      render: (event) => {
        const statusStyle = EVENT_STATUS_COLORS[event.status] ?? defaultStatus;
        const statusIcon = event.status === 'completed' || event.status === 'delivered'
          ? <CheckCircle2 className="w-3 h-3" />
          : event.status === 'failed' ? <AlertCircle className="w-3 h-3" />
            : event.status === 'processing' ? <LoadingSpinner size="xs" />
              : <Clock className="w-3 h-3" />;
        return (
          <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-lg font-medium ${statusStyle.bg} ${statusStyle.text} border ${statusStyle.border}`}>
            {statusIcon}
            {event.status}
          </span>
        );
      },
    },
    {
      key: 'created',
      label: 'Created',
      width: 'minmax(120px, 0.8fr)',
      sortable: true,
      align: 'right' as const,
      render: (event) => (
        <span className="text-sm text-foreground">{formatRelativeTime(event.created_at)}</span>
      ),
    },
  ];

  return (
    <ContentBox>
      <ContentHeader
        icon={<Zap className="w-5 h-5 text-status-warning" />}
        iconColor="amber"
        title="Events"
        subtitle={`${filteredEvents.length}${serverHasMore ? '+' : ''} of ${recentEvents.length} event${recentEvents.length !== 1 ? 's' : ''}`}
        actions={
          <div className="flex items-center gap-2">
            {import.meta.env.DEV && (
              <button onClick={handleSeedEvent} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl typo-heading bg-amber-500/10 text-amber-400 border border-amber-500/25 hover:bg-amber-500/20 transition-colors" title="Seed a mock event (dev only)">
                <Plus className="w-3.5 h-3.5" /> Mock Event
              </button>
            )}
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="p-1.5 rounded-lg text-foreground/70 hover:text-foreground hover:bg-secondary/50 disabled:opacity-60 transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        }
      />

      {/* Search bar + saved views */}
      <div className="px-4 pb-2 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/40" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search events by type, source, or payload..."
              className="w-full pl-8 pr-8 py-1.5 text-sm rounded-lg bg-secondary/30 border border-primary/10 text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-primary/30 transition-colors"
            />
            {searchText && (
              <button
                onClick={() => setSearchText('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-foreground/40 hover:text-foreground/70"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {isSearching && <LoadingSpinner size="xs" />}
          {hasActiveFilters && (
            <>
              <button
                onClick={() => setShowSaveDialog(true)}
                className="flex items-center gap-1 px-2 py-1.5 text-xs rounded-lg bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors whitespace-nowrap"
                title="Save current filters as a view"
              >
                <Bookmark className="w-3 h-3" /> Save view
              </button>
              <button
                onClick={clearFilters}
                className="flex items-center gap-1 px-2 py-1.5 text-xs rounded-lg bg-secondary/40 text-foreground/70 border border-primary/10 hover:bg-secondary/60 transition-colors whitespace-nowrap"
                title="Clear all filters"
              >
                <X className="w-3 h-3" /> Clear
              </button>
            </>
          )}
        </div>

        {/* Saved views chips */}
        {savedViews.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-foreground/50">Views:</span>
            {savedViews.map((view) => (
              <button
                key={view.id}
                onClick={() => applySavedView(view)}
                className={`group flex items-center gap-1 px-2 py-0.5 text-xs rounded-lg border transition-colors ${activeViewId === view.id
                    ? 'bg-primary/15 text-primary border-primary/30'
                    : 'bg-secondary/30 text-foreground/70 border-primary/10 hover:bg-secondary/50'
                  }`}
              >
                <Bookmark className="w-2.5 h-2.5" />
                {view.name}
                <button
                  onClick={(e) => { e.stopPropagation(); removeSavedView(view.id); }}
                  className="ml-0.5 opacity-0 group-hover:opacity-100 text-foreground/40 hover:text-status-error transition-opacity"
                  title="Delete view"
                >
                  <BookmarkX className="w-2.5 h-2.5" />
                </button>
              </button>
            ))}
          </div>
        )}

        {/* Save view dialog */}
        {showSaveDialog && (
          <div className="flex items-center gap-2 p-2 rounded-lg bg-secondary/40 border border-primary/10">
            <input
              type="text"
              value={viewName}
              onChange={(e) => setViewName(e.target.value)}
              placeholder="View name (e.g. 'Failed webhooks this week')"
              className="flex-1 px-2 py-1 text-sm rounded bg-background/50 border border-primary/10 text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-primary/30"
              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveView(); if (e.key === 'Escape') setShowSaveDialog(false); }}
              autoFocus
            />
            <button
              onClick={handleSaveView}
              disabled={!viewName.trim()}
              className="px-3 py-1 text-xs rounded-lg bg-primary/15 text-primary border border-primary/25 hover:bg-primary/25 disabled:opacity-40 transition-colors"
            >
              Save
            </button>
            <button
              onClick={() => { setShowSaveDialog(false); setViewName(''); }}
              className="px-2 py-1 text-xs rounded-lg text-foreground/60 hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      <ContentBody flex>
        {!isLoading && displayedEvents.length === 0 && !hasActiveFilters ? (
          <div className="flex-1 flex items-center justify-center p-6">
            <EmptyState
              icon={Zap}
              title="No events yet"
              subtitle="Events from webhooks, executions, and persona actions will appear here as your agents run."
              iconColor="text-amber-400/80"
              iconContainerClassName="bg-amber-500/10 border-amber-500/20"
              action={{ label: 'Create Persona', onClick: () => useSystemStore.getState().setSidebarSection('personas'), icon: Plus }}
              secondaryAction={{ label: 'From Templates', onClick: () => useSystemStore.getState().setSidebarSection('design-reviews'), icon: BookOpen }}
            />
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0">
            <UnifiedTable<PersonaEvent>
              columns={columns}
              data={displayedEvents}
              getRowKey={(e) => e.id}
              onRowClick={setSelectedEvent}
              isLoading={isLoading}
              emptyTitle="No events match current filters"
              rowHeight={44}
              className="flex-1"
            />
            {(hasMoreOlder || isLoadingOlder) && displayedEvents.length > 0 && (
              <div ref={loadMoreSentinelRef} className="flex items-center justify-center py-2 border-t border-primary/5">
                {isLoadingOlder ? (
                  <span className="flex items-center gap-2 text-xs text-muted-foreground/60">
                    <Loader2 className="w-3 h-3 animate-spin" /> Loading older events…
                  </span>
                ) : (
                  <button
                    onClick={loadOlder}
                    className="text-xs text-muted-foreground/60 hover:text-foreground transition-colors"
                  >
                    Load older events
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </ContentBody>

      {selectedEvent && (
        <DetailModal
          title={`Event: ${selectedEvent.event_type}`}
          subtitle={`Status: ${selectedEvent.status}`}
          onClose={() => { setSelectedEvent(null); setCopiedPayload(false); }}
        >
          <EventDetailContent
            event={selectedEvent}
            copiedPayload={copiedPayload}
            setCopiedPayload={setCopiedPayload}
          />
        </DetailModal>
      )}
    </ContentBox>
  );
}
