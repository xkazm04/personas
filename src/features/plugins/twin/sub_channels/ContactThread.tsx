import { useMemo } from 'react';
import { ArrowDownLeft, ArrowUpRight, MessagesSquare, Reply } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import type { TwinChannelKind } from '@/api/enums';

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
        <MessagesSquare className="w-3.5 h-3.5 text-violet-300" />
        <span className="text-[10px] uppercase tracking-[0.16em] font-medium text-foreground">
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
              <span
                className={`flex-shrink-0 mt-0.5 w-5 h-5 rounded-full inline-flex items-center justify-center ${
                  outbound ? 'bg-emerald-500/10 text-emerald-300' : 'bg-violet-500/10 text-violet-300'
                }`}
                title={dirLabel}
                aria-label={dirLabel}
              >
                <Icon className="w-3 h-3" />
              </span>
              <span className="flex-1 min-w-0 typo-caption text-foreground leading-snug line-clamp-2">{c.content}</span>
              <RelativeTime timestamp={c.occurred_at} className="flex-shrink-0 text-[10px] text-foreground tabular-nums" />
              {replyable && (
                <Reply className="flex-shrink-0 mt-0.5 w-3 h-3 text-violet-300 opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden />
              )}
            </>
          );
          return (
            <li key={c.id}>
              {replyable ? (
                <button
                  type="button"
                  onClick={() => onReplyTo(c.content)}
                  title={t.threadReplyTo}
                  aria-label={t.threadReplyTo}
                  className="group w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-violet-500/8 transition-colors focus-ring"
                >
                  {row}
                </button>
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
