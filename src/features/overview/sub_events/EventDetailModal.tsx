import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { UuidLabel } from '@/features/shared/components/display/UuidLabel';
import DetailModal from '@/features/overview/components/dashboard/widgets/DetailModal';
import { HighlightedJson } from './HighlightedJson';
import type { PersonaEvent } from '@/lib/types/types';

interface EventDetailModalProps {
  event: PersonaEvent;
  onClose: () => void;
}

export function EventDetailModal({ event, onClose }: EventDetailModalProps) {
  const [copiedPayload, setCopiedPayload] = useState(false);

  return (
    <DetailModal
        title={`Event: ${event.event_type}`}
        subtitle={`Status: ${event.status}`}
        onClose={() => { onClose(); setCopiedPayload(false); }}
      >
        <div className="space-y-4">
          {/* IDs & metadata */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="text-sm text-foreground/70 font-medium block mb-0.5">Event ID</span>
              <span className="text-sm"><UuidLabel value={event.id} /></span>
            </div>
            <div>
              <span className="text-sm text-foreground/70 font-medium block mb-0.5">Project</span>
              <span className="text-sm"><UuidLabel value={event.project_id} /></span>
            </div>
            {event.source_id && (
              <div>
                <span className="text-sm text-foreground/70 font-medium block mb-0.5">Source</span>
                <span className="text-sm">
                  <UuidLabel value={event.source_id} label={event.source_type || undefined} />
                </span>
              </div>
            )}
            {event.processed_at && (
              <div className="rounded-xl border border-primary/10 bg-background/30 px-2.5 py-2">
                <span className="text-sm font-mono text-foreground/70 font-medium">Processed</span>
                <span className="ml-2 text-sm text-foreground">
                  {new Date(event.processed_at).toLocaleString()}
                </span>
              </div>
            )}
          </div>

          {/* Payload */}
          {event.payload && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-foreground/70 font-medium">Event Data</span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(
                      (() => { try { return JSON.stringify(JSON.parse(event.payload!), null, 2); } catch { return event.payload!; } })()
                    ).then(() => {
                      setCopiedPayload(true);
                      setTimeout(() => setCopiedPayload(false), 2000);
                    }).catch(() => { /* intentional: non-critical -- clipboard copy fallback */ });
                  }}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-sm text-foreground/70 hover:text-foreground hover:bg-secondary/50 transition-colors"
                  title="Copy event data"
                >
                  {copiedPayload ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span className="text-emerald-400">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      Copy
                    </>
                  )}
                </button>
              </div>
              <div className="rounded-xl border border-primary/10 bg-secondary/20 p-3 overflow-hidden">
                <HighlightedJson raw={event.payload} />
              </div>
            </div>
          )}

          {/* Error */}
          {event.error_message && (
            <div>
              <span className="text-sm text-red-400 block mb-1">Error</span>
              <pre className="bg-red-500/5 p-2 rounded-lg text-red-400 text-sm whitespace-pre-wrap">
                {event.error_message}
              </pre>
            </div>
          )}
        </div>
      </DetailModal>
  );
}
