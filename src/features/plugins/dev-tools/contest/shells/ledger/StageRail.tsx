// The seven-stage rail, drawn as one row of cells. Extractable: it takes a
// phase (plus what the detail knows) and nothing else.
//
// `compact` is the ledger-row form (cells only, the rail's meaning in its
// aria-label); the full form labels every cell and is the expanded row's
// header. `StageRailHeader` prints the stage names once above a column of
// compact rails, so a dense ledger names its columns instead of its cells.
import type { ContestChainStep } from '@/lib/bindings/ContestChainStep';
import type { ContestPhase } from '@/lib/bindings/ContestPhase';

import { LEDGER_COPY as C, fill } from './copy';
import { LEDGER_STAGES, stageRail, type StageActivity, type StageState } from './model/stageRail';

export interface StageRailProps {
  phase: ContestPhase;
  judgesEnabled?: boolean | null;
  chainStep?: ContestChainStep | null;
  compact?: boolean;
  className?: string;
}

/** Cell width of the compact rail; the header uses the same grid. */
export const RAIL_GRID = 'grid grid-cols-7 gap-0.5';

function cellClass(state: StageState, activity: StageActivity): string {
  switch (state) {
    case 'done':
      return 'bg-primary/45';
    case 'current':
      if (activity === 'attention') return 'bg-status-warning';
      if (activity === 'working') return 'bg-status-info';
      if (activity === 'queued') return 'bg-status-info/50';
      return 'bg-secondary border border-primary/40';
    case 'failed':
      return 'bg-status-error';
    case 'skipped':
      return 'border border-dashed border-primary/25';
    case 'passed':
      return 'bg-primary/20';
    case 'todo':
    default:
      return 'bg-secondary/50';
  }
}

export function StageRail({ phase, judgesEnabled = null, chainStep = null, compact = false, className = '' }: StageRailProps) {
  const rail = stageRail({ phase, judgesEnabled, chainStep });
  const atCell = rail.cells.find((c) => c.stage === rail.at);
  const label = fill(C.stageRailLabel, {
    stage: C.stages[rail.at],
    state: C.stageState[atCell?.state ?? 'current'],
  });

  if (compact) {
    return (
      <div role="img" aria-label={label} className={`${RAIL_GRID} ${className}`} data-testid="ledger-stage-rail">
        {rail.cells.map((c) => (
          <span
            key={c.stage}
            data-state={c.state}
            className={`h-2 rounded-interactive ${cellClass(c.state, rail.activity)}`}
          />
        ))}
      </div>
    );
  }

  return (
    <ol aria-label={label} className={`${RAIL_GRID} ${className}`} data-testid="ledger-stage-rail-full">
      {rail.cells.map((c) => (
        <li key={c.stage} className="min-w-0 space-y-1" data-state={c.state}>
          <span className={`block h-1.5 rounded-interactive ${cellClass(c.state, rail.activity)}`} aria-hidden />
          <span className={`block truncate typo-label ${c.stage === rail.at ? 'text-primary' : 'text-foreground'}`}>
            {C.stages[c.stage]}
          </span>
          <span className="block truncate typo-caption text-foreground">{C.stageState[c.state]}</span>
        </li>
      ))}
    </ol>
  );
}

/** The stage names once, above a column of compact rails. */
export function StageRailHeader({ className = '' }: { className?: string }) {
  return (
    <div className={`${RAIL_GRID} ${className}`} aria-hidden>
      {LEDGER_STAGES.map((s) => (
        <span key={s} className="truncate typo-label text-foreground">
          {C.stages[s].slice(0, 3)}
        </span>
      ))}
    </div>
  );
}
