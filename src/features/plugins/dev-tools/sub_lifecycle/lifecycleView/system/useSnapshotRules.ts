// The judging rules of the snapshot on screen. Layer 2 only renders over a
// snapshot (its steps come from one), so a missing snapshot here is a wiring
// mistake and throws, rather than drawing against invented defaults.
import type { LifecycleRulesView } from '@/lib/bindings/LifecycleRulesView';

import { useLifecycleViewModel } from '../context';

export function useSnapshotRules(): LifecycleRulesView {
  const { snapshot } = useLifecycleViewModel();
  if (!snapshot) throw new Error('useSnapshotRules: Layer 2 rendered without a snapshot');
  return snapshot.rules;
}
