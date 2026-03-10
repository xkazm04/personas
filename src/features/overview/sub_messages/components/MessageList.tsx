import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import { MessageSquare, CheckCheck, RefreshCw, Send } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { FilterBar } from '@/features/shared/components/overlays/FilterBar';
import { PersonaSelect } from '@/features/overview/sub_usage/components/PersonaSelect';
import { useMessageCreatedListener } from '@/hooks/realtime/useMessageCreatedListener';
import { useVirtualList } from '@/hooks/utility/interaction/useVirtualList';
import { formatRelativeTime } from '@/lib/utils/formatters';
import type { PersonaMessage } from '@/lib/types/types';
import type { PersonaMessage as RawPersonaMessage } from '@/lib/bindings/PersonaMessage';
import { priorityConfig, FILTER_LABELS, GRID_TEMPLATE_COLUMNS, type FilterType } from '../libs/messageHelpers';
import { MessageDetailModal } from './MessageDetailModal';
import ContentLoader from '@/features/shared/components/progress/ContentLoader';

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
  const fetchUnreadMessageCountRef = useRef(fetchUnreadMessageCount);
  fetchUnreadMessageCountRef.current = fetchUnreadMessageCount;

  useEffect(() => {
    let active = true;
    const loadInitial = async () => {
      setIsLoading(true);
      try { await fetchMessages(true); }
      finally { if (active) setIsLoading(false); }
    };
    loadInitial();
    return () => { active = false; };
  }, [fetchMessages]);

  const handleMessageCreated = useCallback((raw: RawPersonaMessage) => {
    const allPersonas = usePersonaStore.getState().personas;
    const p = allPersonas.find((persona) => persona.id === raw.persona_id);
    const enriched: PersonaMessage = { ...raw, persona_name: p?.name, persona_icon: p?.icon ?? undefined, persona_color: p?.color ?? undefined };
    usePersonaStore.setState((state) => {
      const exists = state.messages.some((m) => m.id === enriched.id);
      if (exists) return state;
      return { messages: [enriched, ...state.messages], messagesTotal: state.messagesTotal + 1 };
    });
    fetchUnreadMessageCountRef.current();
  }, []);

  useMessageCreatedListener(handleMessageCreated);

  const filteredMessages = useMemo(() => {
    let result = messages;
    if (selectedPersonaId) result = result.filter((m) => m.persona_id === selectedPersonaId);
    switch (filter) {
      case 'unread': return result.filter((m) => !m.is_read);
      case 'high': return result.filter((m) => m.priority === 'high');
      default: return result;
    }
  }, [messages, filter, selectedPersonaId]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try { await fetchMessages(true); }
    finally { setIsRefreshing(false); }
  };

  const handleRowClick = useCallback((msg: PersonaMessage) => {
    setSelectedMsg(msg);
    if (!msg.is_read) markMessageAsRead(msg.id);
  }, [markMessageAsRead]);

  const remaining = messagesTotal - messages.length;
  const { parentRef, virtualizer } = useVirtualList(filteredMessages, 40);

  const badgeCounts: Record<FilterType, number> = useMemo(() => ({
    all: 0, unread: unreadMessageCount, high: messages.filter((m) => m.priority === 'high').length,
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
            <button onClick={handleRefresh} disabled={isRefreshing} className="p-1.5 rounded-lg text-muted-foreground/80 hover:text-muted-foreground hover:bg-secondary/50 disabled:opacity-60 transition-colors" title="Refresh">
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={() => markAllMessagesAsRead()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium text-blue-400/80 hover:text-blue-400 bg-blue-500/10 border border-blue-500/20 hover:bg-blue-500/15 transition-all">
              <CheckCheck className="w-3.5 h-3.5" /> Mark All Read
            </button>
          </>
        }
      />

      <FilterBar<FilterType>
        options={(['all', 'unread', 'high'] as FilterType[]).map((id) => ({ id, label: FILTER_LABELS[id], badge: badgeCounts[id] }))}
        value={filter} onChange={setFilter} layoutIdPrefix="message-filter"
        summary={`Showing ${filteredMessages.length} of ${messagesTotal}`}
        trailing={<PersonaSelect value={selectedPersonaId} onChange={setSelectedPersonaId} personas={personas} />}
      />

      <ContentBody flex>
        {isLoading ? (
          <ContentLoader variant="panel" hint="messages" />
        ) : filteredMessages.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-4 md:p-6">
            <div className="text-center">
              <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-secondary/40 border border-primary/15 flex items-center justify-center"><MessageSquare className="w-5 h-5 text-muted-foreground/80" /></div>
              {filter !== 'all' || selectedPersonaId ? (
                <><p className="text-sm text-muted-foreground/90">No {filter === 'unread' ? 'unread' : filter === 'high' ? 'high-priority' : ''} messages{selectedPersonaId ? ' for the selected persona' : ''}</p><p className="text-sm text-muted-foreground/80 mt-1">Try switching to "All" to see all messages</p></>
              ) : (
                <><p className="text-sm text-muted-foreground/90">No messages yet</p><p className="text-sm text-muted-foreground/80 mt-1.5 max-w-sm mx-auto leading-relaxed">Messages are created when agents run and communicate with each other.</p>
                  <button onClick={() => usePersonaStore.getState().setSidebarSection('personas')} className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium text-primary bg-primary/10 border border-primary/20 hover:bg-primary/15 transition-colors"><Send className="w-3.5 h-3.5" />Go to Agents</button></>
              )}
            </div>
          </div>
        ) : (
          <div ref={parentRef} className="flex-1 overflow-y-auto">
            <div role="grid" aria-rowcount={filteredMessages.length} aria-colcount={5} className="w-full">
              <div role="row" className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-primary/10 grid" style={{ gridTemplateColumns: GRID_TEMPLATE_COLUMNS }}>
                <div role="columnheader" className="text-left text-sm text-muted-foreground/80 uppercase tracking-wider font-medium px-4 py-2.5">Persona</div>
                <div role="columnheader" className="text-left text-sm text-muted-foreground/80 uppercase tracking-wider font-medium px-4 py-2.5">Title</div>
                <div role="columnheader" className="text-left text-sm text-muted-foreground/80 uppercase tracking-wider font-medium px-4 py-2.5">Priority</div>
                <div role="columnheader" className="text-center text-sm text-muted-foreground/80 uppercase tracking-wider font-medium px-4 py-2.5">Status</div>
                <div role="columnheader" className="text-right text-sm text-muted-foreground/80 uppercase tracking-wider font-medium px-4 py-2.5">Created</div>
              </div>
              <div role="rowgroup" style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const message = filteredMessages[virtualRow.index]!;
                  const priority = priorityConfig[message.priority] ?? defaultPriority;
                  return (
                    <div key={message.id} role="row" tabIndex={0} onClick={() => handleRowClick(message)}
                      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); handleRowClick(message); } }}
                      style={{ position: 'absolute', top: 0, transform: `translateY(${virtualRow.start}px)`, width: '100%', height: `${virtualRow.size}px`, gridTemplateColumns: GRID_TEMPLATE_COLUMNS }}
                      className="grid items-center hover:bg-white/[0.03] cursor-pointer transition-colors border-b border-primary/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
                    >
                      <div role="gridcell" className="flex items-center gap-2 px-4 min-w-0">
                        <div className="w-6 h-6 rounded-lg flex items-center justify-center text-sm border border-primary/15 flex-shrink-0" style={{ backgroundColor: (message.persona_color || '#6366f1') + '15' }}>{message.persona_icon || '?'}</div>
                        <span className="text-sm text-muted-foreground/80 truncate">{message.persona_name || 'Unknown'}</span>
                      </div>
                      <div role="gridcell" className="px-4 min-w-0"><span className={`text-sm truncate block ${message.is_read ? 'text-foreground/80' : 'text-foreground/90 font-medium'}`}>{message.title || message.content.slice(0, 80)}</span></div>
                      <div role="gridcell" className="px-4"><span className={`inline-flex px-2 py-0.5 rounded-lg text-sm font-medium border ${priority.bgColor} ${priority.color} ${priority.borderColor}`}>{priority.label}</span></div>
                      <div role="gridcell" className="px-4 flex justify-center">{!message.is_read ? <div className="w-2.5 h-2.5 rounded-full bg-blue-500" title="Unread" aria-label="Unread message" /> : <div className="w-2.5 h-2.5 rounded-full bg-muted-foreground/20" title="Read" aria-hidden="true" />}</div>
                      <div role="gridcell" className="px-4 text-right"><span className="text-sm text-muted-foreground/80">{formatRelativeTime(message.created_at)}</span></div>
                    </div>
                  );
                })}
              </div>
            </div>
            {remaining > 0 && (<div className="p-4"><button onClick={() => fetchMessages(false)} className="w-full py-2.5 text-sm text-muted-foreground/80 hover:text-muted-foreground bg-secondary/20 hover:bg-secondary/40 rounded-xl border border-primary/15 transition-all">Load More ({remaining} remaining)</button></div>)}
          </div>
        )}
      </ContentBody>

      <AnimatePresence>
        {selectedMsg && <MessageDetailModal message={selectedMsg} onClose={() => setSelectedMsg(null)} onDelete={() => deleteMessage(selectedMsg.id)} />}
      </AnimatePresence>
    </ContentBox>
  );
}
