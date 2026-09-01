// RailChannelModal — one channel message, opened, with a way to answer it.
//
// The rail's Messages tab is a peripheral read: you glance at it while watching
// the board. This is what a glance turns into when something needs a reply — the
// message rendered the way Conversations renders it (`TalkBubble`, so markdown,
// author voice and the mine/theirs geometry are the ones the app already
// speaks), plus the one thing the rail cannot do inline: say something back.
//
// WHY NOT `ChannelDetailModal`. That modal already exists and Conversations uses
// it, but it is a READER — full body, raw payload, field table, pin. This is a
// REPLIER, and the two want opposite things from the same 600px: the detail
// modal spends its height on provenance, and a reply surface spends it on the
// message and the box you type in. Rather than grow a mode flag through a
// component two surfaces share, this composes the same leaf (`TalkBubble`) with
// a composer.
//
// THE REPLY IS A DIRECTIVE, which is the app's existing word for "the human said
// this into the channel" (`sendChannelDirective`). It threads via `replyTo`, so
// the answer lands attached to the message it answers rather than as a new
// remark at the bottom of a stream the reader is not looking at.

import { useCallback, useState } from 'react';
import { MessagesSquare } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { ChatInputBar } from '@/features/shared/components/forms/ChatInputBar';
import { usePipelineStore } from '@/stores/pipelineStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { TalkBubble } from '../../channels/ConversationCards';
import { cleanName } from '../fleetGridModel';
import type { TaggedItem } from '../../channels/types';

const TITLE_ID = 'rail-channel-modal-title';

export function RailChannelModal({
  tagged, onClose, onOpenDetail,
}: {
  /** Null closes it. */
  tagged: TaggedItem | null;
  onClose: () => void;
  /** Escape hatch to the full reader for provenance the reply view omits. */
  onOpenDetail?: (tagged: TaggedItem) => void;
}) {
  const { t } = useTranslation();
  const send = usePipelineStore((s) => s.sendChannelDirective);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const submit = useCallback(() => {
    if (!tagged || !draft.trim() || sending) return;
    setSending(true);
    // `replyTo` is the message's own id, so the answer threads under what it
    // answers. The channel cache picks the new row up through its existing
    // subscription — this does not need to write into the rail's feed itself,
    // and a second write path into a list the store already owns is how two
    // copies of one conversation start to disagree.
    send(tagged.team.teamId, draft.trim(), tagged.item.id)
      .then(() => {
        setDraft('');
        onClose();
      })
      .catch(toastCatch('rail-channel:reply'))
      .finally(() => setSending(false));
  }, [tagged, draft, sending, send, onClose]);

  if (!tagged) return null;

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      titleId={TITLE_ID}
      portal
      maxWidthClass="max-w-xl"
      staggerChildren={false}
      panelClassName="max-h-[76vh] flex flex-col"
    >
      <div className="flex h-11 flex-shrink-0 items-center gap-2.5 border-b border-border px-4">
        <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary/15">
          <MessagesSquare className="h-3.5 w-3.5 text-foreground" />
        </div>
        <h2 id={TITLE_ID} className="typo-title truncate">
          {cleanName(tagged.team.teamName)}
        </h2>
        {onOpenDetail && (
          <button
            type="button"
            onClick={() => onOpenDetail(tagged)}
            className="ml-auto flex-shrink-0 rounded-interactive px-2 py-0.5 typo-label text-foreground opacity-55 transition-colors hover:bg-secondary/50 hover:opacity-100"
            data-testid="rail-channel-open-detail"
          >
            {t.monitor.grid_rail_channel_detail}
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3" data-testid="rail-channel-modal">
        {/* The same leaf Conversations renders. `onOpen` is a no-op here: the
            bubble IS the thing already open, and re-opening it from inside
            itself is a loop the reader cannot see the end of. */}
        <TalkBubble item={tagged.item} onOpen={() => {}} />
      </div>

      <div className="flex-shrink-0 border-t border-border px-4 py-3">
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

export default RailChannelModal;
