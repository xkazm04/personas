import { memo, useEffect, useMemo, useState } from 'react';
import { Radio } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/en';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { usePipelineStore } from '@/stores/pipelineStore';
import { channelKey, countUnread, EMPTY_CHANNEL } from '@/stores/slices/pipeline/channelSlice';
import {
  countPersonaUnread,
  readPersonaLastSeen,
} from '@/stores/slices/pipeline/personaChannelSlice';
import type { Persona } from '@/lib/bindings/Persona';
import { derivePresence, deriveLastSeen, type PresenceStatus } from '@/features/teams/sub_collab/useTeamChannel';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { memberColor } from '@/lib/channel/eventModel';
import { cleanName } from '../grid/fleetGridModel';
import { useMonitorVisible } from '../monitorVisibility';
import type { StreamTeam } from './types';

/* ----------------------------------------------------------------------------
 * PROJECTS SIDEBAR — the messenger's conversation list.
 *
 * TWO LINES PER ROW, and no third (Q2, 2026-10-06). Line 1 is the channel's
 * name, a pulse when a deliberation is live, and the UNREAD BADGE pushed
 * right. Line 2 is the member heartbeat strip — one dot per persona, working
 * pulses, waiting holds a ring, idle dims — with the working count and the
 * LAST MESSAGE'S TIME pushed right. The identity crest (two initials in the
 * team colour) and the last-message PREVIEW LINE are both gone: the preview
 * spent a whole row restating what opening the channel shows in full, and the
 * crest restated the name sitting beside it.
 *
 * C2: each row is its own memo'd component with a per-key store selector. The
 * previous shape derived unread/presence/lastSeen for EVERY team inline in the
 * parent's render, against a whole-map selector — so any team's poll
 * recomputed the whole sidebar. Now a quiet poll re-renders nothing, and a
 * busy team re-renders one row.
 *
 * Those derivations really are memoized now (`useMemo` on the items array's
 * identity). The header claimed it from C2 onward while the code ran four bare
 * inline calls per render; the claim mattered because the minute clock below
 * re-renders every row on purpose, and under the fiction that tick re-derived
 * everything rather than only the one thing that ages.
 * -------------------------------------------------------------------------- */

/** Tooltip line for a member dot: "QA Guardian · Working" /
 *  "QA Guardian · Idle · last seen 3d ago". */
function memberTitle(
  t: Translations,
  name: string,
  presence: PresenceStatus | undefined,
  lastSeenMs: number | undefined,
): string {
  const status =
    presence === 'working'
      ? t.monitor.presence_working
      : presence === 'waiting'
        ? t.monitor.presence_waiting
        : t.monitor.presence_idle;
  const seen =
    !presence && lastSeenMs
      ? ` · ${t.monitor.presence_last_seen.replace('{time}', formatRelativeTime(new Date(lastSeenMs).toISOString()))}`
      : '';
  return `${name} · ${status}${seen}`;
}

const ROW_CLASS = 'w-full px-2 py-2 rounded-card text-left transition-colors';
const UNREAD_CLASS =
  'ml-auto flex-shrink-0 min-w-[1.25rem] px-1 h-5 rounded-full bg-primary/25 text-foreground typo-caption tabular-nums flex items-center justify-center';

const SidebarTeamRow = memo(function SidebarTeamRow({
  tm, active, onSelect, presenceNow,
}: {
  tm: StreamTeam;
  active: boolean;
  onSelect: (teamId: string) => void;
  /** Coarse minute clock — presence has a staleness window, so the row must
   *  re-derive it even when no new rows arrive. A TIMESTAMP rather than a
   *  counter so it is a real argument to `derivePresence`, which keeps the
   *  memo below honest instead of needing a `void` to silence the dep rule. */
  presenceNow: number;
}) {
  const { t, tx } = useTranslation();
  const st = usePipelineStore((s) => s.channels[channelKey(tm.teamId)]) ?? EMPTY_CHANNEL;
  const items = st.items;

  // All derivations hang off the items array's identity (stable across quiet
  // refreshes since C1). Only presence also takes the minute clock, because
  // only presence ages out on its own.
  const newest = items[0];
  const unread = useMemo(() => countUnread(st), [st]);
  const presence = useMemo(() => derivePresence(items, presenceNow), [items, presenceNow]);
  const lastSeen = useMemo(() => deriveLastSeen(items), [items]);
  const hasDeliberation = useMemo(() => items.some((i) => i.deliberationId), [items]);
  const working = useMemo(() => {
    let n = 0;
    for (const p of presence.values()) if (p === 'working') n++;
    return n;
  }, [presence]);

  return (
    <button
      type="button"
      onClick={() => onSelect(tm.teamId)}
      aria-current={active}
      className={`${ROW_CLASS} ${active ? 'bg-primary/12' : 'hover:bg-secondary/30'}`}
    >
      <span className="flex items-center gap-1.5">
        <span className="typo-body truncate text-foreground">{cleanName(tm.teamName)}</span>
        {hasDeliberation && (
          <Radio
            className="w-3 h-3 flex-shrink-0 text-role-agent animate-pulse"
            aria-label={t.monitor.conv_deliberation_active}
          />
        )}
        {unread > 0 && <span className={UNREAD_CLASS}>{unread > 99 ? '99+' : unread}</span>}
      </span>
      {/* Member heartbeat strip — one dot per persona. Working pulses at full
          colour, waiting holds a steady ring, idle dims. The tip carries
          name · status · last-seen, so the roster's health is readable without
          opening the channel; the last message's time closes the line. */}
      {(tm.members.length > 0 || newest) && (
        <span className="mt-1 flex items-center gap-1">
          {tm.members.slice(0, 10).map((m) => {
            const p = presence.get(m.personaId);
            const color = m.color ?? memberColor(undefined, m.personaId);
            return (
              <Tooltip key={m.memberId} content={memberTitle(t, m.name, p, lastSeen.get(m.personaId))}>
                <span
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    p === 'working'
                      ? 'animate-pulse'
                      : p === 'waiting'
                        ? 'opacity-80 ring-1 ring-status-warning'
                        : 'opacity-30'
                  }`}
                  style={{ backgroundColor: color }}
                />
              </Tooltip>
            );
          })}
          {tm.members.length > 10 && (
            <span className="typo-caption text-foreground">+{tm.members.length - 10}</span>
          )}
          <span className="ml-auto flex-shrink-0 flex items-center gap-2">
            {working > 0 && (
              <span className="inline-flex items-center gap-1 typo-caption text-status-info">
                {tx(t.monitor.conv_working, { count: working })}
              </span>
            )}
            {newest && (
              <span className="typo-caption text-foreground">
                <RelativeTime timestamp={newest.at} />
              </span>
            )}
          </span>
        </span>
      )}
    </button>
  );
});

/* ----------------------------------------------------------------------------
 * PERSONAS GROUP — persona conversations, the team rows' sibling (W5).
 *
 * Listed: every enabled persona whose channel has at least one item, sorted by
 * newest item. Presence is derived from one `limit:1` preview read per persona
 * (`loadPersonaChannelPreviews`) — cheap, one-shot, refreshed by the
 * PERSONA_CHANNEL_MESSAGE push — so an empty channel never renders a dead row
 * and nothing here joins the full poll loop.
 *
 * ONE LINE, and the avatar STAYS. The team crest was two initials restating
 * the name beside it; `PersonaIcon` is the persona's own chosen mark and
 * colour, the same identity the roster, the grid and the chat header all
 * render, and it is the only thing on this row that is not text. A persona row
 * has no member strip to carry the last message's time, so the time and the
 * unread badge share the right end of the single line.
 * -------------------------------------------------------------------------- */

const SidebarPersonaRow = memo(function SidebarPersonaRow({
  persona, active, onSelect,
}: {
  persona: Persona;
  active: boolean;
  onSelect: (personaId: string) => void;
}) {
  // Preview drives the row; the full channel state (if this conversation has
  // been opened) upgrades the unread badge from a dot to a count.
  const preview = usePipelineStore((s) => s.personaChannelPreviews[persona.id]);
  const st = usePipelineStore((s) => s.personaChannels[persona.id]);
  const newest = st?.items[0] ?? preview;

  let unread = 0;
  if (st?.loaded) {
    unread = countPersonaUnread(st);
  } else if (preview && !(preview.kind === 'chat' && preview.authorKind === 'user')) {
    const seen = readPersonaLastSeen(persona.id);
    if (seen === null || preview.at > seen) unread = 1;
  }

  const name = persona.name.replace(/^T:\s*/, '');
  return (
    <button
      type="button"
      onClick={() => onSelect(persona.id)}
      aria-current={active}
      className={`${ROW_CLASS} flex items-center gap-2.5 ${active ? 'bg-primary/12' : 'hover:bg-secondary/30'}`}
    >
      <span className="flex-shrink-0">
        <PersonaIcon icon={persona.icon} color={persona.color} display="framed" frameSize="sm" />
      </span>
      <span className="min-w-0 flex-1 flex items-center gap-1.5">
        <span className="typo-body truncate text-foreground">{name}</span>
        <span className="ml-auto flex-shrink-0 flex items-center gap-2">
          {newest && (
            <span className="typo-caption text-foreground">
              <RelativeTime timestamp={newest.at} />
            </span>
          )}
          {unread > 0 && <span className={UNREAD_CLASS}>{unread > 99 ? '99+' : unread}</span>}
        </span>
      </span>
    </button>
  );
});

export const ConversationSidebar = memo(function ConversationSidebar({
  teams, personas, activeId, activePersonaId, onSelect, onSelectPersona,
}: {
  teams: StreamTeam[];
  /** Personas eligible for a conversation row (the workspace's roster). */
  personas?: Persona[];
  activeId: string | null;
  activePersonaId?: string | null;
  onSelect: (teamId: string) => void;
  onSelectPersona?: (personaId: string) => void;
}) {
  const { t } = useTranslation();
  const monitorVisible = useMonitorVisible();

  const loadPreviews = usePipelineStore((s) => s.loadPersonaChannelPreviews);
  const previews = usePipelineStore((s) => s.personaChannelPreviews);

  const enabled = useMemo(() => (personas ?? []).filter((p) => p.enabled), [personas]);

  // One preview read per persona missing one — idempotent across remounts.
  useEffect(() => {
    const missing = enabled.filter((p) => !(p.id in previews)).map((p) => p.id);
    if (missing.length) void loadPreviews(missing);
    // `previews` is deliberately read fresh but not a dep: reacting to its own
    // write would re-run for nothing (the `in` guard makes the call idempotent
    // anyway; this just skips the churn).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, loadPreviews]);

  // Personas with a channel, newest conversation first. Loaded-empty (null)
  // and not-yet-loaded (absent) both stay hidden.
  const withChannel = useMemo(
    () =>
      enabled
        .filter((p) => previews[p.id])
        .sort((a, b) => (previews[b.id]?.at ?? '').localeCompare(previews[a.id]?.at ?? '')),
    [enabled, previews],
  );

  // Presence has a staleness window (PRESENCE_WORK_WINDOW_MS): with no new
  // rows arriving nothing re-renders, so a "working" dot could outlive its
  // window. A coarse minute clock keeps the strip honest while costing one
  // sidebar render per minute.
  //
  // GATED ON VISIBILITY. The monitor stopped unmounting on close
  // (`monitorVisibility.ts`), so without this gate the sidebar would re-render
  // every team row once a minute for as long as the app is open, behind a
  // `content-visibility: hidden` subtree nobody is looking at. Re-reading the
  // clock on the way back in is the same "refresh a STALE feed on reopen" move
  // `useMonitorData` makes — presence is correct the moment the overlay is
  // shown again, rather than up to a minute after.
  const [presenceNow, setPresenceNow] = useState(() => Date.now());
  useEffect(() => {
    if (!monitorVisible) return;
    setPresenceNow(Date.now());
    const id = setInterval(() => setPresenceNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [monitorVisible]);

  return (
    <div className="h-full flex flex-col min-h-0 border-r border-border bg-foreground/[0.012]">
      <div className="flex-shrink-0 h-9 px-3 flex items-center border-b border-border">
        <span className="hud-title typo-label text-foreground opacity-60">{t.monitor.conv_projects}</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-0.5">
        {teams.map((tm) => (
          <SidebarTeamRow
            key={tm.teamId}
            tm={tm}
            active={tm.teamId === activeId}
            onSelect={onSelect}
            presenceNow={presenceNow}
          />
        ))}

        {onSelectPersona && withChannel.length > 0 && (
          <>
            <div className="px-2 pt-3 pb-1">
              <span className="hud-title typo-label text-foreground opacity-60">
                {t.monitor.conv_persona_group}
              </span>
            </div>
            {withChannel.map((p) => (
              <SidebarPersonaRow
                key={p.id}
                persona={p}
                active={p.id === activePersonaId}
                onSelect={onSelectPersona}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
});
