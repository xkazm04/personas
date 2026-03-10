import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { MessageSquare, CheckCheck, RefreshCw, Send, Loader2 } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { FilterBar } from '@/features/shared/components/overlays/FilterBar';
import { PersonaSelect } from '@/features/overview/sub_usage/DashboardFilters';
import { useMessageCreatedListener } from '@/hooks/realtime/useMessageCreatedListener';
import type { PersonaMessage } from '@/lib/types/types';
import type { PersonaMessage as RawPersonaMessage } from '@/lib/bindings/PersonaMessage';
import { type FilterType, FILTER_LABELS } from './messageListConstants';
import { MessageTable } from './MessageTable';
import { MessageDetailModal } from './MessageDetailModal';

export default function MessageList() {
  const messages = usePersonaStore((s) => s.messages);
  const messagesTotal = usePersonaStore((s) => s.messagesTotal);
  const unreadMessageCount = usePersonaStore((s) => s.unreadMessageCount);
  const fetchMessages = usePersonaStore((s) => s.fetchMessages);
  const fetchUnreadMessageCount = usePersonaStore((s) => s.fetchUnreadMessageCount);
  const markMessageAsRead = usePersonaStore((s) => s.markMessageAsRead);
  const markAllMessagesAsRead = usePersonaStore((s) => s.markAllMessagesAsRead);
  const personas = usePersonaStore((s) => s.personas);

  const [filter, setFilter] = useState<FilterType>('all');
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>('');
  const [selectedMsg, setSelectedMsg] = useState<PersonaMessage | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchUnreadMessageCountRef = useRef(fetchUnreadMessageCount);
  fetchUnreadMessageCountRef.current = fetchUnreadMessageCount;

  // Initial fetch
  useEffect(() => {
    let active = true;
    const loadInitial = async () => {
      setIsLoading(true);
      try {
        await fetchMessages(true);
      } finally {
        if (active) setIsLoading(false);
      }
    };
    loadInitial();
    return () => { active = false; };
  }, [fetchMessages]);

  const handleMessageCreated = useCallback((raw: RawPersonaMessage) => {
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
    fetchUnreadMessageCountRef.current();
  }, []);

  useMessageCreatedListener(handleMessageCreated);

  // Client-side filtering
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

  const handleLoadMore = () => fetchMessages(false);

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

  const badgeCounts: Record<FilterType, number> = useMemo(() => ({
    all: 0,
    unread: unreadMessageCount,
    high: messages.filter((m) => m.priority === 'high').length,
  }), [messages, unreadMessageCount]);

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
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium text-blue-400/80 hover:text-blue-400 bg-blue-500/10 border border-blue-500/20 hover:bg-blue-500/15 transition-all"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              Mark All Read
            </button>
          </>
        }
      />

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
                    className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium text-primary bg-primary/10 border border-primary/20 hover:bg-primary/15 transition-colors"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Go to Agents
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
          <MessageTable
            filteredMessages={filteredMessages}
            onRowClick={handleRowClick}
            remaining={remaining}
            onLoadMore={handleLoadMore}
          />
        )}
      </ContentBody>

      <MessageDetailModal
        message={selectedMsg}
        onClose={() => setSelectedMsg(null)}
      />
    </ContentBox>
  );
}
