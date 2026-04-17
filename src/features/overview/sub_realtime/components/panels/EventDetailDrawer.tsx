import { X, Clock, CheckCircle2, AlertCircle, Loader2, ChevronDown } from 'lucide-react';
import type { RealtimeEvent } from '@/hooks/realtime/useRealtimeEvents';
import { EVENT_TYPE_HEX_COLORS } from '@/hooks/realtime/useRealtimeEvents';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { useAgentStore } from "@/stores/agentStore";
import { UuidLabel } from '@/features/shared/components/display/UuidLabel';
import { useTranslation } from '@/i18n/useTranslation';

interface Props {
  event: RealtimeEvent;
  onClose: () => void;
}

const STATUS_ICONS: Record<string, { icon: typeof CheckCircle2; color: string }> = {
  pending: { icon: Clock, color: 'text-amber-400' },
  processing: { icon: Loader2, color: 'text-blue-400' },
  completed: { icon: CheckCircle2, color: 'text-emerald-400' },
  failed: { icon: AlertCircle, color: 'text-red-400' },
  skipped: { icon: ChevronDown, color: 'text-foreground' },
};

function formatPayload(payload: string | null): string {
  if (!payload) return '(empty)';
  try {
    return JSON.stringify(JSON.parse(payload), null, 2);
  } catch {
    return payload;
  }
}

export default function EventDetailDrawer({ event, onClose }: Props) {
  const { t } = useTranslation();
  const personas = useAgentStore((s) => s.personas);
  const statusInfo = STATUS_ICONS[event.status] ?? STATUS_ICONS.pending!;
  const StatusIcon = statusInfo.icon;
  const typeColor = EVENT_TYPE_HEX_COLORS[event.event_type] ?? '#818cf8';

  const getPersonaName = (id: string | null) => {
    if (!id) return null;
    return personas.find((p) => p.id === id)?.name || null;
  };

  return (
    <div
      className="animate-fade-slide-in absolute bottom-0 left-0 right-0 bg-background/95 backdrop-blur-xl border-t border-primary/20 rounded-t-2xl shadow-elevation-4 z-10 max-h-[50%] overflow-hidden flex flex-col"
    >
      <div className="flex justify-center pt-2 pb-1">
        <div className="w-10 h-1 rounded-full bg-primary/20" />
      </div>

      <div className="flex items-center justify-between px-4 py-2 border-b border-primary/10">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: typeColor }} />
            <span className="typo-code font-mono font-medium" style={{ color: typeColor }}>{event.event_type}</span>
          </div>
          <div className={`flex items-center gap-1 ${statusInfo.color}`}>
            <StatusIcon className={`w-3.5 h-3.5 ${event.status === 'processing' ? 'animate-spin' : ''}`} />
            <span className="typo-code font-mono">{event.status}</span>
          </div>
          <span className="typo-body text-foreground">{formatRelativeTime(event.created_at)}</span>
        </div>
        <button onClick={onClose} title={t.overview.realtime_page.close_event_details} className="p-1 rounded-card hover:bg-secondary/60 text-foreground hover:text-foreground/95 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
          <div className="rounded-modal border border-primary/10 bg-secondary/20 px-2.5 py-2">
            <span className="typo-code font-mono uppercase text-foreground">Event ID</span>
            <p className="typo-body"><UuidLabel value={event.id} /></p>
          </div>
          <div className="rounded-modal border border-primary/10 bg-secondary/20 px-2.5 py-2">
            <span className="typo-code font-mono uppercase text-foreground">Source</span>
            <p className="typo-body">
              <span className="text-foreground">{event.source_type}</span>
              {event.source_id && <span className="text-foreground"> : </span>}
              {event.source_id && <UuidLabel value={event.source_id} label={event.source_type || undefined} />}
            </p>
          </div>
          <div className="rounded-modal border border-primary/10 bg-secondary/20 px-2.5 py-2">
            <span className="typo-code font-mono uppercase text-foreground">Target</span>
            <p className="typo-body">
              {event.target_persona_id
                ? <UuidLabel value={event.target_persona_id} label={getPersonaName(event.target_persona_id)} />
                : <span className="text-foreground">(broadcast)</span>
              }
            </p>
          </div>
          <div className="rounded-modal border border-primary/10 bg-secondary/20 px-2.5 py-2">
            <span className="typo-code font-mono uppercase text-foreground">Created</span>
            <p className="typo-code font-mono text-foreground">{new Date(event.created_at).toLocaleTimeString()}</p>
          </div>
          {event.processed_at && (
            <div className="rounded-modal border border-primary/10 bg-secondary/20 px-2.5 py-2">
              <span className="typo-code font-mono uppercase text-foreground">Processed</span>
              <p className="typo-code font-mono text-foreground">{new Date(event.processed_at).toLocaleTimeString()}</p>
            </div>
          )}
        </div>

        {event.error_message && (
          <div className="p-3 rounded-card bg-red-500/5 border border-red-500/15">
            <span className="typo-code font-mono uppercase text-red-400/60 block mb-1">Error</span>
            <p className="typo-code text-red-300/80 font-mono">{event.error_message}</p>
          </div>
        )}

        {event.payload && (
          <div>
            <span className="typo-code font-mono uppercase text-foreground block mb-1">Payload</span>
            <pre className="p-3 rounded-card bg-secondary/40 border border-primary/10 typo-code font-mono text-foreground overflow-x-auto max-h-40 whitespace-pre-wrap">
              {formatPayload(event.payload)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
