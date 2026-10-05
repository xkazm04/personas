// DOSSIER - a decision band across the top, three peer columns under it.
//
// The thesis is the opposite of Ledger's. Ledger says the sections rank; Dossier
// says only ONE thing ranks - the decision waiting on you - and once that is
// settled the rest are genuinely peers that should be readable at a glance
// without scrolling past each other.
//
// So the band gets the title at `typo-title-lg`, the outcome it steers, and the
// acceptance gate or progress nudge, on a tinted surface that reads as chrome.
// Below it three equal columns, every heading at the same `lead` tier: no
// hierarchy, because there is none. The old column layout had to put activity
// 900px below tasks; here they are side by side at the same height.
import { useGoalDetailModel } from '../context';
import { AcceptanceGate, Description, Identity, Outcome, ProgressNudge, RefreshingLine } from '../blocks/leadBlocks';
import { Handoff, Subgoals, Tasks, UatGate } from '../blocks/workBlocks';
import { ActivityFeed, Dependencies, LinkedTeams } from '../blocks/contextBlocks';

export const DOSSIER_WIDTH = 'max-w-[78rem]';

export function DossierLayout() {
  const { goal } = useGoalDetailModel();
  if (!goal) return null;
  return (
    <div className="space-y-5">
      {/* THE BAND. Negative margins pull it out to the panel's own padding so it
          reads as a header rather than as the first card in a stack. */}
      <div className="-mx-6 -mt-6 px-6 pt-6 pb-4 bg-secondary/25 border-b border-primary/10 space-y-4">
        <Identity size="lg" />
        <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-4 items-start">
          <Description />
          <Outcome />
        </div>
        <AcceptanceGate />
        <ProgressNudge />
        <RefreshingLine />
      </div>

      {/* THREE PEERS. `xl` for the third break so two columns survive on a
          laptop; the tasks column leads because it is the widest content, not
          because it ranks. */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-6 gap-y-5 items-start">
        <div className="min-w-0 space-y-4">
          <Tasks tone="lead" />
          <Handoff />
        </div>
        <div className="min-w-0 space-y-4">
          <UatGate tone="lead" />
          <Subgoals tone="lead" />
          <Dependencies tone="lead" />
        </div>
        <div className="min-w-0 space-y-4">
          <LinkedTeams tone="lead" />
          <ActivityFeed tone="lead" />
        </div>
      </div>
    </div>
  );
}
