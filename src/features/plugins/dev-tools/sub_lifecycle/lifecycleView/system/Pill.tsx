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
import {
  BINDING_LOOK, ITEM_LOOK, OUTCOME_LOOK, RUN_LOOK, VERDICT_LOOK, itemStatusOf, pillFilled, type PillLook, type PillTone,
} from './pillLooks';
import { StateMark, type StateMarkState } from '@/features/shared/components/display/StateMark';

export type PillSize = 'md' | 'lg';

interface PillProps {
  look: PillLook;
  label: string;
  size?: PillSize;
  /** `data-*` attributes the caller's tests and styles key on (data-health, data-outcome...). */
  data?: Record<`data-${string}`, string>;
  testId?: string;
}

const STATE_OF: Record<PillTone, StateMarkState> = {
  success: 'success', warning: 'warning', error: 'error', info: 'info', neutral: 'neutral', quiet: 'neutral',
};

/** Console status: a glyph and a mono word (StateMark), never a filled pill. The stroke/filled attributes stay for tests. */
export function Pill({ look, label, size = 'md', data, testId }: PillProps) {
  const filled = pillFilled(look.stroke);
  const state: StateMarkState = look.tone === 'neutral' && look.stroke !== 'hairline' ? 'blank' : STATE_OF[look.tone];
  return (
    <span
      {...data}
      data-stroke={look.stroke}
      data-filled={filled ? 'true' : 'false'}
      data-testid={testId}
      className="inline-flex shrink-0 items-center whitespace-nowrap"
    >
      <StateMark state={state} label={label} size={size === 'lg' ? 'md' : 'sm'} />
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

type Dl = ReturnType<typeof useLifecycleViewModel>['dl'];

/** A backlog item's status in words; an unknown status is shown as it is stored. */
export function itemStatusLabel(dl: Dl, status: string): string {
  const known = itemStatusOf(status);
  return known === 'unknown' ? status : {
    pending: dl.lcx5_item_pending,
    accepted: dl.lcx5_item_accepted,
    delivered: dl.lcx5_item_delivered,
    rejected: dl.lcx5_item_rejected,
    archived: dl.lcx5_item_archived,
    expired: dl.lcx5_item_expired,
  }[known];
}

/** A backlog item's status (an unknown one on the dashed look). */
export function ItemPill({ status }: { status: string }) {
  const { dl } = useLifecycleViewModel();
  return <Pill look={ITEM_LOOK[itemStatusOf(status)]} label={itemStatusLabel(dl, status)} data={{ 'data-status': status }} />;
}
