import { useMemo, useRef, useEffect, useState } from 'react';
import { ChevronRight, AlertCircle, CheckCircle2, Clock, Loader2, ArrowRight, Search } from 'lucide-react';
import type { RealtimeEvent } from '@/hooks/realtime/useRealtimeEvents';
import { EVENT_TYPE_HEX_COLORS } from '@/hooks/realtime/useRealtimeEvents';
import { EVENT_TYPE_LABELS, clampLabel } from '../../libs/visualizationHelpers';
import { useAgentStore } from "@/stores/agentStore";
import { useTranslation } from '@/i18n/useTranslation';

interface Props {
  events: RealtimeEvent[];
  onSelectEvent: (event: RealtimeEvent | null) => void;
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

export default function EventLogSidebar({ events, onSelectEvent }: Props) {
  const { t } = useTranslation();
  const allPersonas = useAgentStore(s => s.personas);
  const [logSearch, setLogSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

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
    const q = logSearch.toLowerCase();
    return logEntries.filter(e =>
      e.eventType.toLowerCase().includes(q) ||
      e.source.toLowerCase().includes(q) ||
      e.target.toLowerCase().includes(q) ||
      e.status.toLowerCase().includes(q) ||
      (e.payload && e.payload.toLowerCase().includes(q))
    );
  }, [logEntries, logSearch]);

  useEffect(() => {
    if (autoScrollRef.current && logRef.current) {
      logRef.current.scrollTop = 0;
    }
  }, [logEntries.length]);

  const handleLogScroll = () => {
    if (!logRef.current) return;
    autoScrollRef.current = logRef.current.scrollTop < 20;
  };

  return (
    <div className="w-[340px] border-l border-primary/10 flex flex-col bg-background/50 backdrop-blur-sm">
      <div className="px-3 py-2 border-b border-primary/10 flex items-center gap-2">
        <span className="typo-code font-mono font-medium text-foreground">{t.overview.event_log_sidebar.title}</span>
        <span className="typo-code font-mono text-foreground ml-auto">{filteredLog.length} entries</span>
      </div>

      <div className="px-3 py-1.5 border-b border-primary/5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-foreground" />
          <input
            type="text"
            value={logSearch}
            onChange={e => setLogSearch(e.target.value)}
            placeholder={t.overview.event_log_sidebar.filter_placeholder}
            className="w-full pl-6 pr-2 py-1 typo-code font-mono bg-secondary/30 border border-primary/10 rounded-input text-foreground placeholder:text-foreground focus-visible:outline-none focus-visible:border-primary/25"
          />
        </div>
      </div>

      <div ref={logRef} onScroll={handleLogScroll} className="flex-1 overflow-y-auto">
        {filteredLog.length === 0 && (
          <div className="px-3 py-8 text-center">
            <span className="typo-code text-foreground font-mono">{t.overview.event_log_sidebar.no_events}</span>
          </div>
        )}
        {filteredLog.map(entry => {
            const isExpanded = expandedId === entry.id;
            const statusMeta = STATUS_ICONS[entry.status] ?? STATUS_ICONS.pending!;
            const Icon = statusMeta.icon;
            const payloadPreview = tryParsePayload(entry.payload);
            return (
              <div
                key={entry.id}
                className="animate-fade-slide-in border-b border-primary/5 last:border-b-0"
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
                      <span className="typo-code font-mono font-medium" style={{ color: entry.color }}>
                        {EVENT_TYPE_LABELS[entry.eventType] ?? entry.eventType}
                      </span>
                      <ArrowRight className="w-2.5 h-2.5 text-foreground flex-shrink-0" />
                      <span className="typo-code font-mono text-foreground truncate">{entry.target}</span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[10px] font-mono text-foreground">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                      <span className="text-[10px] font-mono text-foreground">from {clampLabel(entry.source, 15)}</span>
                    </div>
                    {payloadPreview && !isExpanded && (
                      <p className="text-[10px] font-mono text-foreground truncate mt-0.5">{payloadPreview}</p>
                    )}
                  </div>
                  <ChevronRight className={`w-3 h-3 text-foreground flex-shrink-0 mt-0.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                </button>

                {isExpanded && (
                    <div
                      className="animate-fade-slide-in overflow-hidden"
                    >
                      <div className="px-3 pb-2 pt-0.5 ml-5 space-y-1.5">
                        <div className="grid grid-cols-2 gap-1">
                          <div>
                            <span className="text-[9px] font-mono uppercase text-foreground">Event</span>
                            <p className="text-[10px] font-mono text-foreground">{entry.eventType}</p>
                          </div>
                          <div>
                            <span className="text-[9px] font-mono uppercase text-foreground">Status</span>
                            <p className={`text-[10px] font-mono ${statusMeta.color}`}>{entry.status}</p>
                          </div>
                          <div>
                            <span className="text-[9px] font-mono uppercase text-foreground">Source</span>
                            <p className="text-[10px] font-mono text-foreground">{entry.source}</p>
                          </div>
                          <div>
                            <span className="text-[9px] font-mono uppercase text-foreground">Target</span>
                            <p className="text-[10px] font-mono text-foreground">{entry.target}</p>
                          </div>
                        </div>
                        <div>
                          <span className="text-[9px] font-mono uppercase text-foreground">ID</span>
                          <p className="text-[10px] font-mono text-foreground break-all">{entry.id}</p>
                        </div>
                        {entry.error && (
                          <div className="p-1.5 rounded bg-red-500/5 border border-red-500/10">
                            <span className="text-[9px] font-mono uppercase text-red-400/50">Error</span>
                            <p className="text-[10px] font-mono text-red-300/70">{entry.error}</p>
                          </div>
                        )}
                        {entry.payload && (
                          <div>
                            <span className="text-[9px] font-mono uppercase text-foreground">Payload</span>
                            <pre className="text-[10px] font-mono text-foreground bg-secondary/30 rounded p-1.5 mt-0.5 max-h-24 overflow-auto whitespace-pre-wrap break-all">
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
                          {t.overview.event_log_sidebar.open_detail_drawer} &rarr;
                        </button>
                      </div>
                    </div>
                  )}
              </div>
            );
          })}
      </div>
    </div>
  );
}
