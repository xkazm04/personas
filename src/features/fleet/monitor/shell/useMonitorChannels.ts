import { useCallback, useEffect, useState } from 'react';
import type { Persona } from '@/lib/bindings/Persona';
import { useSystemStore } from '@/stores/systemStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { usePipelineStore } from '@/stores/pipelineStore';
import { useChannelWorkspace } from '../channels';
import type { MonitorView } from './monitorRouter';

/**
 * Teams, the channel workspace and the Map's drill-in: everything the Activity
 * board's grouping and the channel surfaces share.
 */
export function useMonitorChannels(view: MonitorView, personas: Persona[]) {
  // The lens preset riding along with a Timeline deep-link (team/persona
  // scope). Captured once per mount, then cleared — the same transient
  // contract as monitorInitialView.
  const monitorChannelPreset = useSystemStore((s) => s.monitorChannelPreset);
  const setMonitorChannelPreset = useSystemStore((s) => s.setMonitorChannelPreset);
  const [channelPreset, setChannelPreset] = useState(monitorChannelPreset);
  useEffect(() => {
    if (!monitorChannelPreset) return;
    setChannelPreset(monitorChannelPreset);
    setMonitorChannelPreset(null);
  }, [monitorChannelPreset, setMonitorChannelPreset]);

  // Teams power the Activity board's grouping + the channel surfaces.
  const teams = usePipelineStore((s) => s.teams);
  const fetchTeams = usePipelineStore((s) => s.fetchTeams);
  useEffect(() => {
    void fetchTeams();
  }, [fetchTeams]);

  // Everything the channel surfaces share (roster, team filter, Slack
  // bridges). Bridges are only fetched once Conversations is up.
  //
  // The team filter (`selectOnly` / `allOn` / `setAll`) and the drill scope
  // (`drillCallsign` / `scopeToPersona` / `clearDrill`) were the Timeline's,
  // and the Timeline is an Overview tab now — `TimelinePage` calls this same
  // hook for them. Nothing left in the Monitor reads them.
  const { workspaceTeams, bridges, hasChannels } = useChannelWorkspace({
    teams,
    personas,
    preset: channelPreset,
    needBridges: view === 'conversations',
  });

  /* MAP NODE CLICK → THE TIMELINE, WHICH IS NO LONGER HERE.
   *
   * This used to be a tab switch inside one overlay. The Map stayed in the
   * Monitor and the Timeline moved to Overview > Monitoring on 2026-10-06, so
   * the gesture now crosses surfaces. The alternative was to drop it — the
   * drill-in is the Map's only reason to be more than a picture, so it is
   * kept, and kept HONEST: it navigates rather than pretending to stay put.
   *
   * Three writes, in this order: park the speaker in `pendingTimelineScope`
   * (Overview's own transient signal, NOT the Monitor's `monitorChannelPreset`
   * — the Monitor is mounted-but-hidden after the navigation and would
   * consume-and-clear that one out from under the destination), select the
   * Timeline tab, then switch section. `setSidebarSection` clears
   * `headerOverlay`, which is what closes the overlay, so it goes last.
   */
  const setPendingTimelineScope = useOverviewStore((s) => s.setPendingTimelineScope);
  const setOverviewTab = useOverviewStore((s) => s.setOverviewTab);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const handleDrillIn = useCallback(
    (teamId: string, personaId: string) => {
      setPendingTimelineScope({ teamId, personaId });
      setOverviewTab('timeline');
      setSidebarSection('overview');
    },
    [setPendingTimelineScope, setOverviewTab, setSidebarSection],
  );

  return { teams, workspaceTeams, bridges, hasChannels, channelPreset, handleDrillIn };
}
