/**
 * Gate K prototype: Fleet Activity composed from the A/1 "Ledger" kit
 * (`src/features/shared/components/kit-proto/ledger/`). Stub until the port lands.
 */
import type { ActivityKitProps } from './kitProto';

export default function ActivityLedger({ filtered }: ActivityKitProps) {
  return <div data-testid="kit-proto-ledger" className="typo-body text-foreground">{filtered.length}</div>;
}
