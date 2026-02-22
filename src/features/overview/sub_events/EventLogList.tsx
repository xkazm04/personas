import { useEffect, useState, useCallback } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { Zap, ChevronDown, ChevronUp, RefreshCw, AlertCircle, CheckCircle2, Clock, Loader2 } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/ContentLayout';
import { UuidLabel } from '@/features/shared/components/UuidLabel';
import { motion, AnimatePresence } from 'framer-motion';
import { useEventBusListener } from '@/hooks/realtime/useEventBusListener';
import { formatRelativeTime, EVENT_STATUS_COLORS, EVENT_TYPE_COLORS } from '@/lib/utils/formatters';
import type { PersonaEvent } from '@/lib/types/types';

type EventFilter = 'all' | 'pending' | 'completed' | 'failed';

export default function EventLogList() {
  const recentEvents = usePersonaStore((s) => s.recentEvents);
  const pendingEventCount = usePersonaStore((s) => s.pendingEventCount);
  const fetchRecentEvents = usePersonaStore((s) => s.fetchRecentEvents);
  const personas = usePersonaStore((s) => s.personas);

  const [filter, setFilter] = useState<EventFilter>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

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

  const getPersonaName = (id: string | null) => {
    if (!id) return null;
    const p = personas.find((persona) => persona.id === id);
    return p?.name || id.slice(0, 12) + '...';
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
            className="p-1.5 rounded-lg text-muted-foreground/40 hover:text-muted-foreground hover:bg-secondary/50 disabled:opacity-60 transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        }
      />

      {/* Filter bar */}
      <div className="px-4 md:px-6 py-3 border-b border-primary/10 flex items-center gap-2 flex-shrink-0">
        {(['all', 'pending', 'completed', 'failed'] as EventFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
              filter === f
                ? 'bg-primary/15 text-primary border-primary/30'
                : 'bg-secondary/30 text-muted-foreground/60 border-primary/15 hover:text-muted-foreground hover:bg-secondary/50'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
            {f === 'pending' && pendingEventCount > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 text-[11px] rounded-full bg-amber-500/20 text-amber-400">
                {pendingEventCount}
              </span>
            )}
          </button>
        ))}
        <span className="ml-auto text-[11px] font-mono text-muted-foreground/40">
          Showing {filteredEvents.length} of {recentEvents.length}
        </span>
      </div>

      {/* Event List */}
      <ContentBody flex>
        {isLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center p-4 md:p-6 text-muted-foreground/40">
            <Loader2 className="w-8 h-8 mb-3 animate-spin text-primary/70" />
            <p className="text-sm">Loading events...</p>
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-4 md:p-6 text-muted-foreground/30">
            <Zap className="w-10 h-10 mb-3" />
            <p className="text-sm">No events yet</p>
            <p className="text-xs mt-1">Events from webhooks, executions, and persona actions will appear here</p>
          </div>
        ) : (
          <div className="p-4 md:p-6 space-y-2">
          <AnimatePresence initial={false}>
            {filteredEvents.map((event: PersonaEvent) => {
              const isExpanded = expandedId === event.id;
              const defaultStatus = { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' };
              const statusStyle = EVENT_STATUS_COLORS[event.status] ?? defaultStatus;
              const typeColor = EVENT_TYPE_COLORS[event.event_type]?.tailwind ?? 'text-muted-foreground';

              return (
                  <motion.div
                  key={event.id}
                    initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                  className="bg-secondary/20 border border-primary/15 rounded-xl overflow-hidden"
                >
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : event.id)}
                    className="w-full p-3 flex items-center gap-3 text-left hover:bg-secondary/40 transition-colors"
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

                    {/* Event type */}
                    <span className={`text-xs font-medium ${typeColor} flex-shrink-0`}>
                      {event.event_type}
                    </span>

                    {/* Source -> Target */}
                    <span className="text-xs text-muted-foreground/40 truncate flex-1">
                      {event.source_type}
                      {event.target_persona_id ? ` -> ${getPersonaName(event.target_persona_id)}` : ''}
                    </span>

                    {/* Status badge */}
                    <span className={`text-[11px] px-2 py-0.5 rounded-md font-medium ${statusStyle.bg} ${statusStyle.text} border ${statusStyle.border} flex-shrink-0`}>
                      {event.status}
                    </span>

                    {/* Time */}
                    <span className="text-[11px] text-muted-foreground/30 flex-shrink-0 w-16 text-right">
                      {formatRelativeTime(event.created_at)}
                    </span>

                    {/* Chevron */}
                    {isExpanded ? (
                      <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/30 flex-shrink-0" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/30 flex-shrink-0" />
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
                        <div className="p-3 space-y-2 text-xs">
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <span className="text-muted-foreground/40">Event ID:</span>
                              <span className="ml-2 text-xs"><UuidLabel value={event.id} /></span>
                            </div>
                            <div>
                              <span className="text-muted-foreground/40">Project:</span>
                              <span className="ml-2 text-xs"><UuidLabel value={event.project_id} /></span>
                            </div>
                            {event.source_id && (
                              <div>
                                <span className="text-muted-foreground/40">Source:</span>
                                <span className="ml-2 text-xs"><UuidLabel value={event.source_id} label={event.source_type || undefined} /></span>
                              </div>
                            )}
                            {event.processed_at && (
                              <div className="rounded-lg border border-primary/10 bg-background/30 px-2.5 py-2">
                                <span className="text-[11px] font-mono text-muted-foreground/40">Processed</span>
                                <span className="ml-2 text-foreground/60">{new Date(event.processed_at).toLocaleString()}</span>
                              </div>
                            )}
                          </div>
                          {event.payload && (
                            <div>
                              <span className="text-muted-foreground/40 block mb-1">Payload:</span>
                              <pre className="bg-background/40 p-2 rounded-lg text-foreground/50 overflow-x-auto max-h-40 text-[11px]">
                                {(() => {
                                  try {
                                    return JSON.stringify(JSON.parse(event.payload), null, 2);
                                  } catch {
                                    return event.payload;
                                  }
                                })()}
                              </pre>
                            </div>
                          )}
                          {event.error_message && (
                            <div>
                              <span className="text-red-400/70 block mb-1">Error:</span>
                              <pre className="bg-red-500/5 p-2 rounded-lg text-red-400/70 text-[11px]">
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
