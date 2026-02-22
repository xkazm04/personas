import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronRight, MessageSquare, CheckCheck, RefreshCw, Trash2, Send, AlertCircle, Clock, CheckCircle2, Loader2, ExternalLink, Check, X, Copy } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/ContentLayout';
import { MarkdownRenderer } from '@/features/shared/components/MarkdownRenderer';
import type { PersonaMessage } from '@/lib/types/types';
import type { PersonaMessageDelivery } from '@/lib/bindings/PersonaMessageDelivery';
import { getMessageDeliveries } from '@/api/tauriApi';
import { formatRelativeTime } from '@/lib/utils/formatters';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const priorityConfig: Record<string, { color: string; bgColor: string; borderColor: string; label: string }> = {
  high: { color: 'text-red-400', bgColor: 'bg-red-500/10', borderColor: 'border-red-500/30', label: 'High' },
  normal: { color: 'text-foreground/80', bgColor: 'bg-secondary/30', borderColor: 'border-primary/15', label: 'Normal' },
  low: { color: 'text-muted-foreground/90', bgColor: 'bg-muted/20', borderColor: 'border-muted-foreground/20', label: 'Low' },
};

type FilterType = 'all' | 'unread' | 'high';

const filterOptions: Array<{ id: FilterType; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'high', label: 'High Priority' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MessageList() {
  const messages = usePersonaStore((s) => s.messages);
  const messagesTotal = usePersonaStore((s) => s.messagesTotal);
  const fetchMessages = usePersonaStore((s) => s.fetchMessages);
  const markMessageAsRead = usePersonaStore((s) => s.markMessageAsRead);
  const markAllMessagesAsRead = usePersonaStore((s) => s.markAllMessagesAsRead);
  const deleteMessage = usePersonaStore((s) => s.deleteMessage);

  const [filter, setFilter] = useState<FilterType>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Fetch all messages (no server-side filtering available)
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
    const interval = setInterval(() => {
      fetchMessages(true);
    }, 10000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [fetchMessages]);

  // Client-side filtering
  const filteredMessages = useMemo(() => {
    switch (filter) {
      case 'unread': return messages.filter((m) => !m.is_read);
      case 'high': return messages.filter((m) => m.priority === 'high');
      default: return messages;
    }
  }, [messages, filter]);

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

  const remaining = messagesTotal - messages.length;

  const badgeCounts: Record<FilterType, number> = useMemo(() => ({
    all: 0,
    unread: messages.filter((m) => !m.is_read).length,
    high: messages.filter((m) => m.priority === 'high').length,
  }), [messages]);

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

      {/* Filter bar */}
      <div className="px-4 md:px-6 py-3 border-b border-primary/10 flex items-center gap-2 flex-shrink-0">
        {filterOptions.map((opt) => {
          const count = badgeCounts[opt.id];
          return (
            <button
              key={opt.id}
              onClick={() => setFilter(opt.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border flex items-center gap-1.5 ${
                filter === opt.id
                  ? 'bg-primary/15 text-primary border-primary/30'
                  : 'bg-secondary/30 text-muted-foreground/80 border-primary/15 hover:text-muted-foreground hover:bg-secondary/50'
              }`}
            >
              {opt.label}
              {count > 0 && (
                <span className="text-sm bg-primary/20 text-primary rounded-full min-w-[18px] px-1 inline-flex items-center justify-center">
                  {count}
                </span>
              )}
            </button>
          );
        })}
        <span className="ml-auto text-sm font-mono text-muted-foreground/80">
          Showing {filteredMessages.length} of {messagesTotal}
        </span>
      </div>

      {/* Message list */}
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
              {filter !== 'all' ? (
                <>
                  <p className="text-sm text-muted-foreground/90">No {filter === 'unread' ? 'unread' : 'high-priority'} messages</p>
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
          <div className="p-4 md:p-6 space-y-1.5">
            <AnimatePresence initial={false}>
              {filteredMessages.map((message) => (
                <MessageRow
                  key={message.id}
                  message={message}
                  isExpanded={expandedId === message.id}
                  onToggle={() => {
                    setExpandedId(expandedId === message.id ? null : message.id);
                    if (!message.is_read) markMessageAsRead(message.id);
                  }}
                  onDelete={() => deleteMessage(message.id)}
                />
              ))}
            </AnimatePresence>

            {/* Load More */}
            {remaining > 0 && (
              <button
                onClick={handleLoadMore}
                className="w-full py-2.5 text-sm text-muted-foreground/80 hover:text-muted-foreground bg-secondary/20 hover:bg-secondary/40 rounded-xl border border-primary/15 transition-all mt-2"
              >
                Load More ({remaining} remaining)
              </button>
            )}
          </div>
        )}
      </ContentBody>
    </ContentBox>
  );
}

// ---------------------------------------------------------------------------
// Message Row
// ---------------------------------------------------------------------------

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

function MessageRow({
  message,
  isExpanded,
  onToggle,
  onDelete,
}: {
  message: PersonaMessage;
  isExpanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const defaultPriority = { color: 'text-foreground/80', bgColor: 'bg-secondary/30', borderColor: 'border-primary/15', label: 'Normal' };
  const priority = priorityConfig[message.priority] ?? defaultPriority;

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

  const fetchDeliveries = useCallback(async () => {
    setDeliveriesLoading(true);
    try {
      const result = await getMessageDeliveries(message.id);
      setDeliveries(result);
    } catch {
      setDeliveries([]);
    } finally {
      setDeliveriesLoading(false);
    }
  }, [message.id]);

  useEffect(() => {
    if (isExpanded) {
      fetchDeliveries();
    }
  }, [isExpanded, fetchDeliveries]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      className="rounded-xl border border-primary/15 bg-secondary/20 hover:bg-secondary/30 transition-colors overflow-hidden"
    >
      {/* Main row — wide (md+) */}
      <button
        onClick={onToggle}
        className="w-full hidden md:flex items-center gap-3 px-3 py-2.5 text-left"
      >
        <div className="text-muted-foreground/80">
          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </div>
        {!message.is_read && (
          <div className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" aria-label="Unread">
            <span className="sr-only">Unread</span>
          </div>
        )}
        <div className="flex items-center gap-2 min-w-[120px]">
          <div
            className="w-6 h-6 rounded-md flex items-center justify-center text-sm border border-primary/15"
            style={{ backgroundColor: (message.persona_color || '#6366f1') + '15' }}
          >
            {message.persona_icon || '?'}
          </div>
          <span className="text-sm text-muted-foreground/80 truncate max-w-[80px]">
            {message.persona_name || 'Unknown'}
          </span>
        </div>
        <span className={`flex-1 text-sm truncate ${message.is_read ? 'text-foreground/80' : 'text-foreground/90 font-medium'}`}>
          {message.title || message.content.slice(0, 80)}
        </span>
        {message.priority !== 'normal' && (
          <div className={`px-2 py-0.5 rounded-md text-sm font-medium border ${priority.bgColor} ${priority.color} ${priority.borderColor}`}>
            {priority.label}
          </div>
        )}
        <span className="text-sm text-muted-foreground/80 min-w-[70px] text-right">
          {formatRelativeTime(message.created_at)}
        </span>
      </button>

      {/* Main row — narrow (< md) stacked card */}
      <button
        onClick={onToggle}
        className="w-full flex md:hidden flex-col gap-1.5 px-3 py-2.5 text-left"
      >
        {/* Line 1: persona + priority */}
        <div className="flex items-center gap-2">
          <div className="text-muted-foreground/80">
            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </div>
          {!message.is_read && (
            <div className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" aria-label="Unread">
              <span className="sr-only">Unread</span>
            </div>
          )}
          <div
            className="w-5 h-5 rounded-md flex items-center justify-center text-sm border border-primary/15 flex-shrink-0"
            style={{ backgroundColor: (message.persona_color || '#6366f1') + '15' }}
          >
            {message.persona_icon || '?'}
          </div>
          <span className="text-sm text-muted-foreground/80 truncate">
            {message.persona_name || 'Unknown'}
          </span>
          <div className="flex-1" />
          {message.priority !== 'normal' && (
            <div className={`px-2 py-0.5 rounded-md text-sm font-medium border ${priority.bgColor} ${priority.color} ${priority.borderColor}`}>
              {priority.label}
            </div>
          )}
        </div>
        {/* Line 2: title */}
        <span className={`text-sm truncate pl-6 ${message.is_read ? 'text-foreground/80' : 'text-foreground/90 font-medium'}`}>
          {message.title || message.content.slice(0, 80)}
        </span>
        {/* Line 3: timestamp */}
        <span className="text-sm text-muted-foreground/80 pl-6">
          {formatRelativeTime(message.created_at)}
        </span>
      </button>

      {/* Expanded detail */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-1 border-t border-primary/15 space-y-3">
              {/* Content */}
              <div>
                <div className="text-sm font-mono text-muted-foreground/90 uppercase mb-1.5">Content</div>
                {message.content_type === 'markdown' ? (
                  <MarkdownRenderer content={message.content} className="text-sm" />
                ) : (
                  <div className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">
                    {message.content}
                  </div>
                )}
              </div>

              {/* Delivery Status */}
              <div>
                <div className="text-sm font-mono text-muted-foreground/90 uppercase mb-1.5 flex items-center gap-1.5">
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

              {/* Actions */}
              <div className="flex items-center gap-2 pt-1">
                {confirmingDelete ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); onDelete(); }}
                      className="p-1.5 bg-red-500/15 hover:bg-red-500/25 rounded-lg transition-colors"
                      title="Confirm delete"
                    >
                      <Check className="w-4 h-4 text-red-400" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmingDelete(false); }}
                      className="p-1.5 hover:bg-secondary/60 rounded-lg transition-colors"
                      title="Cancel"
                    >
                      <X className="w-4 h-4 text-muted-foreground/90" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
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
              </div>

              {/* Metadata */}
              <div className="flex items-center gap-4 text-sm text-muted-foreground/80">
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
                      store.setEditorTab('executions');
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
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
