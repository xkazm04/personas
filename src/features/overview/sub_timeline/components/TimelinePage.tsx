// TimelinePage — the host the merged decision log got when it left the Monitor.
//
// MOVED 2026-10-06 from `PersonaMonitor`'s header router to Overview >
// Monitoring > Timeline. The Monitor kept the three surfaces you ACT on
// (Activity, Conversations, the Map); the Timeline is read-only by design
// (see `Stream`'s header, D5), so it belongs with Overview's other read-only
// ledgers — Activity and Events sit in the same sidebar group.
//
// WHAT A HOST HAS TO SUPPLY. `Stream` takes five props and all five come from
// `useChannelWorkspace`, which is not Monitor-specific in its data: it takes
// `teams` and `personas` as arguments and derives the roster, the team filter
// and the drill scope from them. So this host does exactly what the Monitor
// did — read the two rosters from their stores, make sure they are fetched,
// and pass the hook's output straight through.
//
// `layoutControl` is NOT passed. It is the slot `Stream` renders the Monitor's
// view switcher into, so the header is one strip instead of two; the Monitor
// never passed it either, and here there is no switcher to place — the sidebar
// is the navigation on this surface. The prop stays declared on `Stream` for
// the Monitor-era callers that may yet return; nothing in `src/` sets it.

import { useEffect } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { usePipelineStore } from '@/stores/pipelineStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { useChannelWorkspace } from '@/features/fleet/monitor/channels';
import type { Persona } from '@/lib/bindings/Persona';
import { Stream } from './Stream';

export default function TimelinePage() {
  const personas = useAgentStore((s) => s.personas) as Persona[];
  const fetchPersonas = useAgentStore((s) => s.fetchPersonas);
  const teams = usePipelineStore((s) => s.teams);
  const fetchTeams = usePipelineStore((s) => s.fetchTeams);

  // The Monitor mounted with its own roster already in flight; this tab can be
  // the first thing a session opens, so it asks for both. Each store's fetch
  // is idempotent and cached, so an already-loaded roster costs one call that
  // resolves from cache rather than a second read.
  useEffect(() => {
    void fetchTeams();
  }, [fetchTeams]);
  // Keyed on the LENGTH, not the array: an empty roster leaves the deps
  // unchanged, so a fleet that genuinely has no personas asks once rather
  // than on every render.
  useEffect(() => {
    if (personas.length === 0) void fetchPersonas();
  }, [personas.length, fetchPersonas]);

  // THE MAP'S DRILL-IN, ARRIVING FROM THE OTHER SURFACE. The Map is still a
  // Monitor view; clicking a node parks `{teamId, personaId}` here and routes
  // to this tab (see `PersonaMonitor.handleDrillIn`). Consumed as the initial
  // team scope + callsign lens, then cleared, so the next visit opens on the
  // full feed — the same transient contract the Monitor's own presets kept.
  const pendingTimelineScope = useOverviewStore((s) => s.pendingTimelineScope);
  const setPendingTimelineScope = useOverviewStore((s) => s.setPendingTimelineScope);
  useEffect(() => {
    if (!pendingTimelineScope) return;
    setPendingTimelineScope(null);
  }, [pendingTimelineScope, setPendingTimelineScope]);

  const { workspaceTeams, selectOnly, allOn, setAll, drillCallsign } = useChannelWorkspace({
    teams,
    personas,
    preset: pendingTimelineScope
      ? { teamId: pendingTimelineScope.teamId, personaId: pendingTimelineScope.personaId, itemId: null }
      : null,
    // Slack bridges belong to Conversations, which stayed in the Monitor.
    needBridges: false,
  });

  return (
    /* `Stream` draws its own full-height card with its own header, exactly as
       it did inside the Monitor's body wrapper; the host owes it a bounded
       box and the page gutter, nothing more. */
    <div data-testid="tab-timeline" className="flex-1 min-h-0 flex flex-col w-full overflow-hidden p-3">
      <Stream
        teams={workspaceTeams}
        onSelectTeam={selectOnly}
        allOn={allOn}
        onSetAll={setAll}
        initialCallsign={drillCallsign}
      />
    </div>
  );
}
