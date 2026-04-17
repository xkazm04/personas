import { useMemo } from 'react';
import { AlertCircle, CheckCircle2, Clock, Server, Copy, Check } from 'lucide-react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { UuidLabel } from '@/features/shared/components/display/UuidLabel';
import { EVENT_STATUS_COLORS, EVENT_TYPE_COLORS, formatRelativeTime } from '@/lib/utils/formatters';

import { ROW_SEPARATOR } from '@/lib/design/listTokens';
import type { PersonaEvent, Persona } from '@/lib/types/types';
import { useTranslation } from '@/i18n/useTranslation';

// -- HighlightedJson --------------------------------------------------

/** Simple token-level JSON syntax colouring. */
function colorizeJson(json: string): React.ReactNode[] {
  const TOKEN_RE = /("(?:\\.|[^"\\])*")\s*:|("(?:\\.|[^"\\])*")|(true|false|null)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = TOKEN_RE.exec(json)) !== null) {
    if (match.index > last) nodes.push(json.slice(last, match.index));
    if (match[1]) {
      nodes.push(<span key={key++} className="text-sky-400">{match[1]}</span>, ':');
    } else if (match[2]) {
      nodes.push(<span key={key++} className="text-emerald-400">{match[2]}</span>);
    } else if (match[3]) {
      nodes.push(<span key={key++} className="text-amber-400">{match[3]}</span>);
    } else if (match[4]) {
      nodes.push(<span key={key++} className="text-violet-400">{match[4]}</span>);
    }
    last = match.index + match[0].length;
  }
  if (last < json.length) nodes.push(json.slice(last));
  return nodes;
}

export function HighlightedJson({ raw }: { raw: string }) {
  const colored = useMemo(() => {
    try {
      const p = JSON.stringify(JSON.parse(raw), null, 2);
      return colorizeJson(p);
    } catch {
      return null;
    }
  }, [raw]);

  return (
    <pre className="bg-background/60 p-3 rounded-card overflow-auto flex-1 typo-code font-mono leading-relaxed">
      {colored || <span className="text-foreground">{raw}</span>}
    </pre>
  );
}

// -- Event Detail Content ---------------------------------------------

interface EventDetailContentProps {
  event: PersonaEvent;
  copiedPayload: boolean;
  setCopiedPayload: (v: boolean) => void;
}

export function EventDetailContent({ event, copiedPayload, setCopiedPayload }: EventDetailContentProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      <div className="grid grid-cols-2 gap-3 flex-shrink-0">
        <div>
          <span className="typo-body text-foreground font-medium block mb-0.5">{t.overview.event_log_item.event_id}</span>
          <span className="typo-body"><UuidLabel value={event.id} /></span>
        </div>
        <div>
          <span className="typo-body text-foreground font-medium block mb-0.5">{t.overview.event_log_item.project}</span>
          <span className="typo-body"><UuidLabel value={event.project_id} /></span>
        </div>
        {event.source_id && (
          <div>
            <span className="typo-body text-foreground font-medium block mb-0.5">{t.overview.event_log_item.source}</span>
            <span className="typo-body">
              <UuidLabel value={event.source_id} label={event.source_type || undefined} />
            </span>
          </div>
        )}
        {event.processed_at && (
          <div className="rounded-modal border border-primary/10 bg-background/30 px-2.5 py-2">
            <span className="typo-code font-mono text-foreground font-medium">{t.overview.event_log_item.processed}</span>
            <span className="ml-2 typo-body text-foreground">
              {new Date(event.processed_at).toLocaleString()}
            </span>
          </div>
        )}
      </div>

      {event.payload && (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex items-center justify-between mb-1 flex-shrink-0">
            <span className="typo-body text-foreground font-medium">{t.overview.event_log_item.event_data}</span>
            <button
              onClick={() => {
                navigator.clipboard.writeText(
                  (() => { try { return JSON.stringify(JSON.parse(event.payload!), null, 2); } catch { return event.payload!; } })()
                ).then(() => {
                  setCopiedPayload(true);
                  setTimeout(() => setCopiedPayload(false), 2000);
                }).catch(() => { /* intentional */ });
              }}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-card typo-body text-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
              title={t.overview.event_log_item.copy_event_data}
            >
              {copiedPayload ? (
                <><Check className="w-3 h-3 text-emerald-400" /><span className="text-emerald-400">{t.overview.event_log_item.copied}</span></>
              ) : (
                <><Copy className="w-3 h-3" />{t.overview.event_log_item.copy}</>
              )}
            </button>
          </div>
          <div className="flex-1 min-h-0 flex flex-col rounded-modal border border-primary/10 bg-secondary/20 p-3">
            <HighlightedJson raw={event.payload} />
          </div>
        </div>
      )}

      {event.error_message && (
        <div>
          <span className="typo-body text-red-400 block mb-1">{t.overview.event_log_item.error}</span>
          <pre className="bg-red-500/5 p-2 rounded-card text-red-400 typo-body whitespace-pre-wrap">
            {event.error_message}
          </pre>
        </div>
      )}
    </div>
  );
}

// -- Virtualized Event Row --------------------------------------------

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
  const typeColor = EVENT_TYPE_COLORS[event.event_type]?.tailwind ?? 'text-foreground';
  const targetPersona = getPersona(event.target_persona_id);
  const borderAccent =
    event.status === 'processing' ? 'border-l-status-processing'
      : event.status === 'completed' || event.status === 'delivered' ? 'border-l-status-success'
        : event.status === 'failed' ? 'border-l-status-error'
          : 'border-l-status-pending';

  return (
    <tr
      key={event.id}
      data-testid={`event-row-${event.id}`}
      onClick={onClick}
      className={`cursor-pointer transition-colors border-b ${ROW_SEPARATOR} border-l-2 ${borderAccent} hover:bg-primary/[0.08] ${index % 2 === 0 ? 'bg-primary/[0.03]' : ''}`}
      style={{
        position: 'absolute', top: 0, left: 0, width: '100%',
        height: `${size}px`, transform: `translateY(${start}px)`,
        display: 'table', tableLayout: 'fixed',
      }}
    >
      <td className="px-4 py-2.5">
        <span className={`typo-heading ${typeColor}`}>{event.event_type}</span>
      </td>
      <td className="px-4 py-2.5">
        <span className="typo-body text-foreground truncate block">{event.source_type}</span>
      </td>
      <td className="px-4 py-2.5">
        {targetPersona ? (
          <div className="flex items-center gap-2">
            <PersonaIcon icon={targetPersona.icon} color={targetPersona.color} display="framed" frameSize={"lg"} />
            <span className="typo-body text-foreground truncate">{targetPersona.name}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="icon-frame icon-frame-lg flex-shrink-0"><Server className="text-foreground" /></div>
            <span className="typo-body text-foreground truncate">{event.source_type || 'System'}</span>
          </div>
        )}
      </td>
      <td className="px-4 py-2.5">
        <span className={`inline-flex items-center gap-1.5 typo-body px-2 py-0.5 rounded-card font-medium ${statusStyle.bg} ${statusStyle.text} border ${statusStyle.border}`}>
          {event.status === 'completed' || event.status === 'delivered' ? <CheckCircle2 className="w-3 h-3" />
            : event.status === 'failed' ? <AlertCircle className="w-3 h-3" />
              : event.status === 'processing' ? <LoadingSpinner size="xs" />
                : <Clock className="w-3 h-3" />}
          {event.status}
        </span>
      </td>
      <td className="px-4 py-2.5 text-right">
        <span className="typo-body text-foreground">
          {new Date(event.created_at).toLocaleString()}
        </span>
      </td>
    </tr>
  );
}

// -- Grid-based Event Row (no virtualization) ------------------------

interface EventGridRowProps {
  event: PersonaEvent;
  index: number;
  gridCols: string;
  getPersona: (id: string | null) => Persona | null;
  onClick: () => void;
}

export function EventGridRow({ event, index, gridCols, getPersona, onClick }: EventGridRowProps) {
  const statusStyle = EVENT_STATUS_COLORS[event.status] ?? defaultStatus;
  const typeColor = EVENT_TYPE_COLORS[event.event_type]?.tailwind ?? 'text-foreground';
  const targetPersona = getPersona(event.target_persona_id);
  const borderAccent =
    event.status === 'processing' ? 'border-l-status-processing'
      : event.status === 'completed' || event.status === 'delivered' ? 'border-l-status-success'
        : event.status === 'failed' ? 'border-l-status-error'
          : 'border-l-status-pending';

  return (
    <div
      data-testid={`event-row-${event.id}`}
      onClick={onClick}
      className={`grid ${gridCols} gap-0 cursor-pointer transition-colors border-b ${ROW_SEPARATOR} border-l-2 ${borderAccent} hover:bg-primary/[0.08] ${index % 2 === 0 ? 'bg-primary/[0.03]' : ''}`}
    >
      <div className="px-4 py-2.5 flex items-center min-w-0">
        <span className={`typo-heading truncate ${typeColor}`}>{event.event_type}</span>
      </div>
      <div className="px-4 py-2.5 flex items-center min-w-0">
        <span className="typo-body text-foreground truncate">{event.source_type}</span>
      </div>
      <div className="px-4 py-2.5 flex items-center min-w-0">
        {targetPersona ? (
          <div className="flex items-center gap-2 min-w-0">
            <PersonaIcon icon={targetPersona.icon} color={targetPersona.color} display="framed" />
            <span className="typo-body text-foreground truncate">{targetPersona.name}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 min-w-0">
            <div className="icon-frame icon-frame-lg flex-shrink-0"><Server className="text-foreground" /></div>
            <span className="typo-body text-foreground truncate">{event.source_type || 'System'}</span>
          </div>
        )}
      </div>
      <div className="px-4 py-2.5 flex items-center">
        <span className={`inline-flex items-center gap-1.5 typo-caption px-2 py-0.5 rounded-card font-medium ${statusStyle.bg} ${statusStyle.text} border ${statusStyle.border}`}>
          {event.status === 'completed' || event.status === 'delivered' ? <CheckCircle2 className="w-3 h-3" />
            : event.status === 'failed' ? <AlertCircle className="w-3 h-3" />
              : event.status === 'processing' ? <LoadingSpinner size="xs" />
                : <Clock className="w-3 h-3" />}
          {event.status}
        </span>
      </div>
      <div className="px-4 py-2.5 flex items-center justify-end">
        <span className="typo-body text-foreground">{formatRelativeTime(event.created_at)}</span>
      </div>
    </div>
  );
}
