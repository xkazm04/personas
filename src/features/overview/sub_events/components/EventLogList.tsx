import { useState } from 'react';
import { Zap, Activity, RefreshCw, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { AnimatePresence } from 'framer-motion';
import DetailModal from '@/features/overview/components/dashboard/widgets/DetailModal';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { useEventLog } from '../libs/useEventLog';
import { EventGridRow, EventDetailContent } from './EventLogItem';
import ContentLoader from '@/features/shared/components/progress/ContentLoader';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'processing', label: 'Processing' },
  { value: 'completed', label: 'Completed' },
  { value: 'processed', label: 'Processed' },
  { value: 'failed', label: 'Failed' },
  { value: 'skipped', label: 'Skipped' },
];

const GRID_COLS = 'grid-cols-[1fr_1fr_1.2fr_0.8fr_0.8fr]';

export default function EventLogList() {
  const {
    recentEvents, personas, availableTypes,
    statusFilter, setStatusFilter, typeFilter, setTypeFilter,
    toggleSortDirection,
    page, setPage, totalPages,
    selectedEvent, setSelectedEvent,
    selectedPersonaId, setSelectedPersonaId,
    isLoading, isRefreshing,
    filteredEvents, paginatedEvents,
    handleRefresh, getPersona,
  } = useEventLog();

  const [copiedPayload, setCopiedPayload] = useState(false);

  const typeOptions = [
    { value: 'all', label: 'All types' },
    ...availableTypes.map((t) => ({ value: t, label: t.replace(/_/g, ' ') })),
  ];

  const personaOptions = [
    { value: '', label: 'All personas' },
    ...personas.map((p) => ({ value: p.id, label: p.name })),
  ];

  return (
    <ContentBox>
      <ContentHeader
        icon={<Zap className="w-5 h-5 text-amber-400" />}
        iconColor="amber"
        title="Events"
        subtitle={`${filteredEvents.length} of ${recentEvents.length} event${recentEvents.length !== 1 ? 's' : ''}`}
        actions={
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50 disabled:opacity-60 transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        }
      />

      <ContentBody flex>
        {isLoading ? (
          <ContentLoader label="Loading events..." hint="events" />
        ) : filteredEvents.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-4 md:p-6">
            <EmptyState
              icon={Activity}
              title="No events yet"
              description="Events from webhooks, executions, and persona actions will appear here as your agents run."
              iconColor="text-indigo-400/80"
              iconContainerClassName="bg-indigo-500/10 border-indigo-500/20"
            />
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Grid header with inline filter dropdowns */}
            <div className={`grid ${GRID_COLS} gap-0 border-b border-primary/10 bg-background/80 backdrop-blur-sm relative z-20`}>
              <div className="px-2 py-1.5">
                <ThemedSelect
                  filterable
                  options={typeOptions}
                  value={typeFilter}
                  onValueChange={setTypeFilter}
                  placeholder="Type"
                  className="!px-2 !py-1 !text-xs !rounded-lg !border-transparent !bg-transparent hover:!bg-secondary/30 uppercase tracking-wider font-medium"
                />
              </div>
              <div className="px-4 py-2.5 text-xs text-muted-foreground uppercase tracking-wider font-medium">Source</div>
              <div className="px-2 py-1.5">
                <ThemedSelect
                  filterable
                  options={personaOptions}
                  value={selectedPersonaId}
                  onValueChange={(v) => setSelectedPersonaId(v)}
                  placeholder="Persona"
                  className="!px-2 !py-1 !text-xs !rounded-lg !border-transparent !bg-transparent hover:!bg-secondary/30 uppercase tracking-wider font-medium"
                />
              </div>
              <div className="px-2 py-1.5">
                <ThemedSelect
                  filterable
                  options={STATUS_OPTIONS}
                  value={statusFilter}
                  onValueChange={setStatusFilter}
                  placeholder="Status"
                  className="!px-2 !py-1 !text-xs !rounded-lg !border-transparent !bg-transparent hover:!bg-secondary/30 uppercase tracking-wider font-medium"
                />
              </div>
              <button
                onClick={toggleSortDirection}
                className="px-4 py-2.5 text-xs text-muted-foreground uppercase tracking-wider font-medium text-right flex items-center justify-end gap-1 hover:text-foreground transition-colors"
              >
                Created
                <ArrowUpDown className="w-3 h-3" />
              </button>
            </div>

            {/* Rows */}
            <div className="flex-1 overflow-y-auto">
              {paginatedEvents.map((event, idx) => (
                <EventGridRow
                  key={event.id}
                  event={event}
                  index={idx}
                  gridCols={GRID_COLS}
                  getPersona={getPersona}
                  onClick={() => setSelectedEvent(event)}
                />
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-2 border-t border-primary/10 bg-background/60">
                <span className="text-xs text-muted-foreground/80 font-mono">
                  Page {page} of {totalPages}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage(Math.max(1, page - 1))}
                    disabled={page <= 1}
                    className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let p: number;
                    if (totalPages <= 5) {
                      p = i + 1;
                    } else if (page <= 3) {
                      p = i + 1;
                    } else if (page >= totalPages - 2) {
                      p = totalPages - 4 + i;
                    } else {
                      p = page - 2 + i;
                    }
                    return (
                      <button
                        key={p}
                        onClick={() => setPage(p)}
                        className={`w-7 h-7 rounded-lg text-xs font-mono transition-colors ${
                          p === page
                            ? 'bg-primary/10 text-foreground/90 border border-primary/20'
                            : 'text-muted-foreground/80 hover:text-foreground hover:bg-secondary/40'
                        }`}
                      >
                        {p}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => setPage(Math.min(totalPages, page + 1))}
                    disabled={page >= totalPages}
                    className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </ContentBody>

      <AnimatePresence>
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
      </AnimatePresence>
    </ContentBox>
  );
}
