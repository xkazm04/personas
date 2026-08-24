import { memo, useEffect, useMemo, useState } from 'react';
import { Radio } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/en';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
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
import type { StreamTeam } from './types';

/* ----------------------------------------------------------------------------
 * PROJECTS SIDEBAR — the messenger's conversation list.
 *
 * One row per team, read straight out of the shared channel cache: last message
 * preview, its time, the UNREAD BADGE (the D6 watermark built in P0, which had
 * no consumer until now), the member heartbeat strip (one dot per persona —
 * working pulses, waiting holds amber, idle dims by silence), and a pulse when
 * the team has a live deliberation.
 *
 * C2: each row is its own memo'd component with a per-key store selector and
 * memoized derivations. The previous shape derived unread/presence/lastSeen
 * for EVERY team inline in the parent's render, against a whole-map selector —
 * so any team's poll recomputed the whole sidebar. Now a quiet poll re-renders
 * nothing, and a busy team re-renders one row.
 * -------------------------------------------------------------------------- */

function previewOf(body: string | null | undefined): string {
  if (!body) return '—';
  return body.replace(/\s+/g, ' ').slice(0, 60);
}

/** Tooltip line for a member dot: "QA Guardian · Working" /
 *  "QA Guardian · Idle · last seen 3d ago". Plain string — title attr. */
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

const SidebarTeamRow = memo(function SidebarTeamRow({
  tm, active, onSelect, presenceTick,
}: {
  tm: StreamTeam;
  active: boolean;
  onSelect: (teamId: string) => void;
  /** Coarse minute counter — presence has a staleness window, so the row must
   *  re-derive it even when no new rows arrive. */
  presenceTick: number;
}) {
  const { t, tx } = useTranslation();
  const st = usePipelineStore((s) => s.channels[channelKey(tm.teamId)]) ?? EMPTY_CHANNEL;

  // All derivations hang off the items array's identity (stable across quiet
  // refreshes since C1) plus the minute tick that ages presence out.
  const newest = st.items[0];
  const unread = countUnread(st);
  const presence = derivePresence(st.items);
  const lastSeen = deriveLastSeen(st.items);
  let working = 0;
  for (const p of presence.values()) if (p === 'working') working++;
  const hasDeliberation = st.items.some((i) => i.deliberationId);
  void presenceTick;

  return (
    <button
      type="button"
      onClick={() => onSelect(tm.teamId)}
      aria-current={active}
      className={`w-full flex items-start gap-2.5 px-2 py-2 rounded-card text-left transition-colors ${
        active ? 'bg-primary/12' : 'hover:bg-secondary/30'
      }`}
    >
      {/* Crest — the channel's identity colour, per plan §5.2 */}
      <span
        className="mt-0.5 flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center typo-caption font-semibold"
        style={{ backgroundColor: `${tm.teamColor}22`, color: tm.teamColor, border: `1px solid ${tm.teamColor}55` }}
      >
        {cleanName(tm.teamName).slice(0, 2).toUpperCase()}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className={`typo-body truncate ${active ? 'text-foreground font-medium' : 'text-foreground'}`}>
            {cleanName(tm.teamName)}
          </span>
          {hasDeliberation && (
            <Radio className="w-3 h-3 flex-shrink-0 text-violet-300 animate-pulse" aria-label={t.monitor.conv_deliberation_active} />
          )}
          {newest && (
            <span className="ml-auto flex-shrink-0 typo-caption text-foreground opacity-45">
              <RelativeTime timestamp={newest.at} />
            </span>
          )}
        </span>
        <span className="flex items-center gap-1.5 mt-0.5">
          <span className="typo-caption text-foreground opacity-55 truncate">
            {previewOf(newest?.body)}
          </span>
          {unread > 0 && (
            <span className="ml-auto flex-shrink-0 min-w-[1.25rem] px-1 h-5 rounded-full bg-primary/25 text-foreground typo-caption font-medium tabular-nums flex items-center justify-center">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </span>
        {/* Member heartbeat strip — one dot per persona. Working
            pulses at full colour, waiting holds a steady ring, idle
            dims. The title carries name · status · last-seen, so the
            roster's health is readable without opening the channel. */}
        {tm.members.length > 0 && (
          <span className="mt-1 flex items-center gap-1">
            {tm.members.slice(0, 10).map((m) => {
              const p = presence.get(m.personaId);
              const color = m.color ?? memberColor(undefined, m.personaId);
              return (
                <span
                  key={m.memberId}
                  title={memberTitle(t, m.name, p, lastSeen.get(m.personaId))}
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    p === 'working'
                      ? 'animate-pulse'
                      : p === 'waiting'
                        ? 'opacity-80 ring-1 ring-status-warning'
                        : 'opacity-30'
                  }`}
                  style={{ backgroundColor: color }}
                />
              );
            })}
            {tm.members.length > 10 && (
              <span className="typo-caption text-foreground opacity-40">+{tm.members.length - 10}</span>
            )}
            {working > 0 && (
              <span className="ml-auto inline-flex items-center gap-1 typo-caption text-status-info">
                {tx(t.monitor.conv_working, { count: working })}
              </span>
            )}
          </span>
        )}
      </span>
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
      className={`w-full flex items-start gap-2.5 px-2 py-2 rounded-card text-left transition-colors ${
        active ? 'bg-primary/12' : 'hover:bg-secondary/30'
      }`}
    >
      <span className="mt-0.5 flex-shrink-0">
        <PersonaIcon icon={persona.icon} color={persona.color} display="framed" frameSize="sm" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className={`typo-body truncate ${active ? 'text-foreground font-medium' : 'text-foreground'}`}>
            {name}
          </span>
          {newest && (
            <span className="ml-auto flex-shrink-0 typo-caption text-foreground opacity-45">
              <RelativeTime timestamp={newest.at} />
            </span>
          )}
        </span>
        <span className="flex items-center gap-1.5 mt-0.5">
          <span className="typo-caption text-foreground opacity-55 truncate">
            {previewOf(newest?.body ?? newest?.title)}
          </span>
          {unread > 0 && (
            <span className="ml-auto flex-shrink-0 min-w-[1.25rem] px-1 h-5 rounded-full bg-primary/25 text-foreground typo-caption font-medium tabular-nums flex items-center justify-center">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
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
  // window. A coarse minute tick keeps the strip honest while costing one
  // sidebar render per minute.
  const [presenceTick, setPresenceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setPresenceTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

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
            presenceTick={presenceTick}
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
