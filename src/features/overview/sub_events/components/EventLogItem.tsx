import { useMemo } from 'react';
import { AlertCircle, CheckCircle2, Clock, Loader2, Server, Bot, Copy, Check } from 'lucide-react';
import { UuidLabel } from '@/features/shared/components/UuidLabel';
import { EVENT_STATUS_COLORS, EVENT_TYPE_COLORS } from '@/lib/utils/formatters';
import type { PersonaEvent, Persona } from '@/lib/types/types';

// ── HighlightedJson ──────────────────────────────────────────────────

export function HighlightedJson({ raw }: { raw: string }) {
  const pretty = useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return null;
    }
  }, [raw]);

  return (
    <pre className="bg-background/40 p-2 rounded-lg text-foreground/90 overflow-x-auto max-h-40 text-sm">
      {pretty ?? raw}
    </pre>
  );
}

// ── Event Detail Content ─────────────────────────────────────────────

interface EventDetailContentProps {
  event: PersonaEvent;
  copiedPayload: boolean;
  setCopiedPayload: (v: boolean) => void;
}

export function EventDetailContent({ event, copiedPayload, setCopiedPayload }: EventDetailContentProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <span className="text-sm text-muted-foreground/80 block mb-0.5">Event ID</span>
          <span className="text-sm"><UuidLabel value={event.id} /></span>
        </div>
        <div>
          <span className="text-sm text-muted-foreground/80 block mb-0.5">Project</span>
          <span className="text-sm"><UuidLabel value={event.project_id} /></span>
        </div>
        {event.source_id && (
          <div>
            <span className="text-sm text-muted-foreground/80 block mb-0.5">Source</span>
            <span className="text-sm">
              <UuidLabel value={event.source_id} label={event.source_type || undefined} />
            </span>
          </div>
        )}
        {event.processed_at && (
          <div className="rounded-xl border border-primary/10 bg-background/30 px-2.5 py-2">
            <span className="text-sm font-mono text-muted-foreground/80">Processed</span>
            <span className="ml-2 text-sm text-foreground/80">
              {new Date(event.processed_at).toLocaleString()}
            </span>
          </div>
        )}
      </div>

      {event.payload && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-muted-foreground/80">Payload</span>
            <button
              onClick={() => {
                navigator.clipboard.writeText(
                  (() => { try { return JSON.stringify(JSON.parse(event.payload!), null, 2); } catch { return event.payload!; } })()
                ).then(() => {
                  setCopiedPayload(true);
                  setTimeout(() => setCopiedPayload(false), 2000);
                }).catch(() => { /* intentional */ });
              }}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-sm text-muted-foreground/70 hover:text-muted-foreground hover:bg-secondary/50 transition-colors"
              title="Copy payload"
            >
              {copiedPayload ? (
                <><Check className="w-3 h-3 text-emerald-400" /><span className="text-emerald-400">Copied</span></>
              ) : (
                <><Copy className="w-3 h-3" />Copy</>
              )}
            </button>
          </div>
          <div className="rounded-xl border border-primary/10 bg-secondary/20 p-3 overflow-hidden">
            <HighlightedJson raw={event.payload} />
          </div>
        </div>
      )}

      {event.error_message && (
        <div>
          <span className="text-sm text-red-400/70 block mb-1">Error</span>
          <pre className="bg-red-500/5 p-2 rounded-lg text-red-400/70 text-sm whitespace-pre-wrap">
            {event.error_message}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Virtualized Event Row ────────────────────────────────────────────

interface EventRowProps {
  event: PersonaEvent;
  index: number;
  start: number;
  size: number;
  getPersona: (id: string | null) => Persona | null;
  onClick: () => void;
}

const defaultStatus = { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' };

export function EventRow({ event, index, start, size, getPersona, onClick }: EventRowProps) {
  const statusStyle = EVENT_STATUS_COLORS[event.status] ?? defaultStatus;
  const typeColor = EVENT_TYPE_COLORS[event.event_type]?.tailwind ?? 'text-muted-foreground';
  const targetPersona = getPersona(event.target_persona_id);
  const hoverAccent =
    event.status === 'processing' ? 'hover:border-l-blue-400'
    : event.status === 'completed' || event.status === 'processed' ? 'hover:border-l-emerald-400'
    : event.status === 'failed' ? 'hover:border-l-red-400'
    : 'hover:border-l-amber-400';

  return (
    <tr
      key={event.id}
      data-testid={`event-row-${event.id}`}
      onClick={onClick}
      className={`cursor-pointer transition-colors border-b border-primary/5 border-l-2 border-l-transparent hover:bg-white/[0.05] ${hoverAccent} ${index % 2 === 0 ? 'bg-white/[0.015]' : ''}`}
      style={{
        position: 'absolute', top: 0, left: 0, width: '100%',
        height: `${size}px`, transform: `translateY(${start}px)`,
        display: 'table', tableLayout: 'fixed',
      }}
    >
      <td className="px-4 py-2.5">
        <span className={`text-sm font-medium ${typeColor}`}>{event.event_type}</span>
      </td>
      <td className="px-4 py-2.5">
        <span className="text-sm text-muted-foreground/80 truncate block">{event.source_type}</span>
      </td>
      <td className="px-4 py-2.5">
        {targetPersona ? (
          <div className="flex items-center gap-2">
            <div
              className="w-6 h-6 rounded-lg flex items-center justify-center text-sm border border-primary/15 flex-shrink-0"
              style={{ backgroundColor: (targetPersona.color || '#6366f1') + '15' }}
            >
              {targetPersona.icon || <Bot className="w-3.5 h-3.5 text-muted-foreground/60" />}
            </div>
            <span className="text-sm text-muted-foreground/80 truncate">{targetPersona.name}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg flex items-center justify-center border border-primary/10 bg-muted/20 flex-shrink-0">
              <Server className="w-3.5 h-3.5 text-muted-foreground/50" />
            </div>
            <span className="text-sm text-muted-foreground/50 truncate">{event.source_type || 'System'}</span>
          </div>
        )}
      </td>
      <td className="px-4 py-2.5">
        <span className={`inline-flex items-center gap-1.5 text-sm px-2 py-0.5 rounded-lg font-medium ${statusStyle.bg} ${statusStyle.text} border ${statusStyle.border}`}>
          {event.status === 'completed' || event.status === 'processed' ? <CheckCircle2 className="w-3 h-3" />
           : event.status === 'failed' ? <AlertCircle className="w-3 h-3" />
           : event.status === 'processing' ? <Loader2 className="w-3 h-3 animate-spin" />
           : <Clock className="w-3 h-3" />}
          {event.status}
        </span>
      </td>
      <td className="px-4 py-2.5 text-right">
        <span className="text-sm text-muted-foreground/80">
          {new Date(event.created_at).toLocaleString()}
        </span>
      </td>
    </tr>
  );
}
