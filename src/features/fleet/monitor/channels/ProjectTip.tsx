import { useTranslation } from '@/i18n/useTranslation';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import type { ChannelMember } from '@/features/teams/sub_collab/collabRender';
import type { PresenceStatus } from '@/features/teams/sub_collab/useTeamChannel';
import { formatRelativeTime } from '@/lib/utils/formatters';

const SHOWN = 8;

/**
 * A project row's tooltip: the heartbeat said in words. The share strip's
 * three figures, a live deliberation, the last message's time, then one line
 * per member ("QA Guardian · Idle · last seen 3d ago"), as the member dots of
 * the old row told it one hover at a time.
 */
export function ProjectTip({ name, members, presence, lastSeen, share, live, newestAt }: {
  name: string;
  members: ChannelMember[];
  presence: Map<string, PresenceStatus>;
  lastSeen: Map<string, number>;
  share: { working: number; waiting: number; idle: number };
  live: boolean;
  newestAt: string | null;
}) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const word = (p: PresenceStatus | undefined) => (p === 'working' ? m.presence_working : p === 'waiting' ? m.presence_waiting : m.presence_idle);
  return (
    <span className="flex max-w-[18rem] flex-col gap-0.5">
      <span className="typo-heading text-foreground">{name}</span>
      <span className="typo-caption">
        {tx(m.conv_working, { count: share.working })} · {tx(m.cv_tip_waiting, { count: share.waiting })} · {tx(m.cv_tip_idle, { count: share.idle })}
      </span>
      {live && <span className="typo-caption text-role-agent">{m.conv_deliberation_active}</span>}
      {newestAt && <span className="typo-caption"><RelativeTime timestamp={newestAt} /></span>}
      {members.slice(0, SHOWN).map((mb) => {
        const p = presence.get(mb.personaId);
        const seen = lastSeen.get(mb.personaId);
        return (
          <span key={mb.memberId} className="truncate typo-caption">
            {mb.name.replace(/^T:\s*/, '')} · {word(p)}
            {!p && seen ? ` · ${tx(m.presence_last_seen, { time: formatRelativeTime(new Date(seen).toISOString()) })}` : ''}
          </span>
        );
      })}
      {members.length > SHOWN && <span className="typo-caption">+{members.length - SHOWN}</span>}
    </span>
  );
}
