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
import { ConversationRail, type RailTab } from './ConversationRail';
import { PersonaConversation } from './PersonaConversation';
import { useConversation } from './useConversation';
import { useConversationRows } from './useConversationRows';
import { useTeamPin } from './useTeamPin';
import type { StreamTeam } from './types';
import type { Persona } from '@/lib/bindings/Persona';
import '../grid/prototype/entry-e/entryE.css';

/* ----------------------------------------------------------------------------
 * CONVERSATIONS — the Monitor's messenger, and the only place you write (D5).
 *
 * THE LAYOUT ARGUMENT (the /prototype question, and its answer): a team channel
 * is not a chat that occasionally mentions work — the work IS most of what
 * happened. So the work lives IN the stream, as full-width BANDS, with talk as
 * narrow inset bubbles beside them. The separation is GEOMETRIC: you can tell
 * what kind of thing a row is without reading a word, which is what stops the
 * timeline degenerating into "chat with dashboards sprinkled in".
 *
 * Capability work (blue) and improvement dialogue (violet) read as siblings,
 * interleaved in real chronology with the conversation that produced them —
 * which is the whole of D1.
 *
 * What the bands DON'T carry is machinery. A card that also held advance /
 * run-to-budget / split / escalate would be the dashboard-in-a-chat this thesis
 * rejects. Focus a card and its controls appear in the RAIL. That split is what
 * lets the Teams Collab and Deliberations panes be deleted without loss.
 * -------------------------------------------------------------------------- */

/* ONE ROOF (mandate-lanes WP8). The view is built from Activity's panel
 * language (entry-e/entryE.css): the `ae-root` panel on the Monitor surface, a
 * command strip, and three plates - projects, the conversation, the rail - so
 * Activity, Queue and Conversations read as one instrument. Lamps follow the
 * annunciator grammar: lit only where something works (a team's members at
 * work) or needs the operator (held steps on the rail). */

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
  const [focusDelib, setFocusDelib] = useState<string | null>(null);
  const [tab, setTab] = useState<RailTab>('reviews');
  // Two rails, two remembered widths, two edges. The keys are their own — a
  // shared one would make dragging either move both.
  const sidebarRail = useRailWidth({ storageKey: 'conversation-sidebar-width', defaultWidth: 280, side: 'left' });
  const decisionRail = useRailWidth({ storageKey: 'conversation-rail-width', defaultWidth: 320 });

  useEffect(() => {
    if (!activeId && teams[0]) setActiveId(teams[0].teamId);
  }, [teams, activeId]);
  useEffect(() => {
    setFocusDelib(null);
    setTab('reviews');
  }, [activeId, activePersonaId]);

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
  // The rail's Reviews are scoped to THIS persona only, or to the open team.
  const railMembers = useMemo(() => {
    if (activePersona) {
      const { id, name, icon, color } = activePersona;
      return [{ memberId: id, personaId: id, name, icon, color }];
    }
    return team ? team.members : null;
  }, [activePersona, team]);
  /** The predicate every rail tab shares; `null` only with no team and no
   *  persona, where scoping to the empty set would hide the fleet. */
  const railPersonaIds = useMemo<ReadonlySet<string> | null>(
    () => (railMembers ? new Set(railMembers.map((m) => m.personaId)) : null),
    [railMembers],
  );

  const conv = useConversation(activeId, focusItemId);
  const { loaded, markSeen } = conv;
  // Opening a conversation marks it read — the sidebar badge is the D6 watermark.
  useEffect(() => {
    if (loaded) markSeen();
  }, [loaded, markSeen, activeId]);

  const { pin, pinned } = useTeamPin(activeId);
  const focusDeliberation = useCallback((id: string) => {
    setFocusDelib(id);
    setTab('focus');
  }, []);
  const renderRow = useConversationRows(conv, setDetail, focusDeliberation);

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
            tab={tab}
            onTab={setTab}
            scopeKey={activePersonaId ?? activeId}
            members={railMembers}
            personaScoped={!!activePersona}
            teamId={team?.teamId ?? null}
            focusDelib={focusDelib}
            railPersonaIds={railPersonaIds}
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
