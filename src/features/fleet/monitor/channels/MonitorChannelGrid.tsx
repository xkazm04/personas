import { memo, useEffect, useMemo, useState } from 'react';
import { MessagesSquare } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { ChannelMember } from '@/features/teams/sub_collab/collabRender';
import { listTeamSlackBridgesSafe } from '@/api/pipeline/teamSlackBridges';
import type { TeamSlackBridge } from '@/lib/channel/teamBridge';
import { Stream } from './Stream';
import { ConversationBriefing } from './ConversationBriefing';
import { ChannelMap } from './map/ChannelMap';
import type { StreamTeam } from './types';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';

/** The three Channel surfaces. Stream = the read-only log (many teams, one
 *  flat feed). Conversations = the messenger (one project, and the only place
 *  you write) — plan D5. Map = the live constellation (one project, who is
 *  doing what to whom, no reading). The old GRID of cramped per-team channel
 *  cards is retired: it was a worse messenger with none of the affordances. */
type ChannelLayout = 'stream' | 'conversations' | 'map';

/** Transient scope a deep-link can open the workspace with. */
export interface ChannelPreset {
  teamId: string | null;
  personaId: string | null;
}

/**
 * Channel mode. Members are derived from personas by `home_team_id`, so no
 * extra fetch is needed.
 */
function MonitorChannelGridImpl({
  teams, personas, preset,
}: {
  teams: PersonaTeam[];
  personas: Persona[];
  preset?: ChannelPreset | null;
}) {
  const { t } = useTranslation();

  const membersByTeam = useMemo(() => {
    const map = new Map<string, ChannelMember[]>();
    for (const p of personas) {
      if (!p.home_team_id) continue;
      const arr = map.get(p.home_team_id) ?? [];
      arr.push({ memberId: p.id, personaId: p.id, name: p.name, icon: p.icon, color: p.color });
      map.set(p.home_team_id, arr);
    }
    return map;
  }, [personas]);

  // Slack bridges CANNOT be derived from `personas` here: the roster comes from
  // `list_personas`, a lean projection that returns `notification_channels`
  // blank, so every persona would look unbridged. The backend resolves them
  // instead — the same scan the poller and the outbound relay run — and this is
  // the one component in the channel workspace that needs the index, so it is
  // fetched once here and passed down.
  const [bridges, setBridges] = useState<Record<string, TeamSlackBridge>>({});
  useEffect(() => {
    let cancelled = false;
    void listTeamSlackBridgesSafe().then((rows) => {
      if (cancelled) return;
      const index: Record<string, TeamSlackBridge> = {};
      for (const row of rows) {
        if (index[row.teamId]) continue; // first bridge wins, as in the engine
        index[row.teamId] = { personaId: row.personaId, channel: row.slackChannelId };
      }
      setBridges(index);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const channelTeams = useMemo(
    () => teams.filter((tm) => (membersByTeam.get(tm.id)?.length ?? 0) > 0),
    [teams, membersByTeam],
  );

  // Stream's team filter. Conversations picks ONE project from its sidebar, so
  // it ignores this — but the selection persists across a layout switch.
  // A deep-link preset scopes the initial selection to its team and counts as
  // a user choice, so the fill-all effect below must not widen it back out.
  const [selected, setSelected] = useState<Set<string>>(
    () => (preset?.teamId ? new Set([preset.teamId]) : new Set()),
  );
  const [touched, setTouched] = useState(() => !!preset?.teamId);
  useEffect(() => {
    if (!touched && channelTeams.length > 0) {
      setSelected(new Set(channelTeams.map((tm) => tm.id)));
    }
  }, [channelTeams, touched]);

  const toggle = (id: string) => {
    setTouched(true);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const allOn = channelTeams.length > 0 && channelTeams.every((tm) => selected.has(tm.id));
  const setAll = (on: boolean) => {
    setTouched(true);
    setSelected(on ? new Set(channelTeams.map((tm) => tm.id)) : new Set());
  };

  const [layout, setLayout] = useState<ChannelLayout>('stream');
  const LAYOUTS: Array<{ id: ChannelLayout; label: string; hint: string }> = [
    { id: 'stream', label: t.monitor.channels_layout_timeline, hint: t.monitor.channels_layout_timeline_hint },
    { id: 'conversations', label: t.monitor.channels_layout_grid, hint: t.monitor.channels_layout_grid_hint },
    { id: 'map', label: t.monitor.channels_layout_map, hint: t.monitor.channels_layout_map_hint },
  ];

  // Map node click → Timeline scoped to that speaker. Stream remounts on a
  // layout switch, so the callsign lands through its initial-lens prop.
  const [drillCallsign, setDrillCallsign] = useState<string | null>(null);
  const drillIn = (teamId: string, personaId: string) => {
    setTouched(true);
    setSelected(new Set([teamId]));
    setDrillCallsign(personaId);
    setLayout('stream');
  };

  const workspaceTeams: StreamTeam[] = useMemo(
    () =>
      channelTeams.map((tm) => ({
        teamId: tm.id,
        teamName: tm.name,
        teamColor: tm.color,
        members: membersByTeam.get(tm.id) ?? [],
        selected: selected.has(tm.id),
      })),
    [channelTeams, selected, membersByTeam],
  );

  const layoutSwitcher = (
    <div className="flex-shrink-0 flex items-center gap-0.5 rounded-full bg-secondary/20 p-0.5">
      {LAYOUTS.map((l) => (
        <button
          key={l.id}
          type="button"
          onClick={() => {
            // Manual switch drops any pending drill scope — only the map's
            // node click should carry a callsign into the Timeline.
            setDrillCallsign(null);
            setLayout(l.id);
          }}
          title={l.hint}
          aria-pressed={layout === l.id}
          className={`px-2.5 py-0.5 rounded-full typo-caption transition-colors ${
            layout === l.id ? 'bg-primary/15 text-foreground font-medium' : 'text-foreground opacity-50 hover:opacity-80'
          }`}
        >
          {l.label}
        </button>
      ))}
    </div>
  );

  // Persona conversations (W5) don't need a team — with zero staffed teams
  // but enabled personas, the workspace still opens (Conversations shows the
  // Personas group; the Stream/Map are simply empty).
  if (channelTeams.length === 0 && !personas.some((p) => p.enabled)) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-center text-foreground">
        <MessagesSquare className="w-8 h-8 text-foreground" />
        <span className="typo-body">{t.monitor.channels_no_teams}</span>
      </div>
    );
  }

  return (
    <div className="h-full p-2 hud-atmosphere">
      {layout === 'stream' ? (
        <Stream
          teams={workspaceTeams}
          onToggle={toggle}
          allOn={allOn}
          onSetAll={setAll}
          layoutControl={layoutSwitcher}
          initialCallsign={drillCallsign ?? preset?.personaId ?? undefined}
        />
      ) : layout === 'map' ? (
        <ChannelMap teams={workspaceTeams} onDrillIn={drillIn} layoutControl={layoutSwitcher} />
      ) : (
        <ConversationBriefing teams={workspaceTeams} personas={personas} bridges={bridges} layoutControl={layoutSwitcher} />
      )}
    </div>
  );
}

/**
 * Memoized: `teams`/`personas` are stable store selectors, so PersonaMonitor's
 * frequent re-renders (e.g. the fleet 1s elapsed-time tick) bail out here
 * instead of cascading into the whole channel workspace.
 */
export const MonitorChannelGrid = memo(MonitorChannelGridImpl);

export default MonitorChannelGrid;
