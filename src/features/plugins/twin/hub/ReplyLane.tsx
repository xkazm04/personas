/**
 * The reply lane — the operational draft → review → log loop, the body of the
 * desk's Replies lane, so the brain and the mouth are on one surface.
 *
 * It COMPOSES `ReplyOutbox`, `SentReplies` and `ContactThread` from
 * `../sub_channels/` rather than reimplementing them: the physical move of
 * those files is a later cleanup package, and this lane is written so that move
 * is a change of import path and nothing else.
 *
 * Two things the Hub's feed cannot supply, so the lane fetches them itself:
 * the twin's CHANNELS (the outbox picks one) and the `twinCommunications`
 * store slice the two channel components read. `useHubFeed` deliberately keeps
 * its own snapshot instead of that slice, so nothing else on this surface
 * hydrates it — see `useHubFeed`'s header for why the slice is not trusted as
 * the Hub's source of truth.
 */

import { useEffect, useMemo, useState } from 'react';
import { MessagesSquare } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { ContactThread } from '../sub_channels/ContactThread';
import { ReplyOutbox } from '../sub_channels/ReplyOutbox';
import { SentReplies, type ReuseRequest } from '../sub_channels/SentReplies';
import { ChannelHealthStrip } from './ChannelHealthStrip';

/** Newest N communications, matching `useChannelActivity`'s own window. */
const RECENT_LIMIT = 200;

export function ReplyLane({ contactHandle = null }: {
  /** When set, the lane leads with this contact's cross-channel exchange as
   *  reply context — what `ContactThread` was written for. */
  contactHandle?: string | null;
}) {
  const t = useTranslation().t.twin.hub.reply;
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const channels = useSystemStore((s) => s.twinChannels);
  const fetchTwinChannels = useSystemStore((s) => s.fetchTwinChannels);
  const fetchTwinCommunications = useSystemStore((s) => s.fetchTwinCommunications);
  const [reuse, setReuse] = useState<ReuseRequest | null>(null);

  useEffect(() => {
    if (!activeTwinId) return;
    void fetchTwinChannels(activeTwinId);
    void fetchTwinCommunications(activeTwinId, undefined, RECENT_LIMIT);
  }, [activeTwinId, fetchTwinChannels, fetchTwinCommunications]);

  const scoped = useMemo(
    () => channels.filter((c) => c.twin_id === activeTwinId),
    [channels, activeTwinId],
  );
  const hasActive = scoped.some((c) => c.is_active);

  if (!activeTwinId) return null;

  return (
    <section className="rounded-card border border-border bg-card/30 overflow-hidden">
      <header className="flex items-center gap-2 px-3 py-2 border-b border-border bg-gradient-to-r from-primary/8 to-transparent">
        <span className="w-6 h-6 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center flex-shrink-0">
          <MessagesSquare className="w-3.5 h-3.5 text-primary" />
        </span>
        <span className="min-w-0">
          <span className="block typo-card-label text-foreground">{t.title}</span>
          <span className="block typo-caption text-foreground truncate">{t.subtitle}</span>
        </span>
      </header>

      <div className="p-3 space-y-3">
        {contactHandle && (
          <ContactThread twinId={activeTwinId} channel="" contactHandle={contactHandle} />
        )}
        {!hasActive && <p className="typo-caption text-status-warning">{t.noChannels}</p>}
        {/* Which of these channels is actually alive, BEFORE the outbox offers
            one to draft into. The lane already hydrates `twinCommunications`
            above, which is the slice the strip's hook reads. */}
        <ChannelHealthStrip twinId={activeTwinId} channels={scoped} />
        <ReplyOutbox channels={scoped} reuseRequest={reuse} />
        <SentReplies channels={scoped} onReuse={setReuse} />
      </div>
    </section>
  );
}
