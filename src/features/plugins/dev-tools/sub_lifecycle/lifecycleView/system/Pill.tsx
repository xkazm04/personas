// The module's ONE pill: every verdict, run outcome, change outcome and binding
// state is drawn by `Pill` from the tone map in `pillLooks.ts`. The wrappers
// below only pick the look and the label; none of them draws anything.
//
// `data-stroke` and `data-filled` carry the colourless half of the look, so a
// test (and a screen reader's styles) can tell a timeout from a failure without
// reading a colour.
import type { LifecycleBindingState } from '@/lib/bindings/LifecycleBindingState';
import type { LifecycleHealth } from '@/lib/bindings/LifecycleHealth';
import type { LifecycleOutcome } from '@/lib/bindings/LifecycleOutcome';
import type { LifecycleRunOutcome } from '@/lib/bindings/LifecycleRunOutcome';

import { bindingStateLabel, outcomeLabel } from '../../journey/journeyLabels';
import { useLifecycleViewModel } from '../context';
import { healthLabel } from '../layer1/layer1Labels';
import { LT } from './lcType';
import {
  BINDING_LOOK, OUTCOME_LOOK, PILL_STROKE, PILL_TONE, RUN_LOOK, VERDICT_LOOK, pillFilled, type PillLook,
} from './pillLooks';
import { GLYPH } from './scales';

export type PillSize = 'md' | 'lg';

const BOX: Record<PillSize, string> = {
  md: `gap-1.5 px-2.5 py-0.5 ${LT.label}`,
  lg: `gap-2 px-3 py-1 ${LT.title}`,
};

interface PillProps {
  look: PillLook;
  label: string;
  size?: PillSize;
  /** `data-*` attributes the caller's tests and styles key on (data-health, data-outcome...). */
  data?: Record<`data-${string}`, string>;
  testId?: string;
}

export function Pill({ look, label, size = 'md', data, testId }: PillProps) {
  const tone = PILL_TONE[look.tone];
  const filled = pillFilled(look.stroke);
  const Glyph = look.glyph;
  return (
    <span
      {...data}
      data-stroke={look.stroke}
      data-filled={filled ? 'true' : 'false'}
      data-testid={testId}
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-pill ${BOX[size]} ${PILL_STROKE[look.stroke]} ${tone.ink} ${tone.line} ${filled ? tone.wash : 'bg-transparent'}`}
    >
      <Glyph className={`${size === 'lg' ? GLYPH.md : GLYPH.sm} shrink-0`} aria-hidden />
      {label}
    </span>
  );
}

/** A step's measured verdict. */
export function VerdictPill({ health, size }: { health: LifecycleHealth; size?: PillSize }) {
  const { dl } = useLifecycleViewModel();
  return <Pill look={VERDICT_LOOK[health]} label={healthLabel(dl, health)} size={size} data={{ 'data-health': health }} />;
}

/** A command run's outcome. A timeout and a run that never started are not failures, and do not look like one. */
export function RunPill({ outcome }: { outcome: LifecycleRunOutcome }) {
  const { dl } = useLifecycleViewModel();
  const label = {
    passed: dl.lc2_run_passed,
    failed: dl.lc2_run_failed,
    timeout: dl.lc2_run_timeout,
    did_not_run: dl.lc2_run_did_not_run,
  }[outcome];
  return <Pill look={RUN_LOOK[outcome]} label={label} data={{ 'data-outcome': outcome }} />;
}

/** A change's outcome for one step. */
export function OutcomePill({ outcome }: { outcome: LifecycleOutcome }) {
  const { dl } = useLifecycleViewModel();
  return <Pill look={OUTCOME_LOOK[outcome]} label={outcomeLabel(dl, outcome)} data={{ 'data-outcome': outcome }} />;
}

/** A binding's state on the ladder. */
export function BindingPill({ state }: { state: LifecycleBindingState }) {
  const { dl } = useLifecycleViewModel();
  return <Pill look={BINDING_LOOK[state]} label={bindingStateLabel(dl, state)} data={{ 'data-state': state }} />;
}
