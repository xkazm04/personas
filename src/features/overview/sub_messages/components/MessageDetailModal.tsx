import { silentCatch } from "@/lib/silentCatch";
import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Trash2, ExternalLink, Check, X, Copy } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import DetailModal from '@/features/overview/components/dashboard/widgets/DetailModal';
import { getMessageDeliveries } from "@/api/overview/messages";

import { formatRelativeTime } from '@/lib/utils/formatters';
import { deliveryStatusConfig, channelLabels } from '../libs/messageHelpers';
import type { PersonaMessage } from '@/lib/types/types';
import type { PersonaMessageDelivery } from '@/lib/bindings/PersonaMessageDelivery';

interface MessageDetailModalProps {
  message: PersonaMessage;
  onClose: () => void;
  onDelete: () => void;
}

export function MessageDetailModal({ message, onClose, onDelete }: MessageDetailModalProps) {
  const [deliveries, setDeliveries] = useState<PersonaMessageDelivery[]>([]);
  const [deliveriesLoading, setDeliveriesLoading] = useState(true);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setDeliveriesLoading(true);
    getMessageDeliveries(message.id)
      .then(setDeliveries)
      .catch(() => setDeliveries([]))
      .finally(() => setDeliveriesLoading(false));
  }, [message.id]);

  useEffect(() => {
    return () => { if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current); };
  }, []);

  const handleDelete = useCallback(() => {
    onDelete();
    onClose();
  }, [onDelete, onClose]);

  return (
    <DetailModal
      title={message.title || 'Message'}
      subtitle={`From ${message.persona_name || 'Unknown'} \u00b7 ${formatRelativeTime(message.created_at)}`}
      onClose={onClose}
      actions={
        <>
          <div className="flex items-center gap-4 text-sm text-muted-foreground/80 mr-auto">
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(message.id).then(() => {
                  setCopiedId(true);
                  setTimeout(() => setCopiedId(false), 2000);
                }).catch(silentCatch("MessageDetailModal:copyId"));
              }}
              className="inline-flex items-center gap-1 hover:text-muted-foreground transition-colors"
              title={message.id}
            >
              ID: <span className="font-mono">{message.id.slice(0, 8)}</span>
              {copiedId ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            </button>
            {message.execution_id && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  useAgentStore.getState().selectPersona(message.persona_id);
                  useSystemStore.getState().setEditorTab('use-cases');
                }}
                className="inline-flex items-center gap-1 text-blue-400/70 hover:text-blue-400 transition-colors"
                title={message.execution_id}
              >
                View Execution <ExternalLink className="w-3 h-3" />
              </button>
            )}
            <span>Type: {message.content_type}</span>
          </div>

          {confirmingDelete ? (
            <div className="flex items-center gap-1">
              <button onClick={handleDelete} className="p-1.5 bg-red-500/15 hover:bg-red-500/25 rounded-lg transition-colors" title="Confirm delete">
                <Check className="w-4 h-4 text-red-400" />
              </button>
              <button onClick={() => setConfirmingDelete(false)} className="p-1.5 hover:bg-secondary/60 rounded-lg transition-colors" title="Cancel">
                <X className="w-4 h-4 text-muted-foreground/90" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                setConfirmingDelete(true);
                if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
                confirmTimerRef.current = setTimeout(() => setConfirmingDelete(false), 3000);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl typo-heading bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
          )}
        </>
      }
    >
      <div className="space-y-6">
        <div>
          <div className="text-sm font-mono text-muted-foreground/90 uppercase mb-2">Content</div>
          <MarkdownRenderer content={message.content} className="text-sm" />
        </div>

        <div>
          <div className="text-sm font-mono text-muted-foreground/90 uppercase mb-2 flex items-center gap-1.5">
            <Send className="w-3 h-3" /> Delivery Status
          </div>
          {deliveriesLoading ? (
            null
          ) : deliveries.length === 0 ? (
            <div className="text-sm text-muted-foreground/80 py-1">No delivery channels configured</div>
          ) : (
            <div className="space-y-1.5">
              {deliveries.map((d) => {
                const defaultStatus = deliveryStatusConfig.pending!;
                const statusCfg = deliveryStatusConfig[d.status] ?? defaultStatus;
                const StatusIcon = statusCfg.icon;
                return (
                  <div key={d.id} className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl border ${statusCfg.bgColor} ${statusCfg.borderColor}`}>
                    <StatusIcon className={`w-3.5 h-3.5 flex-shrink-0 ${statusCfg.color}`} />
                    <span className="typo-heading text-foreground/90 min-w-[60px]">{channelLabels[d.channel_type] ?? d.channel_type}</span>
                    <span className={`typo-heading ${statusCfg.color}`}>{statusCfg.label}</span>
                    {d.delivered_at && <span className="text-sm text-muted-foreground/80 ml-auto">{formatRelativeTime(d.delivered_at)}</span>}
                    {d.error_message && <span className="text-sm text-red-400/80 ml-auto truncate max-w-[200px]" title={d.error_message}>{d.error_message}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </DetailModal>
  );
}
