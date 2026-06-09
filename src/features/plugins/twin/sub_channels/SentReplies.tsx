import { useMemo } from 'react';
import { CornerUpLeft, Send } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { CopyButton } from '@/features/shared/components/buttons/CopyButton';
import type { TwinChannel } from '@/lib/bindings/TwinChannel';

/** A request to adapt a past sent reply in the Reply Outbox. `ts` keys
 *  consumption so the same row can be reused twice in a row. */
export interface ReuseRequest {
  ts: number;
  channel: string;
  contactHandle: string;
  content: string;
}

/* ------------------------------------------------------------------ *
 *  SentReplies — recently logged outbound messages across the twin's
 *  channels. Makes the draft→approve→log loop visible: every reply
 *  approved in the outbox (or otherwise logged outbound) appears here
 *  with its channel, contact, time, and a copy button to reuse the
 *  wording. Reads the twinCommunications slice the Channels page already
 *  fetches; training Q&A (channel "training") is excluded so this stays
 *  a record of real channel sends. Hidden until at least one exists.
 * ------------------------------------------------------------------ */

const MAX_ROWS = 6;

export function SentReplies({ channels, onReuse }: { channels: TwinChannel[]; onReuse: (r: ReuseRequest) => void }) {
  const { t: tFull, tx } = useTranslation();
  const t = tFull.twin.channels;
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const communications = useSystemStore((s) => s.twinCommunications);

  const labelByChannel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of channels) m.set(c.channel_type, c.label ?? c.channel_type);
    return m;
  }, [channels]);

  const sent = useMemo(() => {
    if (!activeTwinId) return [];
    return communications
      .filter((c) => c.twin_id === activeTwinId && c.direction === 'out' && c.channel !== 'training')
      .slice()
      .sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1))
      .slice(0, MAX_ROWS);
  }, [communications, activeTwinId]);

  if (sent.length === 0) return null;

  return (
    <section className="rounded-card border border-primary/10 bg-card/30 overflow-hidden">
      <div className="flex items-center gap-1.5 px-4 py-2 border-b border-primary/10">
        <Send className="w-3.5 h-3.5 text-emerald-300" />
        <span className="text-[10px] uppercase tracking-[0.18em] font-medium text-foreground">{t.sentTitle}</span>
      </div>
      <ul className="divide-y divide-primary/5">
        {sent.map((c) => (
          <li key={c.id} className="flex items-start gap-2.5 px-4 py-2.5">
            <span className="flex-shrink-0 mt-0.5 px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 text-[9px] uppercase tracking-wider font-medium">
              {labelByChannel.get(c.channel) ?? c.channel}
            </span>
            <div className="flex-1 min-w-0">
              <p className="typo-caption text-foreground leading-snug line-clamp-2">{c.content}</p>
              <div className="flex items-center gap-2 mt-1">
                {c.contact_handle && (
                  <span className="text-[10px] text-foreground truncate">{tx(t.sentTo, { handle: c.contact_handle })}</span>
                )}
                <RelativeTime timestamp={c.occurred_at} className="text-[10px] text-foreground tabular-nums" />
              </div>
            </div>
            <span className="flex-shrink-0 flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => onReuse({ ts: Date.now(), channel: c.channel, contactHandle: c.contact_handle ?? '', content: c.content })}
                title={t.sentReuse}
                aria-label={t.sentReuse}
                className="p-1 rounded-interactive text-foreground hover:text-violet-300 hover:bg-violet-500/10 transition-colors focus-ring"
              >
                <CornerUpLeft className="w-3.5 h-3.5" />
              </button>
              <CopyButton text={c.content} className="text-foreground" />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
