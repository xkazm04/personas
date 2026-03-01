import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { Zap, RefreshCw, AlertCircle, CheckCircle2, Clock, Loader2, Server, Bot } from 'lucide-react';
import { useVirtualList } from '@/hooks/utility/useVirtualList';
import hljs from 'highlight.js/lib/core';
import json from 'highlight.js/lib/languages/json';

hljs.registerLanguage('json', json);
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/ContentLayout';
import { FilterBar } from '@/features/shared/components/FilterBar';
import { UuidLabel } from '@/features/shared/components/UuidLabel';
import { AnimatePresence } from 'framer-motion';
import { useEventBusListener } from '@/hooks/realtime/useEventBusListener';
import { formatRelativeTime, EVENT_STATUS_COLORS, EVENT_TYPE_COLORS } from '@/lib/utils/formatters';
import DetailModal from '@/features/overview/components/DetailModal';
import { PersonaSelect } from '@/features/overview/sub_usage/DashboardFilters';
import type { PersonaEvent } from '@/lib/types/types';
import { sanitizeHljsHtml } from '@/lib/utils/sanitizeHtml';

type EventFilter = 'all' | 'pending' | 'completed' | 'failed';

function HighlightedJson({ raw }: { raw: string }) {
  const html = useMemo(() => {
    try {
      const pretty = JSON.stringify(JSON.parse(raw), null, 2);
      return sanitizeHljsHtml(hljs.highlight(pretty, { language: 'json' }).value);
    } catch {
      return null;
    }
  }, [raw]);

  if (!html) {
    return (
      <pre className="bg-background/40 p-2 rounded-lg text-foreground/90 overflow-x-auto max-h-40 text-sm">
        {raw}
      </pre>
    );
  }

  return (
    <pre
      className="json-highlight bg-background/40 p-2 rounded-lg overflow-x-auto max-h-40 text-sm"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default function EventLogList() {
  const recentEvents = usePersonaStore((s) => s.recentEvents);
  const pendingEventCount = usePersonaStore((s) => s.pendingEventCount);
  const fetchRecentEvents = usePersonaStore((s) => s.fetchRecentEvents);
  const personas = usePersonaStore((s) => s.personas);

  const [filter, setFilter] = useState<EventFilter>('all');
  const [selectedEvent, setSelectedEvent] = useState<PersonaEvent | null>(null);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const liveEventIds = useRef<Set<string>>(new Set());

  // Initial fetch for historical events
  useEffect(() => {
    let active = true;
    const load = async () => {
      setIsLoading(true);
      try {
        await fetchRecentEvents(100);
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [fetchRecentEvents]);

  // Listen to Tauri event-bus for push updates
  const handleBusEvent = useCallback((evt: PersonaEvent) => {
    liveEventIds.current.add(evt.id);
    // Trim to prevent unbounded growth
    if (liveEventIds.current.size > 250) {
      const entries = [...liveEventIds.current];
      liveEventIds.current = new Set(entries.slice(-200));
    }
    usePersonaStore.setState((state) => {
      const exists = state.recentEvents.some((e: PersonaEvent) => e.id === evt.id);
      if (exists) return state;
      const next = [evt, ...state.recentEvents].slice(0, 200);
      return {
        recentEvents: next,
        pendingEventCount: next.filter((e: PersonaEvent) => e.status === 'pending').length,
      };
    });
  }, []);
  useEventBusListener(handleBusEvent);

  const filteredEvents = useMemo(() => {
    let events = recentEvents;
    if (filter !== 'all') {
      events = events.filter((e: PersonaEvent) => e.status === filter);
    }
    if (selectedPersonaId) {
      events = events.filter((e: PersonaEvent) => e.target_persona_id === selectedPersonaId);
    }
    return events;
  }, [recentEvents, filter, selectedPersonaId]);

  const { parentRef, virtualizer } = useVirtualList(filteredEvents, 44);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await fetchRecentEvents(100);
    } finally {
      setIsRefreshing(false);
    }
  };

  const getPersona = (id: string | null) => {
    if (!id) return null;
    return personas.find((persona) => persona.id === id) ?? null;
  };

  const defaultStatus = { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' };

  return (
    <ContentBox>
      <ContentHeader
        icon={<Zap className="w-5 h-5 text-amber-400" />}
        iconColor="amber"
        title="Events"
        subtitle={`${recentEvents.length} event${recentEvents.length !== 1 ? 's' : ''} recorded`}
        actions={
          <div className="flex items-center gap-2">
            <PersonaSelect
              value={selectedPersonaId}
              onChange={setSelectedPersonaId}
              personas={personas}
            />
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

      {/* Filter bar */}
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

      {/* Event Table */}
      <ContentBody flex>
        {isLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center p-4 md:p-6 text-muted-foreground/80">
            <Loader2 className="w-8 h-8 mb-3 animate-spin text-primary/70" />
            <p className="text-sm">Loading events...</p>
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-4 md:p-6 text-muted-foreground/80">
            <Zap className="w-10 h-10 mb-3" />
            <p className="text-sm">No events yet</p>
            <p className="text-sm mt-1">Events from webhooks, executions, and persona actions will appear here</p>
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
                    const statusStyle = EVENT_STATUS_COLORS[event.status] ?? defaultStatus;
                    const typeColor = EVENT_TYPE_COLORS[event.event_type]?.tailwind ?? 'text-muted-foreground';
                    const targetPersona = getPersona(event.target_persona_id);

                    return (
                      <tr
                        key={event.id}
                        data-testid={`event-row-${event.id}`}
                        onClick={() => setSelectedEvent(event)}
                        className="hover:bg-white/[0.03] cursor-pointer transition-colors border-b border-primary/5"
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          height: `${virtualRow.size}px`,
                          transform: `translateY(${virtualRow.start}px)`,
                          display: 'table',
                          tableLayout: 'fixed',
                        }}
                      >
                        {/* Type */}
                        <td className="px-4 py-2.5">
                          <span className={`text-sm font-medium ${typeColor}`}>
                            {event.event_type}
                          </span>
                        </td>

                        {/* Source */}
                        <td className="px-4 py-2.5">
                          <span className="text-sm text-muted-foreground/80 truncate block">
                            {event.source_type}
                          </span>
                        </td>

                        {/* Persona */}
                        <td className="px-4 py-2.5">
                          {targetPersona ? (
                            <div className="flex items-center gap-2">
                              <div
                                className="w-6 h-6 rounded-md flex items-center justify-center text-sm border border-primary/15 flex-shrink-0"
                                style={{ backgroundColor: (targetPersona.color || '#6366f1') + '15' }}
                              >
                                {targetPersona.icon || <Bot className="w-3.5 h-3.5 text-muted-foreground/60" />}
                              </div>
                              <span className="text-sm text-muted-foreground/80 truncate">
                                {targetPersona.name}
                              </span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-md flex items-center justify-center border border-primary/10 bg-muted/20 flex-shrink-0">
                                <Server className="w-3.5 h-3.5 text-muted-foreground/50" />
                              </div>
                              <span className="text-sm text-muted-foreground/50 truncate">
                                {event.source_type || 'System'}
                              </span>
                            </div>
                          )}
                        </td>

                        {/* Status */}
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex items-center gap-1.5 text-sm px-2 py-0.5 rounded-md font-medium ${statusStyle.bg} ${statusStyle.text} border ${statusStyle.border}`}>
                            {event.status === 'completed' || event.status === 'processed' ? (
                              <CheckCircle2 className="w-3 h-3" />
                            ) : event.status === 'failed' ? (
                              <AlertCircle className="w-3 h-3" />
                            ) : event.status === 'processing' ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Clock className="w-3 h-3" />
                            )}
                            {event.status}
                          </span>
                        </td>

                        {/* Created */}
                        <td className="px-4 py-2.5 text-right">
                          <span className="text-sm text-muted-foreground/80">
                            {formatRelativeTime(event.created_at)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </ContentBody>

      {/* Detail Modal */}
      <AnimatePresence>
        {selectedEvent && (
          <DetailModal
            title={`Event: ${selectedEvent.event_type}`}
            subtitle={`Status: ${selectedEvent.status}`}
            onClose={() => setSelectedEvent(null)}
          >
            <div className="space-y-4">
              {/* IDs & metadata */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-sm text-muted-foreground/80 block mb-0.5">Event ID</span>
                  <span className="text-sm"><UuidLabel value={selectedEvent.id} /></span>
                </div>
                <div>
                  <span className="text-sm text-muted-foreground/80 block mb-0.5">Project</span>
                  <span className="text-sm"><UuidLabel value={selectedEvent.project_id} /></span>
                </div>
                {selectedEvent.source_id && (
                  <div>
                    <span className="text-sm text-muted-foreground/80 block mb-0.5">Source</span>
                    <span className="text-sm">
                      <UuidLabel value={selectedEvent.source_id} label={selectedEvent.source_type || undefined} />
                    </span>
                  </div>
                )}
                {selectedEvent.processed_at && (
                  <div className="rounded-lg border border-primary/10 bg-background/30 px-2.5 py-2">
                    <span className="text-sm font-mono text-muted-foreground/80">Processed</span>
                    <span className="ml-2 text-sm text-foreground/80">
                      {new Date(selectedEvent.processed_at).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>

              {/* Payload */}
              {selectedEvent.payload && (
                <div>
                  <span className="text-sm text-muted-foreground/80 block mb-1">Payload</span>
                  <HighlightedJson raw={selectedEvent.payload} />
                </div>
              )}

              {/* Error */}
              {selectedEvent.error_message && (
                <div>
                  <span className="text-sm text-red-400/70 block mb-1">Error</span>
                  <pre className="bg-red-500/5 p-2 rounded-lg text-red-400/70 text-sm whitespace-pre-wrap">
                    {selectedEvent.error_message}
                  </pre>
                </div>
              )}
            </div>
          </DetailModal>
        )}
      </AnimatePresence>
    </ContentBox>
  );
}
