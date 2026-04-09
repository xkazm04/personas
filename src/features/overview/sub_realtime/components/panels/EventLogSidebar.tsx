import { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { ChevronRight, ChevronLeft, AlertCircle, CheckCircle2, Clock, Loader2, ArrowRight, Search, ChevronsUp, Radio, List, X } from 'lucide-react';
import type { RealtimeEvent } from '@/hooks/realtime/useRealtimeEvents';
import { EVENT_TYPE_HEX_COLORS } from '@/hooks/realtime/useRealtimeEvents';
import { EVENT_TYPE_LABELS, clampLabel } from '../../libs/visualizationHelpers';
import { useAgentStore } from "@/stores/agentStore";
import { useOverviewTranslation } from '@/features/overview/i18n/useOverviewTranslation';
import { parseEventQuery, matchesQuery } from '../../libs/parseEventQuery';

interface Props {
  events: RealtimeEvent[];
  onSelectEvent: (event: RealtimeEvent | null) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  isMobileDrawer?: boolean;
}

interface LogEntry {
  id: string;
  timestamp: string;
  eventType: string;
  source: string;
  target: string;
  status: string;
  payload: string | null;
  error: string | null;
  color: string;
  isNew?: boolean;
}

const STATUS_ICONS: Record<string, { icon: typeof CheckCircle2; color: string }> = {
  pending: { icon: Clock, color: 'text-amber-400' },
  processing: { icon: Loader2, color: 'text-cyan-400' },
  completed: { icon: CheckCircle2, color: 'text-emerald-400' },
  processed: { icon: CheckCircle2, color: 'text-emerald-400' },
  failed: { icon: AlertCircle, color: 'text-red-400' },
};

function tryParsePayload(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    const keys = Object.keys(obj).slice(0, 3);
    const parts = keys.map(k => {
      const v = obj[k];
      if (typeof v === 'string') return `${k}: "${v.length > 20 ? v.slice(0, 20) + '\u2026' : v}"`;
      return `${k}: ${JSON.stringify(v).slice(0, 20)}`;
    });
    return parts.join(', ') + (Object.keys(obj).length > 3 ? ' \u2026' : '');
  } catch {
    return raw.length > 60 ? raw.slice(0, 60) + '\u2026' : raw;
  }
}

const QUERY_HINT_FIELDS = ['status', 'type', 'source', 'target', 'payload', 'error'] as const;

export default function EventLogSidebar({ events, onSelectEvent, collapsed = false, onToggleCollapse, isMobileDrawer = false }: Props) {
  const allPersonas = useAgentStore(s => s.personas);
  const { t } = useOverviewTranslation();
  const [logSearch, setLogSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const [newEventCount, setNewEventCount] = useState(0);
  const prevLengthRef = useRef(0);
  const [tailMode, setTailMode] = useState(false);
  const [showQueryHint, setShowQueryHint] = useState(false);
  // Track IDs of events that arrived while tail mode is active for highlighting
  const newMatchIdsRef = useRef<Set<string>>(new Set());
  const [highlightedIds, setHighlightedIds] = useState<Set<string>>(new Set());

  const parsedQuery = useMemo(() => parseEventQuery(logSearch), [logSearch]);
  const hasStructuredQuery = parsedQuery.fields.length > 0 || parsedQuery.regexPatterns.length > 0;

  const logEntries: LogEntry[] = useMemo(() => {
    return events.slice(-200).map(evt => {
      const personaName = evt.target_persona_id
        ? allPersonas.find((p: { id: string; name?: string }) => p.id === evt.target_persona_id)?.name ?? evt.target_persona_id.slice(0, 8)
        : '(broadcast)';
      return {
        id: evt.id,
        timestamp: evt.created_at,
        eventType: evt.event_type,
        source: evt.source_id || evt.source_type || 'unknown',
        target: personaName,
        status: evt.status,
        payload: evt.payload ?? null,
        error: evt.error_message ?? null,
        color: EVENT_TYPE_HEX_COLORS[evt.event_type] ?? '#818cf8',
      };
    }).reverse();
  }, [events, allPersonas]);

  const filteredLog = useMemo(() => {
    if (!logSearch.trim()) return logEntries;
    return logEntries.filter(e => matchesQuery(e, parsedQuery));
  }, [logEntries, logSearch, parsedQuery]);

  // Track new events for tail mode highlighting
  useEffect(() => {
    const added = logEntries.length - prevLengthRef.current;
    if (added > 0 && prevLengthRef.current > 0) {
      if (tailMode) {
        // In tail mode: auto-scroll and highlight new matching entries
        if (logRef.current) {
          logRef.current.scrollTop = 0;
        }
        const newIds = new Set<string>();
        for (let i = 0; i < Math.min(added, logEntries.length); i++) {
          const entry = logEntries[i]!;
          if (!logSearch.trim() || matchesQuery(entry, parsedQuery)) {
            newIds.add(entry.id);
          }
        }
        if (newIds.size > 0) {
          newMatchIdsRef.current = newIds;
          setHighlightedIds(newIds);
          // Clear highlights after animation
          setTimeout(() => setHighlightedIds(new Set()), 2000);
        }
      } else if (autoScrollRef.current && logRef.current) {
        logRef.current.scrollTop = 0;
      } else {
        setNewEventCount(prev => prev + added);
      }
    }
    prevLengthRef.current = logEntries.length;
  }, [logEntries, tailMode, logSearch, parsedQuery]);

  const handleLogScroll = () => {
    if (!logRef.current || tailMode) return;
    const atTop = logRef.current.scrollTop < 20;
    autoScrollRef.current = atTop;
    if (atTop) setNewEventCount(0);
  };

  const scrollToNewest = useCallback(() => {
    if (logRef.current) {
      logRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
    setNewEventCount(0);
    autoScrollRef.current = true;
  }, []);

  const toggleTailMode = useCallback(() => {
    setTailMode(prev => {
      const next = !prev;
      if (next) {
        // Entering tail mode — scroll to top, clear badge
        setNewEventCount(0);
        autoScrollRef.current = true;
        if (logRef.current) logRef.current.scrollTop = 0;
      }
      return next;
    });
  }, []);

  // Close mobile drawer on Escape key
  useEffect(() => {
    if (!isMobileDrawer || collapsed) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onToggleCollapse?.();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isMobileDrawer, collapsed, onToggleCollapse]);

  const toggleButton = (
    <button
      onClick={onToggleCollapse}
      className="flex items-center justify-center w-6 h-8 rounded-interactive bg-secondary/60 border border-primary/10 hover:bg-secondary/80 hover:border-primary/20 transition-colors cursor-pointer"
      title={collapsed ? t.eventLog.expand_sidebar : t.eventLog.collapse_sidebar}
    >
      {collapsed ? <ChevronLeft className="w-3.5 h-3.5 text-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-foreground" />}
    </button>
  );

  const sidebarContent = (
    <>
      <div className="px-3 py-2 border-b border-primary/10 flex items-center gap-2">
        <span className="text-sm font-mono font-medium text-muted-foreground/80">{t.eventLog.title}</span>
        <span className="text-xs font-mono text-muted-foreground/40 ml-auto">{filteredLog.length} {t.eventLog.entries}</span>
        {isMobileDrawer && (
          <button onClick={onToggleCollapse} className="p-1 rounded-interactive hover:bg-secondary/50 transition-colors cursor-pointer">
            <X className="w-4 h-4 text-foreground" />
          </button>
        )}
      </div>

      {/* Structured query bar */}
      <div className="px-3 py-1.5 border-b border-primary/5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/40" />
          <input
            type="text"
            value={logSearch}
            onChange={e => setLogSearch(e.target.value)}
            onFocus={() => setShowQueryHint(true)}
            onBlur={() => setTimeout(() => setShowQueryHint(false), 200)}
            placeholder={t.eventLog.query_placeholder}
            className="w-full pl-6 pr-16 py-1 text-xs font-mono bg-secondary/30 border border-primary/10 rounded-md text-foreground/80 placeholder:text-muted-foreground/30 focus-visible:outline-none focus-visible:border-primary/25"
          />
          <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {hasStructuredQuery && (
              <span className="px-1 py-0.5 text-[9px] font-mono rounded bg-primary/15 text-primary border border-primary/20">
                {t.eventLog.structured_badge}
              </span>
            )}
            <button
              onClick={toggleTailMode}
              className={`p-0.5 rounded transition-colors ${
                tailMode
                  ? 'text-emerald-400 bg-emerald-400/10'
                  : 'text-muted-foreground/40 hover:text-muted-foreground/60'
              }`}
              title={tailMode ? t.eventLog.tail_on : t.eventLog.tail_off}
            >
              <Radio className={`w-3.5 h-3.5 ${tailMode ? 'animate-pulse' : ''}`} />
            </button>
          </div>
        </div>

        {/* Query syntax hint popover */}
        {showQueryHint && !logSearch.trim() && (
          <div className="mt-1.5 p-2 rounded-md bg-secondary/60 border border-primary/10 text-[10px] font-mono text-foreground/70 space-y-1">
            <p className="text-muted-foreground/50 uppercase tracking-wider text-[9px]">{t.eventLog.query_syntax}</p>
            {QUERY_HINT_FIELDS.map(f => (
              <p key={f}><span className="text-primary">{f}:</span>value</p>
            ))}
            <p><span className="text-primary">/</span>regex<span className="text-primary">/i</span></p>
            <p className="text-muted-foreground/40 mt-1">{t.eventLog.query_example}</p>
          </div>
        )}
      </div>

      {/* Tail mode indicator */}
      {tailMode && (
        <div className="px-3 py-1 bg-emerald-500/5 border-b border-emerald-500/10 flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
          </span>
          <span className="text-[10px] font-mono text-emerald-400/80">{t.eventLog.tail_active}</span>
        </div>
      )}

      <div className="relative flex-1 overflow-hidden">
        {!tailMode && newEventCount > 0 && (
          <button
            onClick={scrollToNewest}
            className="animate-badge-pulse absolute top-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/90 text-primary-foreground typo-caption font-medium shadow-lg backdrop-blur-sm transition-opacity hover:bg-primary cursor-pointer"
          >
            <ChevronsUp className="w-3.5 h-3.5" />
            {t.eventLog.new_events.replace('{count}', String(newEventCount))}
          </button>
        )}
        <div ref={logRef} onScroll={handleLogScroll} className="h-full overflow-y-auto">
        {filteredLog.length === 0 && (
          <div className="px-3 py-8 text-center">
            <span className="text-xs text-muted-foreground/40 font-mono">
              {logSearch.trim() ? t.eventLog.no_matches : t.eventLog.no_events}
            </span>
          </div>
        )}
        {filteredLog.map(entry => {
            const isExpanded = expandedId === entry.id;
            const statusMeta = STATUS_ICONS[entry.status] ?? STATUS_ICONS.pending!;
            const Icon = statusMeta.icon;
            const payloadPreview = tryParsePayload(entry.payload);
            const isHighlighted = highlightedIds.has(entry.id);
            return (
              <div
                key={entry.id}
                className={`animate-fade-slide-in border-b border-primary/5 last:border-b-0 transition-colors duration-1000 ${
                  isHighlighted ? 'bg-emerald-400/10' : ''
                }`}
              >
                <button
                  onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                  className="w-full px-3 py-1.5 flex items-start gap-2 hover:bg-secondary/30 transition-colors text-left"
                >
                  <div className="flex-shrink-0 mt-0.5">
                    <Icon className={`w-3 h-3 ${statusMeta.color} ${entry.status === 'processing' ? 'animate-spin' : ''}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-mono font-medium" style={{ color: entry.color }}>
                        {EVENT_TYPE_LABELS[entry.eventType] ?? entry.eventType}
                      </span>
                      <ArrowRight className="w-2.5 h-2.5 text-muted-foreground/30 flex-shrink-0" />
                      <span className="text-xs font-mono text-muted-foreground/60 truncate">{entry.target}</span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[10px] font-mono text-muted-foreground/35">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                      <span className="text-[10px] font-mono text-muted-foreground/25">from {clampLabel(entry.source, 15)}</span>
                    </div>
                    {payloadPreview && !isExpanded && (
                      <p className="text-[10px] font-mono text-muted-foreground/30 truncate mt-0.5">{payloadPreview}</p>
                    )}
                  </div>
                  {isHighlighted && (
                    <span className="flex-shrink-0 mt-0.5 px-1 py-0.5 text-[8px] font-mono uppercase tracking-wider rounded bg-emerald-400/15 text-emerald-400 border border-emerald-400/20">
                      {t.eventLog.new_badge}
                    </span>
                  )}
                  <ChevronRight className={`w-3 h-3 text-muted-foreground/20 flex-shrink-0 mt-0.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                </button>

                {isExpanded && (
                    <div
                      className="animate-fade-slide-in overflow-hidden"
                    >
                      <div className="px-3 pb-2 pt-0.5 ml-5 space-y-1.5">
                        <div className="grid grid-cols-2 gap-1">
                          <div>
                            <span className="text-[9px] font-mono uppercase text-muted-foreground/30">Event</span>
                            <p className="text-[10px] font-mono text-foreground/70">{entry.eventType}</p>
                          </div>
                          <div>
                            <span className="text-[9px] font-mono uppercase text-muted-foreground/30">Status</span>
                            <p className={`text-[10px] font-mono ${statusMeta.color}`}>{entry.status}</p>
                          </div>
                          <div>
                            <span className="text-[9px] font-mono uppercase text-muted-foreground/30">Source</span>
                            <p className="text-[10px] font-mono text-foreground/70">{entry.source}</p>
                          </div>
                          <div>
                            <span className="text-[9px] font-mono uppercase text-muted-foreground/30">Target</span>
                            <p className="text-[10px] font-mono text-foreground/70">{entry.target}</p>
                          </div>
                        </div>
                        <div>
                          <span className="text-[9px] font-mono uppercase text-muted-foreground/30">ID</span>
                          <p className="text-[10px] font-mono text-foreground/50 break-all">{entry.id}</p>
                        </div>
                        {entry.error && (
                          <div className="p-1.5 rounded bg-red-500/5 border border-red-500/10">
                            <span className="text-[9px] font-mono uppercase text-red-400/50">Error</span>
                            <p className="text-[10px] font-mono text-red-300/70">{entry.error}</p>
                          </div>
                        )}
                        {entry.payload && (
                          <div>
                            <span className="text-[9px] font-mono uppercase text-muted-foreground/30">Payload</span>
                            <pre className="text-[10px] font-mono text-foreground/50 bg-secondary/30 rounded p-1.5 mt-0.5 max-h-24 overflow-auto whitespace-pre-wrap break-all">
                              {(() => {
                                try { return JSON.stringify(JSON.parse(entry.payload!), null, 2); }
                                catch { return entry.payload; }
                              })()}
                            </pre>
                          </div>
                        )}
                        <button
                          onClick={e => { e.stopPropagation(); const evt = events.find(ev => ev.id === entry.id); if (evt) onSelectEvent(evt); }}
                          className="text-[10px] font-mono text-cyan-400/60 hover:text-cyan-400/90 transition-colors"
                        >
                          Open in detail drawer &rarr;
                        </button>
                      </div>
                    </div>
                  )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );

  // Mobile drawer mode: slide-over from right with backdrop
  if (isMobileDrawer) {
    return (
      <>
        {/* Collapsed: floating open button */}
        {collapsed && (
          <button
            onClick={onToggleCollapse}
            className="absolute top-2 right-2 z-20 flex items-center justify-center w-9 h-9 rounded-interactive bg-secondary/80 border border-primary/10 backdrop-blur-sm hover:bg-secondary hover:border-primary/20 transition-colors cursor-pointer"
            title={t.eventLog.expand_sidebar}
          >
            <List className="w-4 h-4 text-foreground" />
            {filteredLog.length > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center typo-caption font-mono bg-primary text-primary-foreground rounded-full">
                {filteredLog.length > 99 ? '99' : filteredLog.length}
              </span>
            )}
          </button>
        )}
        {/* Drawer overlay */}
        {!collapsed && (
          <div className="absolute inset-0 z-30 flex justify-end">
            <div
              className="flex-1 bg-background/40 backdrop-blur-sm"
              onClick={onToggleCollapse}
            />
            <div className="w-[min(340px,85vw)] flex flex-col bg-background/95 backdrop-blur-md border-l border-primary/10 animate-fade-slide-in">
              {sidebarContent}
            </div>
          </div>
        )}
      </>
    );
  }

  // Desktop collapsed: thin icon strip
  if (collapsed) {
    return (
      <div className="relative flex flex-col items-center w-[48px] border-l border-primary/10 bg-background/50 backdrop-blur-sm transition-all duration-300 ease-out">
        <div className="absolute -left-3 top-3 z-10">{toggleButton}</div>
        <div className="mt-12 flex flex-col items-center gap-3">
          <button
            onClick={onToggleCollapse}
            className="flex items-center justify-center w-8 h-8 rounded-interactive hover:bg-secondary/50 transition-colors cursor-pointer"
            title={t.eventLog.expand_sidebar}
          >
            <List className="w-4 h-4 text-foreground" />
          </button>
          {filteredLog.length > 0 && (
            <span className="typo-caption font-mono text-muted-foreground/60">{filteredLog.length}</span>
          )}
          {tailMode && (
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400" />
            </span>
          )}
        </div>
      </div>
    );
  }

  // Desktop expanded
  return (
    <div className="relative w-[340px] border-l border-primary/10 flex flex-col bg-background/50 backdrop-blur-sm transition-all duration-300 ease-out">
      <div className="absolute -left-3 top-3 z-10">{toggleButton}</div>
      {sidebarContent}
    </div>
  );
}
