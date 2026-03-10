import { Zap, Activity, RefreshCw } from 'lucide-react';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { useVirtualList } from '@/hooks/utility/interaction/useVirtualList';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { FilterBar } from '@/features/shared/components/overlays/FilterBar';
import { AnimatePresence } from 'framer-motion';
import DetailModal from '@/features/overview/components/dashboard/widgets/DetailModal';
import { PersonaSelect } from '@/features/overview/sub_usage/components/PersonaSelect';
import { useEventLog, type EventFilter } from '../libs/useEventLog';
import { EventRow, EventDetailContent } from './EventLogItem';
import ContentLoader from '@/features/shared/components/progress/ContentLoader';

export default function EventLogList() {
  const {
    recentEvents, pendingEventCount, personas,
    filter, setFilter,
    selectedEvent, setSelectedEvent,
    selectedPersonaId, setSelectedPersonaId,
    isLoading, isRefreshing,
    copiedPayload, setCopiedPayload,
    filteredEvents,
    handleRefresh, getPersona,
  } = useEventLog();

  const { parentRef, virtualizer } = useVirtualList(filteredEvents, 44);

  return (
    <ContentBox>
      <ContentHeader
        icon={<Zap className="w-5 h-5 text-amber-400" />}
        iconColor="amber"
        title="Events"
        subtitle={`${recentEvents.length} event${recentEvents.length !== 1 ? 's' : ''} recorded`}
        actions={
          <div className="flex items-center gap-2">
            <PersonaSelect value={selectedPersonaId} onChange={setSelectedPersonaId} personas={personas} />
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="p-1.5 rounded-lg text-muted-foreground/80 hover:text-muted-foreground hover:bg-secondary/50 disabled:opacity-60 transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        }
      />

      <FilterBar<EventFilter>
        options={[
          { id: 'all', label: 'All' },
          { id: 'pending', label: 'Pending', badge: pendingEventCount },
          { id: 'completed', label: 'Completed' },
          { id: 'failed', label: 'Failed' },
        ]}
        value={filter}
        onChange={setFilter}
        layoutIdPrefix="event-filter"
        summary={`Showing ${filteredEvents.length} of ${recentEvents.length}`}
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
          <div className="flex-1 overflow-hidden flex flex-col">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-10 bg-background/80 backdrop-blur-sm">
                <tr className="border-b border-primary/10">
                  <th className="text-left px-4 py-2.5 text-sm text-muted-foreground/80 uppercase tracking-wider font-medium">Type</th>
                  <th className="text-left px-4 py-2.5 text-sm text-muted-foreground/80 uppercase tracking-wider font-medium">Source</th>
                  <th className="text-left px-4 py-2.5 text-sm text-muted-foreground/80 uppercase tracking-wider font-medium">Persona</th>
                  <th className="text-left px-4 py-2.5 text-sm text-muted-foreground/80 uppercase tracking-wider font-medium">Status</th>
                  <th className="text-right px-4 py-2.5 text-sm text-muted-foreground/80 uppercase tracking-wider font-medium">Created</th>
                </tr>
              </thead>
            </table>
            <div ref={parentRef} className="flex-1 overflow-y-auto">
              <table className="w-full border-collapse">
                <tbody style={{ height: `${virtualizer.getTotalSize()}px`, display: 'block', position: 'relative' }}>
                  {virtualizer.getVirtualItems().map((virtualRow) => {
                    const event = filteredEvents[virtualRow.index]!;
                    return (
                      <EventRow
                        key={event.id}
                        event={event}
                        index={virtualRow.index}
                        start={virtualRow.start}
                        size={virtualRow.size}
                        getPersona={getPersona}
                        onClick={() => setSelectedEvent(event)}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
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
