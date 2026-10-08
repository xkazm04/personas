// A command run's outcome as a chip. The four outcomes read apart without
// colour (glyph + stroke): passed solid, failed solid in the error ink,
// timed out DOTTED, did not run DASHED and colourless - because a timeout or
// a run that never started is not a failure, and must not look like one.
import { CircleCheck, CircleSlash, OctagonX, TimerOff, type LucideIcon } from 'lucide-react';

import type { LifecycleRunOutcome } from '@/lib/bindings/LifecycleRunOutcome';

import { useLifecycleViewModel } from '../../context';

const LOOK: Record<LifecycleRunOutcome, { glyph: LucideIcon; cls: string }> = {
  passed: { glyph: CircleCheck, cls: 'border-solid border-status-success/60 bg-status-success/10 text-status-success' },
  failed: { glyph: OctagonX, cls: 'border-solid border-status-error/70 bg-status-error/10 text-status-error' },
  timeout: { glyph: TimerOff, cls: 'border-dotted border-status-warning/80 bg-transparent text-status-warning' },
  did_not_run: { glyph: CircleSlash, cls: 'border-dashed border-foreground/50 bg-transparent text-foreground' },
};

export function useRunOutcomeLabel() {
  const { dl } = useLifecycleViewModel();
  return (o: LifecycleRunOutcome): string => {
    switch (o) {
      case 'passed': return dl.lc2_run_passed;
      case 'failed': return dl.lc2_run_failed;
      case 'timeout': return dl.lc2_run_timeout;
      case 'did_not_run': return dl.lc2_run_did_not_run;
    }
  };
}

export function RunOutcomeChip({ outcome }: { outcome: LifecycleRunOutcome }) {
  const label = useRunOutcomeLabel();
  const { glyph: Glyph, cls } = LOOK[outcome];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-pill border-2 px-2.5 py-0.5 typo-label ${cls}`} data-outcome={outcome}>
      <Glyph className="h-4 w-4 shrink-0" aria-hidden />
      {label(outcome)}
    </span>
  );
}
