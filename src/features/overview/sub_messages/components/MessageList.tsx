import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import { MessageSquare, CheckCheck, RefreshCw, Plus, BookOpen, Eye, EyeOff } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { IllustrationEmptyState } from '@/features/overview/shared/emptyStatePrototype';
import { useOverviewStore } from "@/stores/overviewStore";
import { useShallow } from 'zustand/react/shallow';
import { useAgentStore } from "@/stores/agentStore";
import { usePersonaMap, useEnrichedRecords } from "@/hooks/utility/data/usePersonaMap";
import { useSystemStore } from "@/stores/systemStore";
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { useMessageCreatedListener } from '@/hooks/realtime/useMessageCreatedListener';
import { useVirtualList } from '@/hooks/utility/interaction/useVirtualList';
import { useProgressiveReveal, useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import type { PersonaMessage } from '@/lib/types/types';
import type { PersonaMessage as RawPersonaMessage } from '@/lib/bindings/PersonaMessage';
import { seedMockMessage, deleteAllMessages } from '@/api/overview/messages';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { toastCatch } from '@/lib/silentCatch';
import { Trash2 } from 'lucide-react';
import { PersonaColumnFilter } from '@/features/agents/components/PersonaColumnFilter';
import { ColumnDropdownFilter } from '@/features/shared/components/forms/ColumnDropdownFilter';
import { priorityConfig, MESSAGE_ROW_HEIGHT, type PriorityStyle } from '../libs/messageHelpers';
import { PriorityChip } from './PriorityChip';
import { useColumnWidths, ColumnResizeHandle } from '@/features/shared/components/display/ColumnResize';

// Ordered columns for the flat message grid. Widths are defaults — users can
// drag-resize them; overrides persist via useColumnWidths('overview-messages').
const MESSAGE_COLUMNS: { key: string; width: string }[] = [
  { key: 'persona', width: '280px' },
  { key: 'title', width: 'minmax(0,2fr)' },
  { key: 'priority', width: '180px' },
  { key: 'status', width: '120px' },
  { key: 'created', width: '140px' },
];

type PriorityFilter = 'all' | 'high' | 'normal' | 'low';
type ReadFilter = 'all' | 'unread' | 'read';

// Filter options are now built inside the component to use translations

import { ROW_SEPARATOR } from '@/lib/design/listTokens';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { MessageDetailModal } from './MessageDetailModal';
import { ListSkeleton } from '@/features/shared/components/layout/ListSkeleton';
import { AnimatedCounter } from '@/features/shared/components/display/AnimatedCounter';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { createLogger } from "@/lib/log";

const logger = createLogger("message-list");

export default function MessageList() {
  const { t, tx } = useTranslation();
  const PRIORITY_FILTER_OPTIONS = [
    { value: 'all', label: t.overview.messages_view.all_priorities },
    { value: 'high', label: t.overview.messages.priority_high },
    { value: 'low', label: t.overview.messages.priority_low },
    { value: 'normal', label: t.overview.messages.priority_normal },
  ];
  const READ_FILTER_OPTIONS = [
    { value: 'all', label: t.overview.messages_view.all_statuses },
    { value: 'read', label: t.overview.messages_view.read },
    { value: 'unread', label: t.overview.messages_view.unread },
  ];
  const {
    messages, messagesTotal,
    fetchMessages, fetchUnreadMessageCount,
    markMessageAsRead, markAllMessagesAsRead, deleteMessage,
  } = useOverviewStore(useShallow((s) => ({
    messages: s.messages,
    messagesTotal: s.messagesTotal,
    fetchMessages: s.fetchMessages,
    fetchUnreadMessageCount: s.fetchUnreadMessageCount,
    markMessageAsRead: s.markMessageAsRead,
    markAllMessagesAsRead: s.markAllMessagesAsRead,
    deleteMessage: s.deleteMessage,
  })));
  const personas = useAgentStore((s) => s.personas);
  const personaMap = usePersonaMap();
  const enrichedMessages = useEnrichedRecords(messages, personaMap);

  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all');
  // Hide read messages by default — they're typically resolved noise. The
  // header button toggles between 'unread' and 'all' for recovery/remind.
  const [readFilter, setReadFilter] = useState<ReadFilter>('unread');
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>('');
  const [selectedMsg, setSelectedMsg] = useState<PersonaMessage | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [confirmingDeleteAll, setConfirmingDeleteAll] = useState(false);
  const fetchUnreadMessageCountRef = useRef(fetchUnreadMessageCount);
  fetchUnreadMessageCountRef.current = fetchUnreadMessageCount;

  useEffect(() => {
    let active = true;
    const loadInitial = async () => {
      setIsLoading(true);
      try {
        await fetchMessages(true);
      }
      finally { if (active) setIsLoading(false); }
    };
    loadInitial();
    return () => { active = false; };
  }, [fetchMessages]);

  const handleMessageCreated = useCallback((raw: RawPersonaMessage) => {
    // The 'message-created' event fires from BOTH the protocol dispatcher (full
    // PersonaMessage) AND the CDC layer (lightweight { action, table, rowid }).
    // Ignore CDC notifications — they lack message fields and would render as
    // ghost "Unknown" entries.
    if (!raw.id || !raw.persona_id) return;

    useOverviewStore.setState((state) => {
      const exists = state.messages.some((m) => m.id === raw.id);
      if (exists) return state;
      return { messages: [raw, ...state.messages], messagesTotal: state.messagesTotal + 1 };
    });
    fetchUnreadMessageCountRef.current();
  }, []);

  useMessageCreatedListener(handleMessageCreated);

  const filteredMessages = useMemo(() => {
    let result = enrichedMessages;
    if (selectedPersonaId) result = result.filter((m) => m.persona_id === selectedPersonaId);
    if (priorityFilter !== 'all') result = result.filter((m) => m.priority === priorityFilter);
    if (readFilter === 'unread') result = result.filter((m) => !m.is_read);
    else if (readFilter === 'read') result = result.filter((m) => m.is_read);
    return result;
  }, [enrichedMessages, priorityFilter, readFilter, selectedPersonaId]);

  const hasActiveFilters = !!selectedPersonaId || priorityFilter !== 'all' || readFilter !== 'all';

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await fetchMessages(true);
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

  // Progressive reveal — spread row mounting across ~2s so a large inbox
  // doesn't big-bang every row onto one frame after the table frame lands.
  // Resets on view-mode / filter change; chases realtime arrivals + "load
  // more" pages. The flat list is already virtualized, so this mainly drives
  // the gradual-fill feel + the live counter; the threaded view (which is not
  // virtualized) gets a real mount-cost saving.
  const activeRevealTotal = filteredMessages.length;
  const reveal = useProgressiveReveal(activeRevealTotal, {
    resetKey: `${priorityFilter}|${readFilter}|${selectedPersonaId}`,
    initialCount: 24,
  });
  const revealedMessages = useMemo(
    () => filteredMessages.slice(0, reveal.count),
    [filteredMessages, reveal.count],
  );
  // Per-item entrance guard — keyed to the active filters so a change replays
  // the cascade; survives virtualized row remount so scrolling doesn't.
  const msgEnter = useRevealTracker(`${priorityFilter}|${readFilter}|${selectedPersonaId}`);

  const { parentRef, virtualizer } = useVirtualList(revealedMessages, MESSAGE_ROW_HEIGHT);
  const colWidths = useColumnWidths('overview-messages');
  const msgGridTemplate = colWidths.template(MESSAGE_COLUMNS);

  // Keyboard navigation inside the open modal: Left/Right arrows step through
  // the currently-filtered messages. Wrapping to find the index each keypress
  // keeps us honest if the list changes underneath us (new realtime arrival,
  // user deletes one, etc.).
  const navigateMessage = useCallback((direction: 1 | -1) => {
    setSelectedMsg((current) => {
      if (!current) return current;
      const idx = filteredMessages.findIndex((m) => m.id === current.id);
      if (idx === -1) return current;
      const next = filteredMessages[idx + direction];
      if (!next) return current;
      if (!next.is_read) markMessageAsRead(next.id);
      return next;
    });
  }, [filteredMessages, markMessageAsRead]);

  // Concrete (never-undefined) fallback that mirrors the quiet-solid Normal tier;
  // priorityConfig is a string-indexed record, so a literal is needed to satisfy
  // the non-optional PriorityChip prop under noUncheckedIndexedAccess.
  const defaultPriority: PriorityStyle = { color: 'text-foreground/90', bgColor: 'bg-secondary/40', borderColor: 'border-primary/20', label: 'Normal' };

  return (
    <ContentBox>
      <ContentHeader
        icon={<MessageSquare className="w-5 h-5 text-indigo-400" />}
        iconColor="indigo"
        title={t.overview.messages_view.title}
        subtitle={tx(messagesTotal === 1 ? t.overview.messages_view.messages_subtitle_one : t.overview.messages_view.messages_subtitle, { count: messagesTotal })}
        actions={
          <>
            {reveal.isRevealing && (
              <span aria-hidden="true" className="flex items-center gap-1 px-2 py-1 rounded-modal typo-caption text-foreground bg-secondary/20 border border-primary/10">
                <AnimatedCounter value={reveal.count} mode="roll" />
                <span>/</span>
                <Numeric>{activeRevealTotal}</Numeric>
              </span>
            )}
            {import.meta.env.DEV && (
              <button onClick={handleSeedMessage} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-modal typo-heading bg-amber-500/10 text-amber-400 border border-amber-500/25 hover:bg-amber-500/20 transition-colors" title={t.overview.messages_view.seed_tooltip}>
                <Plus className="w-3.5 h-3.5" /> {t.overview.messages_view.mock_message}
              </button>
            )}
            <button
              onClick={() => setReadFilter((prev) => (prev === 'unread' ? 'all' : 'unread'))}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-modal typo-heading text-foreground hover:text-foreground bg-secondary/30 border border-primary/15 hover:bg-secondary/50 transition-all"
              title={readFilter === 'unread' ? t.overview.messages_view.show_read_messages : t.overview.messages_view.show_only_unread}
            >
              {readFilter === 'unread' ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              {readFilter === 'unread' ? t.overview.messages_view.show_read_messages : t.overview.messages_view.show_only_unread}
            </button>
            <button onClick={handleRefresh} disabled={isRefreshing} className="p-1.5 rounded-card text-foreground hover:text-muted-foreground hover:bg-secondary/50 disabled:opacity-60 transition-colors" title={t.common.refresh}>
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={() => markAllMessagesAsRead()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-modal typo-heading text-blue-400/80 hover:text-blue-400 bg-blue-500/10 border border-blue-500/20 hover:bg-blue-500/15 transition-all">
              <CheckCheck className="w-3.5 h-3.5" /> {t.overview.messages_view.mark_all_read}
            </button>
            {messages.length > 0 && (
              <button
                onClick={() => setConfirmingDeleteAll(true)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-modal typo-heading text-red-400 bg-red-500/15 border border-red-500/30 hover:bg-red-500/25 transition-all"
                title={t.overview.messages_view.delete_all}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </>
        }
      />

      <ContentBody flex>
        {isLoading ? (
          <ListSkeleton rows={8} rowHeight={MESSAGE_ROW_HEIGHT} />
        ) : (
          /* ==================== FLAT VIEW ==================== */
          filteredMessages.length === 0 && !hasActiveFilters ? (
            <div className="flex-1 flex items-center justify-center p-4 md:p-6">
              <IllustrationEmptyState
                motif="messages"
                content={{
                  icon: MessageSquare,
                  title: t.overview.messages_view.no_messages,
                  subtitle: t.overview.messages_view.no_messages_hint,
                  action: { label: t.overview.dashboard.create_persona, onClick: () => useSystemStore.getState().setSidebarSection('personas'), icon: Plus },
                  secondaryAction: { label: t.overview.dashboard.from_templates, onClick: () => useSystemStore.getState().setSidebarSection('design-reviews'), icon: BookOpen },
                }}
              />
            </div>
          ) : (
            <div ref={parentRef} className={`flex-1 overflow-y-auto ${colWidths.isResizing ? 'select-none cursor-col-resize' : ''}`}>
              <div role="grid" aria-rowcount={filteredMessages.length} aria-colcount={6} className="w-full">
                <div role="row" className="sticky top-0 z-10 bg-primary/5 border-b border-primary/10 grid" style={{ gridTemplateColumns: msgGridTemplate }}>
                  <div role="columnheader" className="relative px-4 py-1.5 flex items-center">
                    <PersonaColumnFilter
                      value={selectedPersonaId}
                      onChange={setSelectedPersonaId}
                      personas={personas}
                    />
                    <ColumnResizeHandle
                      label={t.shared.resize_column}
                      onBeginResize={(w, x) => colWidths.beginResize('persona', w, x)}
                      onReset={() => colWidths.clearColumn('persona')}
                    />
                  </div>
                  <div role="columnheader" className="relative flex items-center px-4 py-1.5 typo-label text-foreground">
                    {t.overview.messages_view.col_title}
                    <ColumnResizeHandle
                      label={t.shared.resize_column}
                      onBeginResize={(w, x) => colWidths.beginResize('title', w, x)}
                      onReset={() => colWidths.clearColumn('title')}
                    />
                  </div>
                  <div role="columnheader" className="relative px-2 py-1.5 flex items-center">
                    <ColumnDropdownFilter
                      label="Priority"
                      value={priorityFilter}
                      options={PRIORITY_FILTER_OPTIONS}
                      onChange={(v) => setPriorityFilter(v as PriorityFilter)}
                    />
                    <ColumnResizeHandle
                      label={t.shared.resize_column}
                      onBeginResize={(w, x) => colWidths.beginResize('priority', w, x)}
                      onReset={() => colWidths.clearColumn('priority')}
                    />
                  </div>
                  <div role="columnheader" className="relative px-4 py-1.5 flex items-center justify-center">
                    <ColumnDropdownFilter
                      label="Status"
                      value={readFilter}
                      options={READ_FILTER_OPTIONS}
                      onChange={(v) => setReadFilter(v as ReadFilter)}
                    />
                    <ColumnResizeHandle
                      label={t.shared.resize_column}
                      onBeginResize={(w, x) => colWidths.beginResize('status', w, x)}
                      onReset={() => colWidths.clearColumn('status')}
                    />
                  </div>
                  <div role="columnheader" className="flex items-center justify-end px-4 py-1.5 typo-label text-foreground">{t.overview.messages_view.col_created}</div>
                </div>
                {filteredMessages.length === 0 ? (
                  <div className="py-8 text-center">
                    <p className="typo-body text-foreground">{t.overview.messages_view.no_filter_match}</p>
                  </div>
                ) : (
                  <div role="rowgroup" style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
                    {virtualizer.getVirtualItems().map((virtualRow) => {
                      const message = revealedMessages[virtualRow.index]!;
                      const priority = priorityConfig[message.priority] ?? defaultPriority;
                      // Status-accent left border (matches the Activity table):
                      // high-priority rows read red, other unread rows read blue,
                      // already-read rows stay neutral.
                      const rowAccent = message.priority === 'high'
                        ? 'border-l-red-400/70'
                        : !message.is_read
                          ? 'border-l-blue-400/70'
                          : 'border-l-transparent';
                      return (
                        <RevealItem key={message.id} revealId={message.id} order={virtualRow.index - reveal.newSince} hasEntered={msgEnter.hasEntered} markEntered={msgEnter.markEntered} role="row" tabIndex={0} data-testid={`message-row-${message.id}`} onClick={() => handleRowClick(message)}
                          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); handleRowClick(message); } }}
                          style={{ position: 'absolute', top: 0, transform: `translateY(${virtualRow.start}px)`, width: '100%', height: `${virtualRow.size}px`, gridTemplateColumns: msgGridTemplate }}
                          className={`grid items-center border-l-2 ${rowAccent} hover:bg-primary/[0.08] cursor-pointer transition-colors border-b ${ROW_SEPARATOR} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 ${virtualRow.index % 2 === 0 ? 'bg-primary/[0.03]' : ''}`}
                        >
                          <div role="gridcell" className="flex items-center gap-2 px-4 min-w-0">
                            <PersonaIcon icon={message.persona_icon ?? null} color={message.persona_color ?? null} name={message.persona_name} display="framed" frameSize="lg" />
                            <span className="typo-body text-foreground truncate">{message.persona_name || t.overview.messages_view.unknown_persona}</span>
                          </div>
                          <div role="gridcell" className="px-4 min-w-0"><span className={`typo-body truncate block ${message.is_read ? 'text-foreground' : 'text-foreground/90 font-medium'}`}>{message.title || (message.content ?? '').slice(0, 80)}</span></div>
                          <div role="gridcell" className="px-4"><PriorityChip priority={priority} /></div>
                          <div role="gridcell" className="px-4 flex justify-center">{!message.is_read ? <span className="inline-flex items-center gap-1" title={t.overview.messages_view.unread} aria-label={t.overview.messages_view.unread}><span className="w-2.5 h-2.5 rounded-full bg-blue-500" aria-hidden="true" /><span className="text-[10px] font-semibold uppercase tracking-wide text-blue-400">New</span></span> : <div className="w-2.5 h-2.5 rounded-full bg-muted-foreground/20" title={t.overview.messages_view.read} aria-hidden="true" />}</div>
                          <div role="gridcell" className="px-4 text-right"><RelativeTime timestamp={message.created_at} className="typo-body text-foreground" /></div>
                        </RevealItem>
                      );
                    })}
                  </div>
                )}
              </div>
              {remaining > 0 && (<div className="p-4"><button onClick={() => fetchMessages(false)} className="w-full py-2.5 typo-body text-foreground hover:text-muted-foreground bg-secondary/20 hover:bg-secondary/40 rounded-modal border border-primary/15 transition-all">{tx(t.overview.messages_view.load_more, { count: remaining })}</button></div>)}
            </div>
          )
        )}
      </ContentBody>

      <AnimatePresence>
        {selectedMsg && (
          <MessageDetailModal
            message={selectedMsg}
            onClose={() => setSelectedMsg(null)}
            onDelete={() => deleteMessage(selectedMsg.id)}
            onNavigate={navigateMessage}
            hasPrev={filteredMessages.findIndex((m) => m.id === selectedMsg.id) > 0}
            hasNext={(() => {
              const i = filteredMessages.findIndex((m) => m.id === selectedMsg.id);
              return i !== -1 && i < filteredMessages.length - 1;
            })()}
          />
        )}
      </AnimatePresence>

      {confirmingDeleteAll && (
        <ConfirmDialog
          danger
          title={t.overview.messages_view.delete_all_confirm_title}
          body={tx(t.overview.messages_view.delete_all_confirm_body, { count: messagesTotal })}
          confirmLabel={t.overview.messages_view.delete_all_confirm_cta}
          onConfirm={async () => {
            try {
              await deleteAllMessages();
              await fetchMessages(true);
              await fetchUnreadMessageCount();
            } catch (e) {
              toastCatch('MessageList:deleteAll', 'Failed to delete all messages')(e);
            } finally {
              setConfirmingDeleteAll(false);
            }
          }}
          onCancel={() => setConfirmingDeleteAll(false)}
        />
      )}
    </ContentBox>
  );
}
