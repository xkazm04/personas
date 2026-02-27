import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { Zap, ChevronDown, ChevronUp, RefreshCw, AlertCircle, CheckCircle2, Clock, Loader2, Server, Bot } from 'lucide-react';
import hljs from 'highlight.js/lib/core';
import json from 'highlight.js/lib/languages/json';

hljs.registerLanguage('json', json);
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/ContentLayout';
import { FilterBar } from '@/features/shared/components/FilterBar';
import { UuidLabel } from '@/features/shared/components/UuidLabel';
import { motion, AnimatePresence } from 'framer-motion';
import { useEventBusListener } from '@/hooks/realtime/useEventBusListener';
import { formatRelativeTime, EVENT_STATUS_COLORS, EVENT_TYPE_COLORS } from '@/lib/utils/formatters';
import type { PersonaEvent } from '@/lib/types/types';

type EventFilter = 'all' | 'pending' | 'completed' | 'failed';

function HighlightedJson({ raw }: { raw: string }) {
  const html = useMemo(() => {
    try {
      const pretty = JSON.stringify(JSON.parse(raw), null, 2);
      return hljs.highlight(pretty, { language: 'json' }).value;
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
  const [expandedId, setExpandedId] = useState<string | null>(null);
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

  const filteredEvents = filter === 'all'
    ? recentEvents
    : recentEvents.filter((e: PersonaEvent) => e.status === filter);

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

  return (
    <ContentBox>
      <ContentHeader
        icon={<Zap className="w-5 h-5 text-amber-400" />}
        iconColor="amber"
        title="Events"
        subtitle={`${recentEvents.length} event${recentEvents.length !== 1 ? 's' : ''} recorded`}
        actions={
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="p-1.5 rounded-lg text-muted-foreground/80 hover:text-muted-foreground hover:bg-secondary/50 disabled:opacity-60 transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
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

      {/* Event List */}
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
          <div className="p-4 md:p-6 space-y-2">
          <AnimatePresence initial={false}>
            {filteredEvents.map((event: PersonaEvent) => {
              const isExpanded = expandedId === event.id;
              const defaultStatus = { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' };
              const statusStyle = EVENT_STATUS_COLORS[event.status] ?? defaultStatus;
              const typeColor = EVENT_TYPE_COLORS[event.event_type]?.tailwind ?? 'text-muted-foreground';

              const targetPersona = getPersona(event.target_persona_id);

              return (
                  <motion.div
                  key={event.id}
                    initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                  className="bg-secondary/20 border border-primary/15 rounded-xl overflow-hidden"
                  data-testid={`event-row-${event.id}`}
                >
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : event.id)}
                    className="w-full p-3 flex items-center gap-3 text-left hover:bg-secondary/40 transition-colors"
                    data-testid={`event-row-toggle-${event.id}`}
                  >
                    {/* Status icon */}
                    {event.status === 'completed' || event.status === 'processed' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    ) : event.status === 'failed' ? (
                      <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                    ) : event.status === 'processing' ? (
                      <Loader2 className="w-4 h-4 text-blue-400 animate-spin flex-shrink-0" />
                    ) : (
                      <Clock className="w-4 h-4 text-amber-400 flex-shrink-0" />
                    )}

                    {/* Persona avatar or system icon */}
                    {targetPersona ? (
                      <div
                        className="flex items-center gap-2 min-w-[120px] flex-shrink-0"
                        title={targetPersona.name}
                      >
                        <div
                          className="w-6 h-6 rounded-md flex items-center justify-center text-sm border border-primary/15"
                          style={{ backgroundColor: (targetPersona.color || '#6366f1') + '15' }}
                        >
                          {targetPersona.icon || <Bot className="w-3.5 h-3.5 text-muted-foreground/60" />}
                        </div>
                        <span className="text-sm text-muted-foreground/80 truncate max-w-[80px]">
                          {targetPersona.name}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 min-w-[120px] flex-shrink-0" title="System event">
                        <div className="w-6 h-6 rounded-md flex items-center justify-center border border-primary/10 bg-muted/20">
                          <Server className="w-3.5 h-3.5 text-muted-foreground/50" />
                        </div>
                        <span className="text-sm text-muted-foreground/50 truncate max-w-[80px]">
                          {event.source_type || 'System'}
                        </span>
                      </div>
                    )}

                    {/* Event type */}
                    <span className={`text-sm font-medium ${typeColor} flex-shrink-0`}>
                      {event.event_type}
                    </span>

                    {/* Source info */}
                    <span className="text-sm text-muted-foreground/80 truncate flex-1">
                      {event.source_type}
                    </span>

                    {/* Status badge */}
                    <span className={`text-sm px-2 py-0.5 rounded-md font-medium ${statusStyle.bg} ${statusStyle.text} border ${statusStyle.border} flex-shrink-0`}>
                      {event.status}
                    </span>

                    {/* Time */}
                    <span className="text-sm text-muted-foreground/80 flex-shrink-0 w-16 text-right">
                      {formatRelativeTime(event.created_at)}
                    </span>

                    {/* Chevron */}
                    {isExpanded ? (
                      <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/80 flex-shrink-0" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/80 flex-shrink-0" />
                    )}
                  </button>

                  {/* Expanded Details */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="border-t border-primary/15"
                      >
                        <div className="p-3 space-y-2 text-sm">
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <span className="text-muted-foreground/80">Event ID:</span>
                              <span className="ml-2 text-sm"><UuidLabel value={event.id} /></span>
                            </div>
                            <div>
                              <span className="text-muted-foreground/80">Project:</span>
                              <span className="ml-2 text-sm"><UuidLabel value={event.project_id} /></span>
                            </div>
                            {event.source_id && (
                              <div>
                                <span className="text-muted-foreground/80">Source:</span>
                                <span className="ml-2 text-sm"><UuidLabel value={event.source_id} label={event.source_type || undefined} /></span>
                              </div>
                            )}
                            {event.processed_at && (
                              <div className="rounded-lg border border-primary/10 bg-background/30 px-2.5 py-2">
                                <span className="text-sm font-mono text-muted-foreground/80">Processed</span>
                                <span className="ml-2 text-foreground/80">{new Date(event.processed_at).toLocaleString()}</span>
                              </div>
                            )}
                          </div>
                          {event.payload && (
                            <div>
                              <span className="text-muted-foreground/80 block mb-1">Payload:</span>
                              <HighlightedJson raw={event.payload} />
                            </div>
                          )}
                          {event.error_message && (
                            <div>
                              <span className="text-red-400/70 block mb-1">Error:</span>
                              <pre className="bg-red-500/5 p-2 rounded-lg text-red-400/70 text-sm">
                                {event.error_message}
                              </pre>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </AnimatePresence>
          </div>
        )}
      </ContentBody>
    </ContentBox>
  );
}
