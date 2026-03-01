import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import { MessageSquare, CheckCheck, RefreshCw, Trash2, Send, AlertCircle, Clock, CheckCircle2, Loader2, ExternalLink, Check, X, Copy } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { usePersonaStore } from '@/stores/personaStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/ContentLayout';
import { FilterBar } from '@/features/shared/components/FilterBar';
import { MarkdownRenderer } from '@/features/shared/components/MarkdownRenderer';
import DetailModal from '@/features/overview/components/DetailModal';
import { PersonaSelect } from '@/features/overview/sub_usage/DashboardFilters';
import type { PersonaMessage } from '@/lib/types/types';
import type { PersonaMessage as RawPersonaMessage } from '@/lib/bindings/PersonaMessage';
import type { PersonaMessageDelivery } from '@/lib/bindings/PersonaMessageDelivery';
import { getMessageDeliveries } from '@/api/tauriApi';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { useVirtualList } from '@/hooks/utility/useVirtualList';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const priorityConfig: Record<string, { color: string; bgColor: string; borderColor: string; label: string }> = {
  high: { color: 'text-red-400', bgColor: 'bg-red-500/10', borderColor: 'border-red-500/30', label: 'High' },
  normal: { color: 'text-foreground/80', bgColor: 'bg-secondary/30', borderColor: 'border-primary/15', label: 'Normal' },
  low: { color: 'text-muted-foreground/90', bgColor: 'bg-muted/20', borderColor: 'border-muted-foreground/20', label: 'Low' },
};

type FilterType = 'all' | 'unread' | 'high';

const FILTER_LABELS: Record<FilterType, string> = {
  all: 'All',
  unread: 'Unread',
  high: 'High Priority',
};

// ---------------------------------------------------------------------------
// Delivery status config
// ---------------------------------------------------------------------------

const deliveryStatusConfig: Record<string, { icon: typeof CheckCircle2; color: string; bgColor: string; borderColor: string; label: string }> = {
  delivered: { icon: CheckCircle2, color: 'text-emerald-400', bgColor: 'bg-emerald-500/10', borderColor: 'border-emerald-500/30', label: 'Delivered' },
  failed: { icon: AlertCircle, color: 'text-red-400', bgColor: 'bg-red-500/10', borderColor: 'border-red-500/30', label: 'Failed' },
  pending: { icon: Clock, color: 'text-amber-400', bgColor: 'bg-amber-500/10', borderColor: 'border-amber-500/30', label: 'Pending' },
  queued: { icon: Loader2, color: 'text-blue-400', bgColor: 'bg-blue-500/10', borderColor: 'border-blue-500/30', label: 'Queued' },
};

const channelLabels: Record<string, string> = {
  email: 'Email',
  slack: 'Slack',
  telegram: 'Telegram',
  desktop: 'Desktop',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MessageList() {
  const messages = usePersonaStore((s) => s.messages);
  const messagesTotal = usePersonaStore((s) => s.messagesTotal);
  const unreadMessageCount = usePersonaStore((s) => s.unreadMessageCount);
  const fetchMessages = usePersonaStore((s) => s.fetchMessages);
  const fetchUnreadMessageCount = usePersonaStore((s) => s.fetchUnreadMessageCount);
  const markMessageAsRead = usePersonaStore((s) => s.markMessageAsRead);
  const markAllMessagesAsRead = usePersonaStore((s) => s.markAllMessagesAsRead);
  const deleteMessage = usePersonaStore((s) => s.deleteMessage);
  const personas = usePersonaStore((s) => s.personas);

  const [filter, setFilter] = useState<FilterType>('all');
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>('');
  const [selectedMsg, setSelectedMsg] = useState<PersonaMessage | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Modal-local state
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

  // Initial fetch
  useEffect(() => {
    let active = true;
    const loadInitial = async () => {
      setIsLoading(true);
      try {
        await fetchMessages(true);
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };
    loadInitial();
    return () => { active = false; };
  }, [fetchMessages]);

  // Listen for real-time message-created events from Tauri backend
  useEffect(() => {
    const unlisten = listen<RawPersonaMessage>('message-created', (event) => {
      const raw = event.payload;
      const allPersonas = usePersonaStore.getState().personas;
      const p = allPersonas.find((persona) => persona.id === raw.persona_id);
      const enriched: PersonaMessage = {
        ...raw,
        persona_name: p?.name,
        persona_icon: p?.icon ?? undefined,
        persona_color: p?.color ?? undefined,
      };
      usePersonaStore.setState((state) => {
        const exists = state.messages.some((m) => m.id === enriched.id);
        if (exists) return state;
        return {
          messages: [enriched, ...state.messages],
          messagesTotal: state.messagesTotal + 1,
        };
      });
      fetchUnreadMessageCount();
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [fetchUnreadMessageCount]);

  // Client-side filtering (filter + persona)
  const filteredMessages = useMemo(() => {
    let result = messages;
    if (selectedPersonaId) {
      result = result.filter((m) => m.persona_id === selectedPersonaId);
    }
    switch (filter) {
      case 'unread': return result.filter((m) => !m.is_read);
      case 'high': return result.filter((m) => m.priority === 'high');
      default: return result;
    }
  }, [messages, filter, selectedPersonaId]);

  const handleLoadMore = () => {
    fetchMessages(false);
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await fetchMessages(true);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Open modal: mark as read + fetch deliveries
  const handleRowClick = useCallback((msg: PersonaMessage) => {
    setSelectedMsg(msg);
    setConfirmingDelete(false);
    setCopiedId(false);

    // Mark as read
    if (!msg.is_read) {
      markMessageAsRead(msg.id);
    }

    // Fetch deliveries
    setDeliveriesLoading(true);
    getMessageDeliveries(msg.id)
      .then((result) => setDeliveries(result))
      .catch(() => setDeliveries([]))
      .finally(() => setDeliveriesLoading(false));
  }, [markMessageAsRead]);

  const handleCloseModal = useCallback(() => {
    setSelectedMsg(null);
    setDeliveries([]);
    setDeliveriesLoading(false);
    setConfirmingDelete(false);
    setCopiedId(false);
  }, []);

  const handleDelete = useCallback(() => {
    if (!selectedMsg) return;
    deleteMessage(selectedMsg.id);
    handleCloseModal();
  }, [selectedMsg, deleteMessage, handleCloseModal]);

  const remaining = messagesTotal - messages.length;

  const { parentRef, virtualizer } = useVirtualList(filteredMessages, 40);

  const badgeCounts: Record<FilterType, number> = useMemo(() => ({
    all: 0,
    unread: unreadMessageCount,
    high: messages.filter((m) => m.priority === 'high').length,
  }), [messages, unreadMessageCount]);

  const defaultPriority = { color: 'text-foreground/80', bgColor: 'bg-secondary/30', borderColor: 'border-primary/15', label: 'Normal' };

  return (
    <ContentBox>
      <ContentHeader
        icon={<MessageSquare className="w-5 h-5 text-indigo-400" />}
        iconColor="indigo"
        title="Messages"
        subtitle={`${messagesTotal} message${messagesTotal !== 1 ? 's' : ''} recorded`}
        actions={
          <>
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="p-1.5 rounded-lg text-muted-foreground/80 hover:text-muted-foreground hover:bg-secondary/50 disabled:opacity-60 transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => markAllMessagesAsRead()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-blue-400/80 hover:text-blue-400 bg-blue-500/10 border border-blue-500/20 hover:bg-blue-500/15 transition-all"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              Mark All Read
            </button>
          </>
        }
      />

      {/* Filter bar + persona select */}
      <FilterBar<FilterType>
        options={(['all', 'unread', 'high'] as FilterType[]).map((id) => ({
          id,
          label: FILTER_LABELS[id],
          badge: badgeCounts[id],
        }))}
        value={filter}
        onChange={setFilter}
        layoutIdPrefix="message-filter"
        summary={`Showing ${filteredMessages.length} of ${messagesTotal}`}
        trailing={
          <PersonaSelect
            value={selectedPersonaId}
            onChange={setSelectedPersonaId}
            personas={personas}
          />
        }
      />

      {/* Message table */}
      <ContentBody flex>
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center p-4 md:p-6">
            <div className="text-center">
              <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-secondary/40 border border-primary/15 flex items-center justify-center">
                <Loader2 className="w-5 h-5 text-primary/70 animate-spin" />
              </div>
              <p className="text-sm text-muted-foreground/90">Loading messages...</p>
            </div>
          </div>
        ) : filteredMessages.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-4 md:p-6">
            <div className="text-center">
              <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-secondary/40 border border-primary/15 flex items-center justify-center">
                <MessageSquare className="w-5 h-5 text-muted-foreground/80" />
              </div>
              {filter !== 'all' || selectedPersonaId ? (
                <>
                  <p className="text-sm text-muted-foreground/90">
                    No {filter === 'unread' ? 'unread' : filter === 'high' ? 'high-priority' : ''} messages
                    {selectedPersonaId ? ' for the selected persona' : ''}
                  </p>
                  <p className="text-sm text-muted-foreground/80 mt-1">Try switching to "All" to see all messages</p>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground/90">No messages yet</p>
                  <p className="text-sm text-muted-foreground/80 mt-1.5 max-w-sm mx-auto leading-relaxed">
                    Messages are created when agents run and communicate with each other.
                    Run an agent execution or set up a multi-agent pipeline to start seeing messages here.
                  </p>
                  <button
                    onClick={() => {
                      const store = usePersonaStore.getState();
                      store.setSidebarSection('personas');
                    }}
                    className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-primary bg-primary/10 border border-primary/20 hover:bg-primary/15 transition-colors"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Go to Agents
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
          <div ref={parentRef} className="flex-1 overflow-y-auto">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm">
                <tr className="border-b border-primary/10">
                  <th className="text-left text-[11px] text-muted-foreground/80 uppercase tracking-wider font-medium px-4 py-2.5 w-[180px]">Persona</th>
                  <th className="text-left text-[11px] text-muted-foreground/80 uppercase tracking-wider font-medium px-4 py-2.5">Title</th>
                  <th className="text-left text-[11px] text-muted-foreground/80 uppercase tracking-wider font-medium px-4 py-2.5 w-[90px]">Priority</th>
                  <th className="text-center text-[11px] text-muted-foreground/80 uppercase tracking-wider font-medium px-4 py-2.5 w-[70px]">Status</th>
                  <th className="text-right text-[11px] text-muted-foreground/80 uppercase tracking-wider font-medium px-4 py-2.5 w-[100px]">Created</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={5} style={{ padding: 0, border: 'none' }}>
                    <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
                      {virtualizer.getVirtualItems().map((virtualRow) => {
                        const message = filteredMessages[virtualRow.index]!;
                        const priority = priorityConfig[message.priority] ?? defaultPriority;
                        return (
                          <div
                            key={message.id}
                            role="row"
                            onClick={() => handleRowClick(message)}
                            style={{
                              position: 'absolute',
                              top: 0,
                              transform: `translateY(${virtualRow.start}px)`,
                              width: '100%',
                              height: `${virtualRow.size}px`,
                            }}
                            className="flex items-center hover:bg-white/[0.03] cursor-pointer transition-colors border-b border-primary/[0.06]"
                          >
                            {/* Persona */}
                            <div className="flex items-center gap-2 px-4 w-[180px] flex-shrink-0">
                              <div
                                className="w-6 h-6 rounded-md flex items-center justify-center text-sm border border-primary/15 flex-shrink-0"
                                style={{ backgroundColor: (message.persona_color || '#6366f1') + '15' }}
                              >
                                {message.persona_icon || '?'}
                              </div>
                              <span className="text-sm text-muted-foreground/80 truncate">
                                {message.persona_name || 'Unknown'}
                              </span>
                            </div>

                            {/* Title */}
                            <div className="flex-1 px-4 min-w-0">
                              <span className={`text-sm truncate block ${message.is_read ? 'text-foreground/80' : 'text-foreground/90 font-medium'}`}>
                                {message.title || message.content.slice(0, 80)}
                              </span>
                            </div>

                            {/* Priority */}
                            <div className="px-4 w-[90px] flex-shrink-0">
                              <span className={`inline-flex px-2 py-0.5 rounded-md text-xs font-medium border ${priority.bgColor} ${priority.color} ${priority.borderColor}`}>
                                {priority.label}
                              </span>
                            </div>

                            {/* Status (read/unread dot) */}
                            <div className="px-4 w-[70px] flex-shrink-0 flex justify-center">
                              {!message.is_read ? (
                                <div className="w-2.5 h-2.5 rounded-full bg-blue-500" title="Unread" />
                              ) : (
                                <div className="w-2.5 h-2.5 rounded-full bg-muted-foreground/20" title="Read" />
                              )}
                            </div>

                            {/* Created */}
                            <div className="px-4 w-[100px] flex-shrink-0 text-right">
                              <span className="text-xs text-muted-foreground/80">
                                {formatRelativeTime(message.created_at)}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>

            {/* Load More */}
            {remaining > 0 && (
              <div className="p-4">
                <button
                  onClick={handleLoadMore}
                  className="w-full py-2.5 text-sm text-muted-foreground/80 hover:text-muted-foreground bg-secondary/20 hover:bg-secondary/40 rounded-xl border border-primary/15 transition-all"
                >
                  Load More ({remaining} remaining)
                </button>
              </div>
            )}
          </div>
        )}
      </ContentBody>

      {/* Detail Modal */}
      <AnimatePresence>
        {selectedMsg && (
          <DetailModal
            title={selectedMsg.title || 'Message'}
            subtitle={`From ${selectedMsg.persona_name || 'Unknown'} \u00b7 ${formatRelativeTime(selectedMsg.created_at)}`}
            onClose={handleCloseModal}
            actions={
              <>
                {/* Metadata */}
                <div className="flex items-center gap-4 text-xs text-muted-foreground/80 mr-auto">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      navigator.clipboard.writeText(selectedMsg.id).then(() => {
                        setCopiedId(true);
                        setTimeout(() => setCopiedId(false), 2000);
                      }).catch(() => {});
                    }}
                    className="inline-flex items-center gap-1 hover:text-muted-foreground transition-colors"
                    title={selectedMsg.id}
                  >
                    ID: <span className="font-mono">{selectedMsg.id.slice(0, 8)}</span>
                    {copiedId ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                  {selectedMsg.execution_id && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const store = usePersonaStore.getState();
                        store.selectPersona(selectedMsg.persona_id);
                        store.setEditorTab('use-cases');
                      }}
                      className="inline-flex items-center gap-1 text-blue-400/70 hover:text-blue-400 transition-colors"
                      title={selectedMsg.execution_id}
                    >
                      View Execution
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  )}
                  <span>Type: {selectedMsg.content_type}</span>
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
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                )}
              </>
            }
          >
            {/* Content section */}
            <div className="space-y-5">
              <div>
                <div className="text-xs font-mono text-muted-foreground/90 uppercase mb-2">Content</div>
                {selectedMsg.content_type === 'markdown' ? (
                  <MarkdownRenderer content={selectedMsg.content} className="text-sm" />
                ) : (
                  <div className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">
                    {selectedMsg.content}
                  </div>
                )}
              </div>

              {/* Delivery Status section */}
              <div>
                <div className="text-xs font-mono text-muted-foreground/90 uppercase mb-2 flex items-center gap-1.5">
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
                      const StatusIcon = statusCfg.icon;
                      return (
                        <div
                          key={d.id}
                          className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg border ${statusCfg.bgColor} ${statusCfg.borderColor}`}
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
        )}
      </AnimatePresence>
    </ContentBox>
  );
}
