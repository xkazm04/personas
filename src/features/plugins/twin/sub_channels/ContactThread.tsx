import { useMemo } from 'react';
import { ArrowDownLeft, ArrowUpRight, MessagesSquare, Reply } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import type { TwinChannelKind } from '@/api/enums';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { PressSurface } from '@/features/shared/components/buttons';
/* ------------------------------------------------------------------ *
 *  ContactThread — recent logged messages with the selected contact.
 *
 *  Reads the already-fetched twinCommunications slice (ChannelsAtelier's
 *  useChannelActivity populates it for the active twin) and shows the most
 *  recent few exchanges with the picked contact on the picked channel — so
 *  the operator drafts a reply with conversation context in view instead of
 *  from a blank slate. Renders nothing until a contact with prior history
 *  on this channel is selected.
 * ------------------------------------------------------------------ */

const MAX_ROWS = 4;

export function ContactThread({
  twinId,
  channel,
  contactHandle,
  onReplyTo,
}: {
  twinId: string;
  channel: TwinChannelKind | '';
  contactHandle: string;
  /** Use a received message as the inbound being replied to. Inbound rows
   *  become clickable when provided; sent rows stay static. */
  onReplyTo?: (content: string) => void;
}) {
  const { t: tFull, tx } = useTranslation();
  const t = tFull.twin.channels;
  const communications = useSystemStore((s) => s.twinCommunications);
  const handle = contactHandle.trim().toLowerCase();

  const thread = useMemo(() => {
    if (!handle) return [];
    return communications
      .filter(
        (c) =>
          c.twin_id === twinId &&
          (c.contact_handle ?? '').trim().toLowerCase() === handle &&
          (!channel || c.channel === channel),
      )
      .slice()
      .sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1))
      .slice(0, MAX_ROWS);
  }, [communications, twinId, handle, channel]);

  if (thread.length === 0) return null;

  return (
    <div className="mt-3 rounded-card border border-primary/10 bg-card/30 overflow-hidden">
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-primary/10">
        <MessagesSquare className="w-3.5 h-3.5 text-ink-2" />
        <span className="typo-eyebrow text-foreground">
          {tx(t.threadTitle, { handle: contactHandle.trim() })}
        </span>
      </div>
      <ul className="divide-y divide-primary/5">
        {thread.map((c) => {
          const outbound = c.direction === 'out';
          const Icon = outbound ? ArrowUpRight : ArrowDownLeft;
          const dirLabel = outbound ? t.threadOutbound : t.threadInbound;
          const replyable = !outbound && !!onReplyTo;
          const row = (
            <>
              <Tooltip content={dirLabel}>
                <span
                  className={`flex-shrink-0 mt-0.5 w-5 h-5 rounded-full inline-flex items-center justify-center ${
                    outbound ? 'bg-status-success/10 text-status-success' : 'bg-surface-2 text-ink-2'
                  }`}
                  aria-label={dirLabel}
                >
                  <Icon className="w-3 h-3" />
                </span>
              </Tooltip>
              <span className="flex-1 min-w-0 typo-caption text-foreground line-clamp-2">{c.content}</span>
              <RelativeTime timestamp={c.occurred_at} className="flex-shrink-0 typo-caption text-foreground tabular-nums" />
              {replyable && (
                <Reply className="flex-shrink-0 mt-0.5 w-3 h-3 text-ink-2 opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden />
              )}
            </>
          );
          return (
            <li key={c.id}>
              {replyable ? (
                <Tooltip content={t.threadReplyTo}>
                  <PressSurface
                    onPress={() => onReplyTo(c.content)}
                    aria-label={t.threadReplyTo}
                    className="group w-full flex items-start gap-2 px-3 py-2"
                  >
                    {row}
                  </PressSurface>
                </Tooltip>
              ) : (
                <span className="flex items-start gap-2 px-3 py-2">{row}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
