import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { MessageSquare, CheckCheck, RefreshCw, Plus, List, GitBranch, ChevronRight, ChevronDown, MessageCircle, BookOpen } from 'lucide-react';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { useOverviewStore } from "@/stores/overviewStore";
import { useShallow } from 'zustand/react/shallow';
import { useAgentStore } from "@/stores/agentStore";
import { usePersonaMap, useEnrichedRecords } from "@/hooks/utility/data/usePersonaMap";
import { useSystemStore } from "@/stores/systemStore";
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { FilterBar } from '@/features/shared/components/overlays/FilterBar';
import { PersonaSelect } from '@/features/overview/sub_usage/components/PersonaSelect';
import { useMessageCreatedListener } from '@/hooks/realtime/useMessageCreatedListener';
import { useVirtualList } from '@/hooks/utility/interaction/useVirtualList';
import { formatRelativeTime } from '@/lib/utils/formatters';
import type { PersonaMessage } from '@/lib/types/types';
import type { PersonaMessage as RawPersonaMessage } from '@/lib/bindings/PersonaMessage';
import { seedMockMessage } from '@/api/overview/messages';
import { PersonaColumnFilter } from '@/features/shared/components/forms/PersonaColumnFilter';
import { priorityConfig, FILTER_LABELS, GRID_TEMPLATE_COLUMNS, type FilterType, deliveryStatusConfig } from '../libs/messageHelpers';

import { ROW_SEPARATOR, ROW_SEPARATOR_T } from '@/lib/design/listTokens';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { MessageDetailModal } from './MessageDetailModal';
import ContentLoader from '@/features/shared/components/progress/ContentLoader';
import { createLogger } from "@/lib/log";

const logger = createLogger("message-list");

export default function MessageList() {
  const {
    messages, messagesTotal, unreadMessageCount,
    fetchMessages, fetchUnreadMessageCount,
    markMessageAsRead, markAllMessagesAsRead, deleteMessage,
    deliverySummaries,
    viewMode, setViewMode,
    threadSummaries, threadCount, expandedThreadId, threadReplies,
    fetchThreadSummaries, expandThread, collapseThread,
  } = useOverviewStore(useShallow((s) => ({
    messages: s.messages,
    messagesTotal: s.messagesTotal,
    unreadMessageCount: s.unreadMessageCount,
    fetchMessages: s.fetchMessages,
    fetchUnreadMessageCount: s.fetchUnreadMessageCount,
    markMessageAsRead: s.markMessageAsRead,
    markAllMessagesAsRead: s.markAllMessagesAsRead,
    deleteMessage: s.deleteMessage,
    deliverySummaries: s.deliverySummaries,
    viewMode: s.viewMode,
    setViewMode: s.setViewMode,
    threadSummaries: s.threadSummaries,
    threadCount: s.threadCount,
    expandedThreadId: s.expandedThreadId,
    threadReplies: s.threadReplies,
    fetchThreadSummaries: s.fetchThreadSummaries,
    expandThread: s.expandThread,
    collapseThread: s.collapseThread,
  })));
  const personas = useAgentStore((s) => s.personas);
  const personaMap = usePersonaMap();
  const enrichedMessages = useEnrichedRecords(messages, personaMap);

  // Enrich thread replies at render time (avoids baking stale persona info)
  const enrichedThreadReplies = useMemo(() => {
    const result = new Map<string, PersonaMessage[]>();
    for (const [threadId, replies] of threadReplies) {
      result.set(threadId, replies.map((r) => {
        const p = personaMap.get(r.persona_id);
        return { ...r, persona_name: p?.name, persona_icon: p?.icon ?? undefined, persona_color: p?.color ?? undefined };
      }));
    }
    return result;
  }, [threadReplies, personaMap]);

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
      try {
        if (viewMode === 'threaded') {
          await fetchThreadSummaries(true, selectedPersonaId || undefined);
        } else {
          await fetchMessages(true);
        }
      }
      finally { if (active) setIsLoading(false); }
    };
    loadInitial();
    return () => { active = false; };
  }, [fetchMessages, fetchThreadSummaries, viewMode, selectedPersonaId]);

  const handleMessageCreated = useCallback((raw: RawPersonaMessage) => {
    useOverviewStore.setState((state) => {
      const exists = state.messages.some((m) => m.id === raw.id);
      if (exists) return state;
      return { messages: [raw, ...state.messages], messagesTotal: state.messagesTotal + 1 };
    });
    fetchUnreadMessageCountRef.current();
    // Refresh threads if in threaded mode
    if (useOverviewStore.getState().viewMode === 'threaded') {
      void useOverviewStore.getState().fetchThreadSummaries(true);
    }
  }, []);

  useMessageCreatedListener(handleMessageCreated);

  const filteredMessages = useMemo(() => {
    let result = enrichedMessages;
    if (selectedPersonaId) result = result.filter((m) => m.persona_id === selectedPersonaId);
    switch (filter) {
      case 'unread': return result.filter((m) => !m.is_read);
      case 'high': return result.filter((m) => m.priority === 'high');
      default: return result;
    }
  }, [enrichedMessages, filter, selectedPersonaId]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      if (viewMode === 'threaded') {
        await fetchThreadSummaries(true, selectedPersonaId || undefined);
      } else {
        await fetchMessages(true);
      }
    }
    finally { setIsRefreshing(false); }
  };

  const handleRowClick = useCallback((msg: PersonaMessage) => {
    setSelectedMsg(msg);
    if (!msg.is_read) markMessageAsRead(msg.id);
  }, [markMessageAsRead]);

  const handleSeedMessage = useCallback(async () => {
    try { await seedMockMessage(); await fetchMessages(true); }
    catch (err) { logger.error('Failed to seed mock message', { error: err }); }
  }, [fetchMessages]);

  const remaining = messagesTotal - messages.length;
  const { parentRef, virtualizer } = useVirtualList(filteredMessages, 40);

  const badgeCounts: Record<FilterType, number> = useMemo(() => ({
    all: 0, unread: unreadMessageCount, high: messages.filter((m) => m.priority === 'high').length,
  }), [messages, unreadMessageCount]);

  const defaultPriority = { color: 'text-foreground/80', bgColor: 'bg-secondary/30', borderColor: 'border-primary/15', label: 'Normal' };

  const handleToggleThread = useCallback((threadId: string) => {
    if (expandedThreadId === threadId) {
      collapseThread();
    } else {
      void expandThread(threadId);
    }
  }, [expandedThreadId, expandThread, collapseThread]);

  const threadedRemaining = threadCount - threadSummaries.length;

  return (
    <ContentBox>
      <ContentHeader
        icon={<MessageSquare className="w-5 h-5 text-indigo-400" />}
        iconColor="indigo"
        title="Messages"
        subtitle={viewMode === 'threaded'
          ? `${threadCount} thread${threadCount !== 1 ? 's' : ''}`
          : `${messagesTotal} message${messagesTotal !== 1 ? 's' : ''} recorded`
        }
        actions={
          <>
            {import.meta.env.DEV && (
              <button onClick={handleSeedMessage} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl typo-heading bg-amber-500/10 text-amber-400 border border-amber-500/25 hover:bg-amber-500/20 transition-colors" title="Seed a mock message (dev only)">
                <Plus className="w-3.5 h-3.5" /> Mock Message
              </button>
            )}
            <div className="flex items-center rounded-lg border border-primary/15 overflow-hidden">
              <button
                onClick={() => setViewMode('flat')}
                className={`p-1.5 transition-colors ${viewMode === 'flat' ? 'bg-primary/10 text-primary' : 'text-muted-foreground/60 hover:text-muted-foreground'}`}
                title="Flat view"
              >
                <List className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setViewMode('threaded')}
                className={`p-1.5 transition-colors ${viewMode === 'threaded' ? 'bg-primary/10 text-primary' : 'text-muted-foreground/60 hover:text-muted-foreground'}`}
                title="Threaded view"
              >
                <GitBranch className="w-3.5 h-3.5" />
              </button>
            </div>
            <button onClick={handleRefresh} disabled={isRefreshing} className="p-1.5 rounded-lg text-muted-foreground/80 hover:text-muted-foreground hover:bg-secondary/50 disabled:opacity-60 transition-colors" title="Refresh">
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={() => markAllMessagesAsRead()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl typo-heading text-blue-400/80 hover:text-blue-400 bg-blue-500/10 border border-blue-500/20 hover:bg-blue-500/15 transition-all">
              <CheckCheck className="w-3.5 h-3.5" /> Mark All Read
            </button>
          </>
        }
      />

      {viewMode === 'flat' && (
        <FilterBar<FilterType>
          options={(['all', 'unread', 'high'] as FilterType[]).map((id) => ({ id, label: FILTER_LABELS[id], badge: badgeCounts[id] }))}
          value={filter} onChange={setFilter} layoutIdPrefix="message-filter"
          summary={`Showing ${filteredMessages.length} of ${messagesTotal}`}
        />
      )}
      {viewMode === 'threaded' && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-primary/10">
          <span className="text-sm text-muted-foreground/80">
            {threadSummaries.length} of {threadCount} threads
          </span>
          <PersonaSelect value={selectedPersonaId} onChange={setSelectedPersonaId} personas={personas} />
        </div>
      )}

      <ContentBody flex>
        {isLoading ? (
          <ContentLoader variant="panel" hint="messages" />
        ) : viewMode === 'threaded' ? (
          /* ==================== THREADED VIEW ==================== */
          threadSummaries.length === 0 ? (
            <div className="flex-1 flex items-center justify-center p-4 md:p-6">
              <EmptyState
                icon={GitBranch}
                title="No message threads yet"
                subtitle="Threads are created automatically when agents produce messages during executions."
                action={{ label: 'Create Persona', onClick: () => useSystemStore.getState().setSidebarSection('personas'), icon: Plus }}
                secondaryAction={{ label: 'From Templates', onClick: () => useSystemStore.getState().setSidebarSection('design-reviews'), icon: BookOpen }}
              />
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              {threadSummaries.map((thread) => {
                const isExpanded = expandedThreadId === thread.threadId;
                const replies = enrichedThreadReplies.get(thread.threadId);
                const rawParent = thread.parent;
                const pp = personaMap.get(rawParent.persona_id);
                const parent = { ...rawParent, persona_name: pp?.name, persona_icon: pp?.icon ?? undefined, persona_color: pp?.color ?? undefined } as PersonaMessage;
                const parentPriority = priorityConfig[parent.priority] ?? defaultPriority;

                return (
                  <div key={thread.threadId} className={`border-b ${ROW_SEPARATOR}`}>
                    {/* Thread header row */}
                    <div
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.03] cursor-pointer transition-colors"
                      onClick={() => handleToggleThread(thread.threadId)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleToggleThread(thread.threadId); } }}
                    >
                      <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center text-muted-foreground/60">
                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </div>
                      <PersonaIcon icon={(parent as PersonaMessage).persona_icon ?? null} color={(parent as PersonaMessage).persona_color ?? null} display="framed" frameSize={"lg"} />
                      <div className="flex-1 min-w-0">
                        <span className={`text-sm truncate block ${parent.is_read ? 'text-foreground/80' : 'text-foreground/90 font-medium'}`}>
                          {parent.title || (parent.content ?? '').slice(0, 80)}
                        </span>
                      </div>
                      <span className={`inline-flex px-2 py-0.5 rounded-lg typo-heading text-xs border ${parentPriority.bgColor} ${parentPriority.color} ${parentPriority.borderColor}`}>
                        {parentPriority.label}
                      </span>
                      {thread.replyCount > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                          <MessageCircle className="w-3 h-3" />
                          {thread.replyCount}
                        </span>
                      )}
                      <span className="text-sm text-muted-foreground/60 flex-shrink-0 w-24 text-right">
                        {formatRelativeTime(thread.latestReplyAt ?? parent.created_at)}
                      </span>
                    </div>

                    {/* Expanded replies */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <div className={`bg-secondary/10 ${ROW_SEPARATOR_T}`}>
                            {replies ? replies.map((msg) => {
                              const mp = priorityConfig[msg.priority] ?? defaultPriority;
                              return (
                                <div
                                  key={msg.id}
                                  className={`flex items-center gap-3 px-4 py-2 pl-12 hover:bg-white/[0.03] cursor-pointer transition-colors border-b ${ROW_SEPARATOR} last:border-b-0`}
                                  onClick={() => handleRowClick(msg)}
                                  role="button"
                                  tabIndex={0}
                                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleRowClick(msg); } }}
                                >
                                  <PersonaIcon icon={msg.persona_icon ?? null} color={msg.persona_color ?? null} display="framed" />
                                  <div className="flex-1 min-w-0">
                                    <span className={`text-sm truncate block ${msg.is_read ? 'text-foreground/70' : 'text-foreground/85 font-medium'}`}>
                                      {msg.title || (msg.content ?? '').slice(0, 80)}
                                    </span>
                                  </div>
                                  <span className={`inline-flex px-1.5 py-0.5 rounded text-xs border ${mp.bgColor} ${mp.color} ${mp.borderColor}`}>
                                    {mp.label}
                                  </span>
                                  {!msg.is_read && (
                                    <span className="inline-flex items-center gap-1 flex-shrink-0">
                                      <span className="w-2 h-2 rounded-full bg-blue-500" aria-hidden="true" />
                                      <span className="text-[10px] font-semibold uppercase tracking-wide text-blue-400">New</span>
                                    </span>
                                  )}
                                  <span className="text-xs text-muted-foreground/60 flex-shrink-0 w-20 text-right">
                                    {formatRelativeTime(msg.created_at)}
                                  </span>
                                </div>
                              );
                            }) : (
                              <div className="px-4 py-3 pl-12 text-sm text-muted-foreground/60">Loading replies...</div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
              {threadedRemaining > 0 && (
                <div className="p-4">
                  <button onClick={() => fetchThreadSummaries(false, selectedPersonaId || undefined)} className="w-full py-2.5 text-sm text-muted-foreground/80 hover:text-muted-foreground bg-secondary/20 hover:bg-secondary/40 rounded-xl border border-primary/15 transition-all">
                    Load More ({threadedRemaining} remaining)
                  </button>
                </div>
              )}
            </div>
          )
        ) : (
          /* ==================== FLAT VIEW (original) ==================== */
          filteredMessages.length === 0 ? (
            <div className="flex-1 flex items-center justify-center p-4 md:p-6">
              <EmptyState
                icon={MessageSquare}
                title={filter !== 'all' || selectedPersonaId
                  ? `No ${filter === 'unread' ? 'unread' : filter === 'high' ? 'high-priority' : ''} messages${selectedPersonaId ? ' for the selected persona' : ''}`
                  : 'No messages yet'}
                subtitle={filter !== 'all' || selectedPersonaId
                  ? 'Try switching to "All" to see all messages.'
                  : 'Messages are created when agents run and communicate with each other.'}
                action={{ label: 'Create Persona', onClick: () => useSystemStore.getState().setSidebarSection('personas'), icon: Plus }}
                secondaryAction={{ label: 'From Templates', onClick: () => useSystemStore.getState().setSidebarSection('design-reviews'), icon: BookOpen }}
              />
            </div>
          ) : (
            <div ref={parentRef} className="flex-1 overflow-y-auto">
              <div role="grid" aria-rowcount={filteredMessages.length} aria-colcount={6} className="w-full">
                <div role="row" className="sticky top-0 z-10 bg-primary/5 border-b border-primary/10 grid" style={{ gridTemplateColumns: GRID_TEMPLATE_COLUMNS }}>
                  <div role="columnheader" className="px-4 py-1.5 flex items-center">
                    <PersonaColumnFilter
                      value={selectedPersonaId}
                      onChange={setSelectedPersonaId}
                      personas={personas}
                    />
                  </div>
                  <div role="columnheader" className="flex items-center px-4 py-2.5 text-sm font-semibold text-muted-foreground/60 uppercase tracking-wider">Title</div>
                  <div role="columnheader" className="px-2 py-1.5 flex items-center">
                    <button
                      onClick={() => setFilter(filter === 'high' ? 'all' : 'high')}
                      className={`px-2.5 py-1 rounded-lg text-sm font-medium transition-colors ${
                        filter === 'high'
                          ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                          : 'text-foreground/80 hover:bg-secondary/30'
                      }`}
                    >
                      Priority {filter === 'high' ? '(High)' : ''}
                    </button>
                  </div>
                  <div role="columnheader" className="flex items-center justify-center px-4 py-1.5 text-sm font-semibold text-muted-foreground/60 uppercase tracking-wider">Delivery</div>
                  <div role="columnheader" className="flex items-center justify-center px-4 py-1.5 text-sm font-semibold text-muted-foreground/60 uppercase tracking-wider">Status</div>
                  <div role="columnheader" className="flex items-center justify-end px-4 py-1.5 text-sm font-semibold text-muted-foreground/60 uppercase tracking-wider">Created</div>
                </div>
                <div role="rowgroup" style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
                  {virtualizer.getVirtualItems().map((virtualRow) => {
                    const message = filteredMessages[virtualRow.index]!;
                    const priority = priorityConfig[message.priority] ?? defaultPriority;
                    return (
                      <div key={message.id} role="row" tabIndex={0} data-testid={`message-row-${message.id}`} onClick={() => handleRowClick(message)}
                        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); handleRowClick(message); } }}
                        style={{ position: 'absolute', top: 0, transform: `translateY(${virtualRow.start}px)`, width: '100%', height: `${virtualRow.size}px`, gridTemplateColumns: GRID_TEMPLATE_COLUMNS }}
                        className={`grid items-center hover:bg-white/[0.03] cursor-pointer transition-colors border-b ${ROW_SEPARATOR} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40`}
                      >
                        <div role="gridcell" className="flex items-center gap-2 px-4 min-w-0">
                          <PersonaIcon icon={message.persona_icon ?? null} color={message.persona_color ?? null} display="framed" frameSize="lg" />
                          <span className="text-sm text-foreground/80 truncate">{message.persona_name || 'Unknown'}</span>
                        </div>
                        <div role="gridcell" className="px-4 min-w-0"><span className={`text-sm truncate block ${message.is_read ? 'text-foreground/80' : 'text-foreground/90 font-medium'}`}>{message.title || (message.content ?? '').slice(0, 80)}</span></div>
                        <div role="gridcell" className="px-4"><span className={`inline-flex px-2 py-0.5 rounded-lg typo-heading border ${priority.bgColor} ${priority.color} ${priority.borderColor}`}>{priority.label}</span></div>
                        <div role="gridcell" className="px-4 flex justify-center">
                          {(() => {
                            const ds = deliverySummaries.get(message.id);
                            if (!ds) return <span className="text-xs text-muted-foreground/40">—</span>;
                            if (ds.failed > 0) { const c = deliveryStatusConfig['failed']!; return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${c.bgColor} ${c.color} border ${c.borderColor}`}>{ds.failed} failed</span>; }
                            if (ds.pending > 0) { const c = deliveryStatusConfig['pending']!; return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${c.bgColor} ${c.color} border ${c.borderColor}`}>{ds.pending} pending</span>; }
                            if (ds.delivered > 0) { const c = deliveryStatusConfig['delivered']!; return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${c.bgColor} ${c.color} border ${c.borderColor}`}>{ds.delivered} sent</span>; }
                            return <span className="text-xs text-muted-foreground/40">—</span>;
                          })()}
                        </div>
                        <div role="gridcell" className="px-4 flex justify-center">{!message.is_read ? <span className="inline-flex items-center gap-1" title="Unread" aria-label="Unread message"><span className="w-2.5 h-2.5 rounded-full bg-blue-500" aria-hidden="true" /><span className="text-[10px] font-semibold uppercase tracking-wide text-blue-400">New</span></span> : <div className="w-2.5 h-2.5 rounded-full bg-muted-foreground/20" title="Read" aria-hidden="true" />}</div>
                        <div role="gridcell" className="px-4 text-right"><span className="text-sm text-muted-foreground/80">{formatRelativeTime(message.created_at)}</span></div>
                      </div>
                    );
                  })}
                </div>
              </div>
              {remaining > 0 && (<div className="p-4"><button onClick={() => fetchMessages(false)} className="w-full py-2.5 text-sm text-muted-foreground/80 hover:text-muted-foreground bg-secondary/20 hover:bg-secondary/40 rounded-xl border border-primary/15 transition-all">Load More ({remaining} remaining)</button></div>)}
            </div>
          )
        )}
      </ContentBody>

      <AnimatePresence>
        {selectedMsg && <MessageDetailModal message={selectedMsg} onClose={() => setSelectedMsg(null)} onDelete={() => deleteMessage(selectedMsg.id)} />}
      </AnimatePresence>
    </ContentBox>
  );
}
