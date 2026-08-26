// useChannelWorkspace — the state the three channel surfaces (Timeline ·
// Conversations · Map) share, lifted out of the retired MonitorChannelGrid so
// PersonaMonitor can mount each surface directly from its header router.
//
// What lives here: the team roster derived from personas, the team filter the
// Timeline drives, the Slack-bridge index only Conversations needs, and the
// map's drill-in scope. What does NOT live here: which surface is showing —
// that is the Monitor's top-level route now, not a nested layout switch.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { listTeamSlackBridgesSafe } from '@/api/pipeline/teamSlackBridges';
import type { ChannelMember } from '@/features/teams/sub_collab/collabRender';
import type { TeamSlackBridge } from '@/lib/channel/teamBridge';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
import type { StreamTeam } from './types';

/** Transient scope a deep-link can open the channel surfaces with. */
export interface ChannelPreset {
  teamId: string | null;
  personaId: string | null;
}

interface Options {
  teams: PersonaTeam[];
  personas: Persona[];
  preset?: ChannelPreset | null;
  /** Slack bridges are fetched only while the Conversations surface is up. */
  needBridges: boolean;
}

export function useChannelWorkspace({ teams, personas, preset, needBridges }: Options) {
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
  // instead — the same scan the poller and the outbound relay run — and only
  // the Conversations surface consumes the index, so the fetch waits until that
  // tab is actually up (`needBridges`) and then runs once.
  const [bridges, setBridges] = useState<Record<string, TeamSlackBridge>>({});
  const [bridgesLoaded, setBridgesLoaded] = useState(false);
  useEffect(() => {
    if (!needBridges || bridgesLoaded) return;
    let cancelled = false;
    void listTeamSlackBridgesSafe().then((rows) => {
      if (cancelled) return;
      const index: Record<string, TeamSlackBridge> = {};
      for (const row of rows) {
        if (index[row.teamId]) continue; // first bridge wins, as in the engine
        index[row.teamId] = { personaId: row.personaId, channel: row.slackChannelId };
      }
      setBridges(index);
      setBridgesLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [needBridges, bridgesLoaded]);

  const channelTeams = useMemo(
    () => teams.filter((tm) => (membersByTeam.get(tm.id)?.length ?? 0) > 0),
    [teams, membersByTeam],
  );

  // The Timeline's team filter. Conversations picks ONE project from its
  // sidebar, so it ignores this — but the selection persists across a tab
  // switch. A deep-link preset scopes the initial selection to its team and
  // counts as a user choice, so the fill-all effect below must not widen it
  // back out.
  const [selected, setSelected] = useState<Set<string>>(
    () => (preset?.teamId ? new Set([preset.teamId]) : new Set()),
  );
  const [touched, setTouched] = useState(() => !!preset?.teamId);
  useEffect(() => {
    if (!touched && channelTeams.length > 0) {
      setSelected(new Set(channelTeams.map((tm) => tm.id)));
    }
  }, [channelTeams, touched]);

  const toggle = useCallback((id: string) => {
    setTouched(true);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const allOn = channelTeams.length > 0 && channelTeams.every((tm) => selected.has(tm.id));
  const setAll = useCallback(
    (on: boolean) => {
      setTouched(true);
      setSelected(on ? new Set(channelTeams.map((tm) => tm.id)) : new Set());
    },
    [channelTeams],
  );

  // Map node click → Timeline scoped to that speaker. Stream remounts on a tab
  // switch, so the callsign lands through its initial-lens prop.
  const [drillCallsign, setDrillCallsign] = useState<string | null>(null);
  const scopeToPersona = useCallback((teamId: string, personaId: string) => {
    setTouched(true);
    setSelected(new Set([teamId]));
    setDrillCallsign(personaId);
  }, []);
  /** A manual tab switch drops any pending drill scope — only the map's node
   *  click should carry a callsign into the Timeline. */
  const clearDrill = useCallback(() => setDrillCallsign(null), []);

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

  // Persona conversations (W5) don't need a team — with zero staffed teams but
  // enabled personas the workspace still opens (Conversations shows the
  // Personas group; the Timeline/Map are simply empty). Only a fleet with
  // neither has nothing to show.
  const hasChannels = channelTeams.length > 0 || personas.some((p) => p.enabled);

  return {
    workspaceTeams,
    bridges,
    toggle,
    allOn,
    setAll,
    drillCallsign: drillCallsign ?? preset?.personaId ?? undefined,
    scopeToPersona,
    clearDrill,
    hasChannels,
  };
}
