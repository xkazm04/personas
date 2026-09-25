/**
 * Gate K prototype: Fleet Activity composed from the A/3 "Spine & Lens" kit
 * (`src/features/shared/components/kit-proto/spine/`). Stub until the port lands.
 */
import type { ActivityKitProps } from './kitProto';

export default function ActivitySpine({ filtered }: ActivityKitProps) {
  return <div data-testid="kit-proto-spine" className="typo-body text-foreground">{filtered.length}</div>;
}
