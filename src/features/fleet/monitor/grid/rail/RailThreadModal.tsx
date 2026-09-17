// RailThreadModal — one Messages thread, opened as a conversation.
//
// The rail's Messages tab lists threads (one per persona, per team voice, and
// one for the system; see `messageThreads`). Opening one shows it the way a
// messenger does: every line in time order, newest at the BOTTOM, scrolled to
// the bottom, with the box to answer in underneath. Lines render through
// `TalkBubble`, the leaf Conversations already speaks, so markdown, author
// voice and the mine/theirs geometry are the app's own.
//
// THE REPLY IS A DIRECTIVE (`sendChannelDirective`) into the team channel of
// the thread's LATEST line, threaded under that line via `replyTo`. A persona
// thread can span teams; the latest line's room is where the conversation is
// happening now. `messageThreads` files a reply directive back into the thread
// of the line it answers, so what you send appears here rather than in the
// team thread. The modal stays open after sending, because a reply is a turn
// in a conversation, not the end of one.
//
// READ ON VIEW. Opening marks the thread read up to its newest line, and so
// does a new line arriving while it is open: a message on screen is seen.
//
// WHY A WINDOW. A busy persona's thread can hold hundreds of lines, and each
// bubble is a markdown render. The newest `STEP` render first; older ones are
// one click away.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Activity, Users, X } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { ChatInputBar } from '@/features/shared/components/forms/ChatInputBar';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { usePipelineStore } from '@/stores/pipelineStore';
import { useAgentStore } from '@/stores/agentStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { TalkBubble } from '../../channels/ConversationCards';
import type { TaggedItem } from '../../channels/types';
import type { MessageThread } from './messageThreads';

const TITLE_ID = 'rail-thread-modal-title';
const STEP = 60;
const noop = () => {};

function ThreadAvatar({ thread }: { thread: MessageThread }) {
  const persona = useAgentStore((s) =>
    thread.personaId ? s.personas.find((p) => p.id === thread.personaId) : undefined,
  );
  if (persona) return <PersonaIcon icon={persona.icon} color={persona.color} size="w-4 h-4" />;
  const Icon = thread.kind === 'system' ? Activity : Users;
  return (
    <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-secondary/60">
      <Icon className="h-3.5 w-3.5 text-foreground" aria-hidden />
    </span>
  );
}

export function RailThreadModal({
  thread, onClose, onMarkRead, onOpenDetail,
}: {
  /** Null closes it. Pass the LIVE thread so new lines appear while open. */
  thread: MessageThread | null;
  onClose: () => void;
  /** Advance the thread's read watermark to `at`. */
  onMarkRead: (key: string, at: string) => void;
  /** Escape hatch to the Timeline for the thread's latest line. */
  onOpenDetail?: (tagged: TaggedItem) => void;
}) {
  const { t } = useTranslation();
  const send = usePipelineStore((s) => s.sendChannelDirective);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [take, setTake] = useState(STEP);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const key = thread?.key ?? null;
  const newestAt = thread?.latest.item.at ?? null;
  // Keyed on the key and the newest instant only, so a poll that changes
  // nothing is not a watermark write.
  useEffect(() => {
    if (key !== null && newestAt !== null) onMarkRead(key, newestAt);
  }, [key, newestAt, onMarkRead]);

  // A different thread starts from its newest window again.
  useEffect(() => setTake(STEP), [key]);

  // Oldest first, newest at the bottom — the thread holds them newest-first.
  const lines = useMemo(
    () => (thread ? thread.items.slice(0, take).reverse() : []),
    [thread, take],
  );
  const hasEarlier = !!thread && thread.items.length > take;

  // Pinned to the bottom on open and whenever a new line lands.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [key, newestAt]);

  const submit = useCallback(() => {
    if (!thread || !draft.trim() || sending) return;
    const { item, team } = thread.latest;
    setSending(true);
    send(team.teamId, draft.trim(), item.id)
      .then(() => setDraft(''))
      .catch(toastCatch('rail-thread:reply'))
      .finally(() => setSending(false));
  }, [thread, draft, sending, send]);

  if (!thread) return null;

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      titleId={TITLE_ID}
      portal
      maxWidthClass="max-w-xl"
      staggerChildren={false}
      panelClassName="flex max-h-[76vh] flex-col overflow-hidden rounded-modal border border-border bg-background shadow-elevation-4"
    >
      <div className="flex h-11 flex-shrink-0 items-center gap-2.5 border-b border-border bg-secondary/30 px-4">
        <ThreadAvatar thread={thread} />
        <h2 id={TITLE_ID} className="min-w-0 truncate typo-title">{thread.name}</h2>
        <span className="ml-auto flex flex-shrink-0 items-center gap-1">
          {onOpenDetail && (
            <button
              type="button"
              onClick={() => onOpenDetail(thread.latest)}
              className="focus-ring rounded-interactive px-2 py-0.5 typo-label text-foreground opacity-60 transition-colors hover:bg-secondary/60 hover:opacity-100"
              data-testid="rail-channel-open-detail"
            >
              {t.monitor.grid_rail_channel_detail}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label={t.common.close}
            data-testid="rail-thread-close"
            className="focus-ring flex h-7 w-7 items-center justify-center rounded-interactive text-foreground opacity-60 transition-colors hover:bg-secondary/60 hover:opacity-100"
          >
            <X className="h-4 w-4" />
          </button>
        </span>
      </div>

      <div
        ref={scrollerRef}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
        data-testid="rail-channel-modal"
      >
        {hasEarlier && (
          <div className="flex justify-center pb-2">
            <button
              type="button"
              onClick={() => setTake((n) => n + STEP)}
              className="focus-ring rounded-interactive px-2 py-0.5 typo-label text-foreground opacity-60 transition-colors hover:bg-secondary/60 hover:opacity-100"
              data-testid="rail-thread-earlier"
            >
              {t.monitor.grid_rail_thread_earlier}
            </button>
          </div>
        )}
        {/* `onOpen` is a no-op: the bubble is already inside the open thread. */}
        {lines.map((tg) => (
          <TalkBubble key={`${tg.team.teamId}:${tg.item.id}`} item={tg.item} onOpen={noop} />
        ))}
      </div>

      <div className="flex-shrink-0 border-t border-border bg-secondary/30 px-4 py-3">
        <ChatInputBar
          value={draft}
          onChange={setDraft}
          onSubmit={submit}
          multiline
          busy={sending}
          disabled={sending}
          autoFocus
          placeholder={t.monitor.grid_rail_channel_reply_placeholder}
          sendAriaLabel={t.monitor.grid_rail_channel_reply_send}
          inputTestId="rail-channel-reply-input"
          sendTestId="rail-channel-reply-send"
        />
      </div>
    </BaseModal>
  );
}

export default RailThreadModal;
