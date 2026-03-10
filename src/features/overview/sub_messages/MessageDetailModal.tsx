import { useState, useRef, useEffect, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import {
  Trash2, Send, AlertCircle, Clock, CheckCircle2,
  Loader2, ExternalLink, Check, X, Copy,
} from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import DetailModal from '@/features/overview/components/dashboard/widgets/DetailModal';
import { getMessageDeliveries } from '@/api/tauriApi';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { deliveryStatusConfig, channelLabels } from './messageListConstants';
import type { PersonaMessage } from '@/lib/types/types';
import type { PersonaMessageDelivery } from '@/lib/bindings/PersonaMessageDelivery';

// Resolve icon from name
const DELIVERY_ICONS = { CheckCircle2, AlertCircle, Clock, Loader2 } as const;

interface MessageDetailModalProps {
  message: PersonaMessage | null;
  onClose: () => void;
}

export function MessageDetailModal({ message, onClose }: MessageDetailModalProps) {
  const deleteMessage = usePersonaStore((s) => s.deleteMessage);

  const [deliveries, setDeliveries] = useState<PersonaMessageDelivery[]>([]);
  const [deliveriesLoading, setDeliveriesLoading] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, []);

  // Fetch deliveries when message changes
  useEffect(() => {
    if (!message) return;
    setConfirmingDelete(false);
    setCopiedId(false);
    setDeliveriesLoading(true);
    getMessageDeliveries(message.id)
      .then((result) => setDeliveries(result))
      .catch(() => setDeliveries([]))
      .finally(() => setDeliveriesLoading(false));
  }, [message?.id]);

  const handleClose = useCallback(() => {
    setDeliveries([]);
    setDeliveriesLoading(false);
    setConfirmingDelete(false);
    setCopiedId(false);
    onClose();
  }, [onClose]);

  const handleDelete = useCallback(() => {
    if (!message) return;
    deleteMessage(message.id);
    handleClose();
  }, [message, deleteMessage, handleClose]);

  if (!message) return null;

  return (
    <AnimatePresence>
      <DetailModal
        title={message.title || 'Message'}
        subtitle={`From ${message.persona_name || 'Unknown'} \u00b7 ${formatRelativeTime(message.created_at)}`}
        onClose={handleClose}
        actions={
          <>
            {/* Metadata */}
            <div className="flex items-center gap-4 text-sm text-muted-foreground/80 mr-auto">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigator.clipboard.writeText(message.id).then(() => {
                    setCopiedId(true);
                    setTimeout(() => setCopiedId(false), 2000);
                  }).catch(() => {});
                }}
                className="inline-flex items-center gap-1 hover:text-muted-foreground transition-colors"
                title={message.id}
              >
                ID: <span className="font-mono">{message.id.slice(0, 8)}</span>
                {copiedId ? (
                  <Check className="w-3 h-3 text-emerald-400" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
              {message.execution_id && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const store = usePersonaStore.getState();
                    store.selectPersona(message.persona_id);
                    store.setEditorTab('use-cases');
                  }}
                  className="inline-flex items-center gap-1 text-blue-400/70 hover:text-blue-400 transition-colors"
                  title={message.execution_id}
                >
                  View Execution
                  <ExternalLink className="w-3 h-3" />
                </button>
              )}
              <span>Type: {message.content_type}</span>
            </div>

            {/* Delete */}
            {confirmingDelete ? (
              <div className="flex items-center gap-1">
                <button
                  onClick={handleDelete}
                  className="p-1.5 bg-red-500/15 hover:bg-red-500/25 rounded-lg transition-colors"
                  title="Confirm delete"
                >
                  <Check className="w-4 h-4 text-red-400" />
                </button>
                <button
                  onClick={() => setConfirmingDelete(false)}
                  className="p-1.5 hover:bg-secondary/60 rounded-lg transition-colors"
                  title="Cancel"
                >
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
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </button>
            )}
          </>
        }
      >
        {/* Content section */}
        <div className="space-y-6">
          <div>
            <div className="text-sm font-mono text-muted-foreground/90 uppercase mb-2">Content</div>
            <MarkdownRenderer content={message.content} className="text-sm" />
          </div>

          {/* Delivery Status section */}
          <div>
            <div className="text-sm font-mono text-muted-foreground/90 uppercase mb-2 flex items-center gap-1.5">
              <Send className="w-3 h-3" />
              Delivery Status
            </div>
            {deliveriesLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground/80 py-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                Loading...
              </div>
            ) : deliveries.length === 0 ? (
              <div className="text-sm text-muted-foreground/80 py-1">
                No delivery channels configured
              </div>
            ) : (
              <div className="space-y-1.5">
                {deliveries.map((d) => {
                  const defaultStatus = deliveryStatusConfig.pending!;
                  const statusCfg = deliveryStatusConfig[d.status] ?? defaultStatus;
                  const StatusIcon = DELIVERY_ICONS[statusCfg.iconName as keyof typeof DELIVERY_ICONS];
                  return (
                    <div
                      key={d.id}
                      className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl border ${statusCfg.bgColor} ${statusCfg.borderColor}`}
                    >
                      <StatusIcon className={`w-3.5 h-3.5 flex-shrink-0 ${statusCfg.color}`} />
                      <span className="text-sm font-medium text-foreground/90 min-w-[60px]">
                        {channelLabels[d.channel_type] ?? d.channel_type}
                      </span>
                      <span className={`text-sm font-medium ${statusCfg.color}`}>
                        {statusCfg.label}
                      </span>
                      {d.delivered_at && (
                        <span className="text-sm text-muted-foreground/80 ml-auto">
                          {formatRelativeTime(d.delivered_at)}
                        </span>
                      )}
                      {d.error_message && (
                        <span className="text-sm text-red-400/80 ml-auto truncate max-w-[200px]" title={d.error_message}>
                          {d.error_message}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </DetailModal>
    </AnimatePresence>
  );
}
