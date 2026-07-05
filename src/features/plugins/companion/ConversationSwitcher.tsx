import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus, Archive } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import {
  companionArchiveConversation,
  companionCreateConversation,
  companionMarkConversationRead,
} from '@/api/companion';
import type { ConversationRow } from '@/lib/bindings/ConversationRow';
import { DEFAULT_CONVERSATION_ID, useCompanionStore } from './companionStore';

type ThreadStatus = 'awaiting' | 'working' | 'idle';

function statusOf(c: ConversationRow, active: boolean, streaming: boolean): ThreadStatus {
  if (active && streaming) return 'working';
  if (c.unreadCount > 0n) return 'awaiting';
  return 'idle';
}

/** Decorative status dot — ● awaiting · ◐ working · ○ idle. */
function StatusDot({ status }: { status: ThreadStatus }) {
  if (status === 'awaiting') return <span className="text-status-success" aria-hidden>●</span>;
  if (status === 'working') return <span className="text-status-warning" aria-hidden>◐</span>;
  return <span className="text-foreground opacity-40" aria-hidden>○</span>;
}

/**
 * Header thread switcher (multi-conversation, variant 1). The active thread's
 * title is a dropdown trigger; the menu lists every conversation with its
 * status + unread count, plus "New conversation". The Athena bot avatar beside
 * it carries the identity, so the title names the *thread*, not the assistant.
 * See docs/features/companion/athena-multiconversation.md §5.
 */
export function ConversationSwitcher() {
  const { t } = useTranslation();
  const conversations = useCompanionStore((s) => s.conversations);
  const activeId = useCompanionStore((s) => s.activeConversationId);
  const streaming = useCompanionStore((s) => s.streaming);
  const setConversations = useCompanionStore((s) => s.setConversations);
  const setActiveConversationId = useCompanionStore((s) => s.setActiveConversationId);
  const upsertConversation = useCompanionStore((s) => s.upsertConversation);

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // The roster (hydration + live unread) is kept by useConversationRoster(),
  // mounted on the always-present footer orb — so this just reads the store.

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const active = conversations.find((c) => c.id === activeId);
  const activeStatus = active ? statusOf(active, true, streaming) : 'idle';
  const activeTitle = active?.title ?? t.plugins.companion.name;

  function switchTo(c: ConversationRow) {
    setOpen(false);
    if (c.id === activeId) return;
    setActiveConversationId(c.id);
    if (c.unreadCount > 0n) {
      upsertConversation({ ...c, unreadCount: 0n });
      companionMarkConversationRead(c.id).catch(silentCatch('companion_mark_conversation_read'));
    }
  }

  async function createNew() {
    setOpen(false);
    try {
      const row = await companionCreateConversation();
      upsertConversation(row);
      setActiveConversationId(row.id);
    } catch (err) {
      toastCatch('companion_create_conversation')(err);
    }
  }

  async function archive(e: React.MouseEvent, c: ConversationRow) {
    e.stopPropagation();
    try {
      await companionArchiveConversation(c.id);
      setConversations(conversations.filter((x) => x.id !== c.id));
      if (c.id === activeId) setActiveConversationId(DEFAULT_CONVERSATION_ID);
    } catch (err) {
      toastCatch('companion_archive_conversation')(err);
    }
  }

  return (
    <div className="relative min-w-0" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid="companion-conversation-switcher"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t.plugins.companion.switch_conversation}
        className="flex items-center gap-1.5 max-w-[210px] px-1.5 py-0.5 -mx-1 rounded-interactive hover:bg-foreground/5 transition-colors focus-ring"
      >
        <StatusDot status={activeStatus} />
        <span className="typo-body font-medium leading-tight truncate">{activeTitle}</span>
        {!!active && active.unreadCount > 0n && (
          <span className="min-w-4 h-4 px-1 rounded-full bg-status-success/20 text-status-success typo-caption font-semibold inline-flex items-center justify-center tabular-nums">
            {active.unreadCount}
          </span>
        )}
        <ChevronDown
          className={`w-3.5 h-3.5 text-foreground opacity-60 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-[calc(100%+6px)] z-40 min-w-[248px] max-w-[300px] p-1.5 rounded-card border border-foreground/15 bg-secondary/95 backdrop-blur-md shadow-elevation-3"
        >
          <div className="px-2 pt-1 pb-1.5 typo-caption uppercase tracking-wide">
            {t.plugins.companion.conversations}
          </div>
          <div className="max-h-[300px] overflow-y-auto flex flex-col gap-0.5">
            {conversations.map((c) => {
              const status = statusOf(c, c.id === activeId, streaming);
              const canArchive = !c.pinned && c.id !== DEFAULT_CONVERSATION_ID;
              return (
                <div key={c.id} className="group relative flex items-center">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => switchTo(c)}
                    data-testid={`companion-conversation-${c.id}`}
                    className={`flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 rounded-interactive text-left transition-colors focus-ring ${
                      c.id === activeId ? 'bg-primary/15' : 'hover:bg-foreground/5'
                    }`}
                  >
                    <StatusDot status={status} />
                    <span className="flex-1 min-w-0 typo-body truncate">{c.title ?? '—'}</span>
                    {c.unreadCount > 0n && (
                      <span className="min-w-4 h-4 px-1 rounded-full bg-status-success/20 text-status-success typo-caption font-semibold inline-flex items-center justify-center tabular-nums">
                        {c.unreadCount}
                      </span>
                    )}
                  </button>
                  {canArchive && (
                    <button
                      type="button"
                      onClick={(e) => archive(e, c)}
                      aria-label={t.plugins.companion.archive_conversation}
                      title={t.plugins.companion.archive_conversation}
                      className="absolute right-1.5 p-1 rounded-interactive text-foreground opacity-0 group-hover:opacity-100 hover:bg-foreground/10 transition-opacity focus-ring"
                    >
                      <Archive className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="my-1.5 mx-1 h-px bg-foreground/10" aria-hidden />
          <button
            type="button"
            onClick={createNew}
            data-testid="companion-conversation-new"
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-interactive text-primary hover:bg-primary/10 transition-colors focus-ring typo-body font-medium"
          >
            <Plus className="w-4 h-4" aria-hidden />
            {t.plugins.companion.new_conversation}
          </button>
        </div>
      )}
    </div>
  );
}
