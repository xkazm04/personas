/**
 * Dev-only switch between the current Fleet Activity page and the two Gate K kit ports.
 * Labels are not translated on purpose: this control never ships (import.meta.env.DEV) and is
 * deleted with the rest of `prototype/` when the owner decides.
 */
import { PillGroup } from '@/features/shared/components/forms/PillGroup';
import { ACTIVITY_KITS, type ActivityKit } from './kitProto';

const LABEL: Record<ActivityKit, string> = { current: 'Current', ledger: 'A/1 Ledger', spine: 'A/3 Spine' };

export function KitSwitch({ value, onChange }: { value: ActivityKit; onChange: (k: ActivityKit) => void }) {
  if (!import.meta.env.DEV) return null;
  return (
    <PillGroup<ActivityKit>
      data-testid="kit-proto-switch"
      aria-label="Composition kit prototype"
      layoutId="kit-proto-switch"
      labelClass="typo-label"
      value={value}
      onChange={onChange}
      options={ACTIVITY_KITS.map((k) => ({ value: k, label: LABEL[k] }))}
    />
  );
}
