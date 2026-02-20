import { motion } from 'framer-motion';
import { X, Clock, CheckCircle2, AlertCircle, Loader2, ChevronDown } from 'lucide-react';
import type { RealtimeEvent } from '@/hooks/realtime/useRealtimeEvents';
import { EVENT_TYPE_HEX_COLORS } from '@/hooks/realtime/useRealtimeEvents';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { usePersonaStore } from '@/stores/personaStore';
import { UuidLabel } from '@/features/shared/components/UuidLabel';

interface Props {
  event: RealtimeEvent;
  onClose: () => void;
}

const STATUS_ICONS: Record<string, { icon: typeof CheckCircle2; color: string }> = {
  pending: { icon: Clock, color: 'text-amber-400' },
  processing: { icon: Loader2, color: 'text-blue-400' },
  completed: { icon: CheckCircle2, color: 'text-emerald-400' },
  failed: { icon: AlertCircle, color: 'text-red-400' },
  skipped: { icon: ChevronDown, color: 'text-muted-foreground' },
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
  const personas = usePersonaStore((s) => s.personas);
  const statusInfo = STATUS_ICONS[event.status] ?? STATUS_ICONS.pending!;
  const StatusIcon = statusInfo.icon;
  const typeColor = EVENT_TYPE_HEX_COLORS[event.event_type] ?? '#818cf8';

  const getPersonaName = (id: string | null) => {
    if (!id) return null;
    return personas.find((p) => p.id === id)?.name || null;
  };

  return (
    <motion.div
      initial={{ y: '100%', opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: '100%', opacity: 0 }}
      transition={{ type: 'spring', damping: 30, stiffness: 300 }}
      className="absolute bottom-0 left-0 right-0 bg-background/95 backdrop-blur-xl border-t border-primary/20 rounded-t-2xl shadow-2xl z-10 max-h-[45%] overflow-hidden flex flex-col"
    >
      {/* Handle bar */}
      <div className="flex justify-center pt-2 pb-1">
        <div className="w-10 h-1 rounded-full bg-primary/20" />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-2 border-b border-primary/10">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: typeColor }} />
            <span className="text-xs font-mono font-medium" style={{ color: typeColor }}>
              {event.event_type}
            </span>
          </div>
          <div className={`flex items-center gap-1 ${statusInfo.color}`}>
            <StatusIcon className={`w-3.5 h-3.5 ${event.status === 'processing' ? 'animate-spin' : ''}`} />
            <span className="text-xs font-mono">{event.status}</span>
          </div>
          <span className="text-[11px] text-muted-foreground/30">{formatRelativeTime(event.created_at)}</span>
        </div>
        <button
          onClick={onClose}
          title="Close event details"
          className="p-1 rounded-md hover:bg-secondary/60 text-muted-foreground/40 hover:text-foreground/60 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
        {/* Metadata grid */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-2">
          <div>
            <span className="text-[9px] font-mono uppercase text-muted-foreground/30">Event ID</span>
            <p className="text-xs"><UuidLabel value={event.id} /></p>
          </div>
          <div>
            <span className="text-[9px] font-mono uppercase text-muted-foreground/30">Source</span>
            <p className="text-xs">
              <span className="text-foreground/60">{event.source_type}</span>
              {event.source_id && <span className="text-muted-foreground/30"> : </span>}
              {event.source_id && <UuidLabel value={event.source_id} label={event.source_type || undefined} />}
            </p>
          </div>
          <div>
            <span className="text-[9px] font-mono uppercase text-muted-foreground/30">Target</span>
            <p className="text-xs">
              {event.target_persona_id
                ? <UuidLabel value={event.target_persona_id} label={getPersonaName(event.target_persona_id)} />
                : <span className="text-foreground/40">(broadcast)</span>
              }
            </p>
          </div>
          <div className="rounded-lg border border-primary/10 bg-secondary/20 px-2.5 py-2">
            <span className="text-[11px] font-mono uppercase text-muted-foreground/35">Created</span>
            <p className="text-xs font-mono text-foreground/60">{new Date(event.created_at).toLocaleTimeString()}</p>
          </div>
          {event.processed_at && (
            <div className="rounded-lg border border-primary/10 bg-secondary/20 px-2.5 py-2">
              <span className="text-[11px] font-mono uppercase text-muted-foreground/35">Processed</span>
              <p className="text-xs font-mono text-foreground/60">{new Date(event.processed_at).toLocaleTimeString()}</p>
            </div>
          )}
        </div>

        {/* Error message */}
        {event.error_message && (
          <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/15">
            <span className="text-[11px] font-mono uppercase text-red-400/60 block mb-1">Error</span>
            <p className="text-xs text-red-300/80 font-mono">{event.error_message}</p>
          </div>
        )}

        {/* Payload */}
        {event.payload && (
          <div>
            <span className="text-[11px] font-mono uppercase text-muted-foreground/35 block mb-1">Payload</span>
            <pre className="p-3 rounded-lg bg-secondary/40 border border-primary/10 text-xs font-mono text-foreground/60 overflow-x-auto max-h-40 whitespace-pre-wrap">
              {formatPayload(event.payload)}
            </pre>
          </div>
        )}
      </div>
    </motion.div>
  );
}
