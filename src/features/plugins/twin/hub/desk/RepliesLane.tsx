/**
 * Lane "replies" — the outbound loop, draft → review → log.
 *
 * The lane itself is `ReplyLane`, unchanged: it composes `ReplyOutbox`,
 * `SentReplies` and `ContactThread` and fetches the twin's channels and
 * communications itself, because neither is in the Hub's feed.
 *
 * The one thing this lane adds is the contact scope. `ContactThread` — the
 * recent-exchange strip you click a received message in to answer it — only
 * renders when a handle is chosen, and the only way to choose one used to be
 * selecting a person in the deleted Contacts prototype. The roster is already
 * in `feed.contacts`, so it becomes a chip row here and no capability leaves
 * with that prototype. An empty roster states the fact rather than hiding the
 * control, because a vanished affordance teaches nothing.
 */

import { useState } from 'react';
import { Users } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { ReplyLane } from '../ReplyLane';
import type { HubDeskProps } from '../hubContract';

export function RepliesLane({ feed }: HubDeskProps) {
  const t = useTranslation().t.twin.hub.reply;
  const [handle, setHandle] = useState<string | null>(null);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 xl:px-8 py-3 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Users className="w-3.5 h-3.5 text-primary flex-shrink-0" />
        <span className="typo-label text-foreground flex-shrink-0">{t.contactsLabel}</span>
        {feed.contacts.length === 0 ? (
          <span className="typo-caption text-foreground">{t.contactsNone}</span>
        ) : (
          <>
            <Chip active={handle === null} onClick={() => setHandle(null)} label={t.contactsAll} />
            {feed.contacts.map((c) => (
              <Chip
                key={c.id}
                active={handle === c.handle}
                onClick={() => setHandle((cur) => (cur === c.handle ? null : c.handle))}
                label={c.alias?.trim() ? c.alias : c.handle}
              />
            ))}
          </>
        )}
      </div>

      <ReplyLane contactHandle={handle} />
    </div>
  );
}

function Chip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`max-w-[12rem] truncate px-2 py-0.5 rounded-full border typo-caption transition-colors focus-ring ${
        active
          ? 'border-primary/40 bg-primary/15 text-primary'
          : 'border-border text-foreground hover:bg-secondary/50'
      }`}
    >
      {label}
    </button>
  );
}
