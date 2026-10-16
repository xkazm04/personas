import { useCallback, useEffect, useMemo, useState } from 'react';
import { MessagesSquare } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { ChannelDetailModal } from '@/features/teams/sub_collab/ChannelDetailModal';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';
import { ConversationSidebar } from './ConversationSidebar';
import { RailSplitter } from './RailSplitter';
import { useRailWidth } from '../grid/rail/useRailWidth';
import { LinkedChannelChip } from './LinkedChannelChip';
import type { TeamSlackBridge } from '@/lib/channel/teamBridge';
import type { ChannelPreset } from './useChannelWorkspace';
import { ConversationPane } from './ConversationPane';
import { ConversationRail } from './ConversationRail';
import { PersonaConversation } from './PersonaConversation';
import { useConversation } from './useConversation';
import { useConversationRows } from './useConversationRows';
import { useTeamPin } from './useTeamPin';
import { scopeAsks } from './needsYouModel';
import { usePendingAsks } from './usePendingAsks';
import { useRailFocus } from './useRailFocus';
import type { StreamTeam } from './types';
import type { Persona } from '@/lib/bindings/Persona';
import '../grid/prototype/entry-e/entryE.css';

/* ----------------------------------------------------------------------------
 * CONVERSATIONS - the Monitor's messenger, and the only place you write (D5).
 *
 * Three plates in Activity's panel language (WP8 one roof, WP12 the owner's
 * V1): PROJECTS (one line per project in the Stewards row grammar, persona
 * threads below), the THREAD (work as outcome-first bands interleaved with
 * talk, the composer in the deck's well), and NEEDS YOU (reviews and held
 * questions as ONE queue decided in the deck's anatomy, or, after Drive, the
 * deliberation's controls). A band never carries machinery: its controls
 * live in the rail. Lamps light only where something works or needs the
 * operator.
 * -------------------------------------------------------------------------- */

export function ConversationBriefing({
  teams, personas, bridges, preset,
}: {
  teams: StreamTeam[];
  /** The workspace roster — feeds the sidebar's Personas group (W5). */
  personas?: Persona[];
  /** Slack bridges keyed by team id — derived once by the workspace host (see
   *  `lib/channel/teamBridge`). Absent = nothing is bridged. */
  bridges?: Record<string, TeamSlackBridge>;
  /** A deep link from a live pop-up: the team, the speaker, and the line. */
  preset?: ChannelPreset | null;
}) {
  const { t } = useTranslation();
  const [activeId, setActiveId] = useState<string | null>(preset?.teamId ?? null);
  // Persona scope: selecting a persona routes the main pane to the persona
  // conversation; selecting a team routes back. Exactly one is active.
  const [activePersonaId, setActivePersonaId] = useState<string | null>(null);
  // The line the link was about, consumed once. Held in state rather than read
  // straight from the prop so that selecting another team clears it — a pin
  // belongs to the conversation it was minted for.
  const [focusItemId, setFocusItemId] = useState<string | null>(preset?.itemId ?? null);
  const [detail, setDetail] = useState<TeamChannelItem | null>(null);
  // Two rails, two remembered widths, two edges, their own keys. The defaults
  // leave the thread as wide as it can be at 1280 while the rail still holds
  // the ask in hand and its dock (WP12).
  const sidebarRail = useRailWidth({ storageKey: 'conversation-sidebar-width', defaultWidth: 288, side: 'left' });
  const decisionRail = useRailWidth({ storageKey: 'conversation-rail-width', defaultWidth: 336 });

  useEffect(() => {
    if (!activeId && teams[0]) setActiveId(teams[0].teamId);
  }, [teams, activeId]);
  const rail = useRailFocus(activePersonaId ?? activeId);
  const pending = usePendingAsks();

  const selectTeam = useCallback((teamId: string) => {
    setActivePersonaId(null);
    setFocusItemId(null);
    setActiveId(teamId);
  }, []);

  const activePersona = useMemo(
    () => (activePersonaId ? personas?.find((p) => p.id === activePersonaId) ?? null : null),
    [personas, activePersonaId],
  );
  const team = useMemo(() => teams.find((t) => t.teamId === activeId) ?? null, [teams, activeId]);
  // The rail is scoped to THIS persona only, or to the open team's members;
  // `null` only with neither, where scoping to the empty set would hide the fleet.
  const railPersonaIds = useMemo<ReadonlySet<string> | null>(() => {
    if (activePersona) return new Set([activePersona.id]);
    return team ? new Set(team.members.map((m) => m.personaId)) : null;
  }, [activePersona, team]);
  const railAsks = useMemo(() => scopeAsks(pending.asks, railPersonaIds), [pending.asks, railPersonaIds]);

  const conv = useConversation(activeId, focusItemId);
  const { loaded, markSeen } = conv;
  // Opening a conversation marks it read — the sidebar badge is the D6 watermark.
  useEffect(() => {
    if (loaded) markSeen();
  }, [loaded, markSeen, activeId]);

  const { pin, pinned } = useTeamPin(activeId);
  const renderRow = useConversationRows(conv, setDetail, rail.drive, rail.tab === 'focus' ? rail.focusDelib : null);

  return (
    <div className="ae-root h-full flex flex-col min-h-0 overflow-hidden rounded-card border border-border">
      <div className="flex min-h-[52px] flex-shrink-0 items-center gap-3 border-b border-border px-3 py-2">
        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/10" aria-hidden>
          <MessagesSquare className="h-4 w-4 text-primary" />
        </span>
        <span className="typo-heading text-foreground">{t.monitor.conv_title}</span>
        {/* Passive: the active project's Slack bridge, if it has one. */}
        <LinkedChannelChip bridge={activeId ? bridges?.[activeId] : undefined} />
      </div>

      {/* Both rails resize, and remember, exactly the way the Activity rail
          does — same hook, same splitter, their own keys. The plates draw
          their own edges, so the splitters paint none. */}
      <div className="flex-1 min-h-0 flex p-2.5">
        <div className="flex-shrink-0 min-h-0 pr-1" style={{ width: sidebarRail.width }}>
          <ConversationSidebar
            teams={teams}
            personas={personas}
            activeId={activePersonaId ? null : activeId}
            activePersonaId={activePersonaId}
            onSelect={selectTeam}
            onSelectPersona={setActivePersonaId}
            asks={pending.asks}
            asksReadable={pending.readable}
          />
        </div>
        <RailSplitter rail={sidebarRail} side="left" bordered={false} label={t.monitor.conv_sidebar_resize} testId="conversation-sidebar-resize" />

        <section className="ae-plate mx-1 flex-1 min-w-0 flex flex-col min-h-0 overflow-hidden rounded-card">
          {activePersona ? (
            // Persona scope — its own composer (plain send) lives inside.
            <PersonaConversation persona={activePersona} />
          ) : (
            <ConversationPane team={team} conv={conv} renderRow={renderRow} />
          )}
        </section>

        <RailSplitter rail={decisionRail} bordered={false} label={t.monitor.conv_rail_resize} testId="conversation-rail-resize" />
        <div className="flex-shrink-0 min-h-0 pl-1" style={{ width: decisionRail.width }}>
          <ConversationRail
            key={activePersonaId ?? activeId ?? 'none'}
            tab={rail.tab}
            onTab={rail.setTab}
            asks={railAsks}
            pending={pending}
            personaScoped={!!activePersona}
            teamId={team?.teamId ?? null}
            focusDelib={rail.focusDelib}
          />
        </div>
      </div>

      <ChannelDetailModal
        item={detail}
        onClose={() => setDetail(null)}
        onPin={pin}
        pinned={detail ? pinned.has(detail.id) : false}
      />
    </div>
  );
}
