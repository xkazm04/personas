// THE DESK SLOT — the lazy boundary the decision rail lives behind.
//
// The weight is not the dock's pixels, it is `useRailSurface`: three feeds
// (the unified triage queue, the dispatch backlog, the merged channel
// projection) and two modals, 57 files and ~11.9k lines that the Activity
// shell used to pull eagerly because a HOOK cannot be lazily imported. Moving
// the hook CALL behind a component boundary is what makes it splittable at
// all, so this file exists for the graph, not for the design.
//
// It owns the open/shut state too, because nothing above it reads it: the
// `rowsEnabled: dockOpen` gate — a shut desk adapts no rows for any tab, while
// the three counts stay honest — is the same gate it always was, moved intact.

import { useCallback, useState } from 'react';
import type { FeedTeam } from '../../../channels/types';
import type { RailProjectFilter } from '../../rail/railFilter';
import { useRailWidth } from '../../rail/useRailWidth';
import { useRailSurface } from '../useRailSurface';
import type { SimRailRows } from '../../simulation';
import { DecisionDock, type DockTab } from './DecisionDock';

export function DeskSlot({
  feedTeams, onOpenSpeaker, scope, onClearScope, simulatedRail, ready, reducedMotion,
}: {
  feedTeams: FeedTeam[];
  onOpenSpeaker?: (teamId: string, personaId: string) => void;
  scope: RailProjectFilter | null;
  onClearScope: () => void;
  simulatedRail: SimRailRows | null;
  ready: boolean;
  reducedMotion: boolean;
}) {
  const width = useRailWidth();
  const [open, setOpen] = useState(false);
  const rail = useRailSurface({
    feedTeams,
    onOpenSpeaker,
    filter: scope,
    simulated: simulatedRail,
    // The desk is shut: nothing renders a row, so no feed builds one.
    rowsEnabled: open,
  });
  const { setTab } = rail;
  const onToggle = useCallback(() => setOpen((v) => !v), []);
  const onOpenTab = useCallback((tab: DockTab) => { setTab(tab); setOpen(true); }, [setTab]);

  return (
    <>
      <DecisionDock
        rail={rail}
        width={width}
        open={open}
        onToggle={onToggle}
        onOpenTab={onOpenTab}
        scope={scope}
        onClearScope={onClearScope}
        ready={ready}
        reducedMotion={reducedMotion}
      />
      {rail.modals}
    </>
  );
}

export default DeskSlot;
