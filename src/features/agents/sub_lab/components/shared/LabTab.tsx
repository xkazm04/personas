import { useEffect } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { LabVersionsTable } from '../versions_table/LabVersionsTable';
import { LabEconomicsPanel } from '../versions_table/LabEconomicsPanel';

/**
 * Lab tab — the consolidated "Versions & Ratings" table. The former 7-mode
 * switcher (Arena / A-B / Improve / Breed / Evolve / Versions / Regression)
 * collapsed into one table: rows are (prompt version × model) pairs, the live
 * config is marked active, and per-row actions drive measurement (Arena),
 * activation, regression baselines, and improvement. Breed/Evolve moved to the
 * headless Athena companion surface.
 */
export function LabTab() {
  const personaId = useAgentStore((s) => s.selectedPersona?.id);
  const hydrateActiveProgress = useAgentStore((s) => s.hydrateActiveProgress);

  // A pending Athena `companion://open-lab` jump now just means "open Lab for
  // this persona" — there are no per-mode tabs left to target. Consume + clear.
  useEffect(() => {
    const sys = useSystemStore.getState();
    if (sys.companionLabJump) sys.setCompanionLabJump(null);
  }, [personaId]);

  // Restore any in-flight measurement progress after a page refresh.
  useEffect(() => {
    if (personaId) hydrateActiveProgress(personaId);
  }, [personaId, hydrateActiveProgress]);

  return (
    // data-testid doubles as the guided tour's spotlight anchor for the
    // "versions-table" sub-step (see tourSlice `lab-arena`).
    <div className="flex flex-col gap-4" data-testid="lab-versions-panel">
      <LabVersionsTable />
      {personaId && <LabEconomicsPanel personaId={personaId} />}
    </div>
  );
}
