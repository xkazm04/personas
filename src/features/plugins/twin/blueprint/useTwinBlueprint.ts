/**
 * The Twin blueprint model, read-only (spark twin-portable-blueprint).
 *
 * Builds `TwinBlueprintModel` from the store slices the app already holds
 * (profile, tones, channels, approved memories), the setup session snapshot
 * (`setupGet` - a pure read, NEVER `setupOpen`, which can start a paid plan)
 * or the live one the training overlay passes in, and a few counts. Viewing
 * the Detail page must never start LLM work.
 *
 * CONTRACT STUB (WP0): the body lands in WP6. Signature frozen.
 */
import type { SetupSessionSnapshot } from '@/lib/bindings/SetupSessionSnapshot';

import type { TwinBlueprintModel } from './blueprintContract';

export interface UseTwinBlueprintOptions {
  /** The live session snapshot when the caller already holds one (the training overlay); otherwise the hook reads `setupGet`. */
  snapshot?: SetupSessionSnapshot | null;
  /** Bump to refetch the counts (e.g. after an answer or a `twin-sample-updated` event). */
  refreshKey?: number;
}

export interface UseTwinBlueprintResult {
  /** `null` until the first read settles, or when there is no twin. */
  model: TwinBlueprintModel | null;
  loading: boolean;
}

export function useTwinBlueprint(twinId: string | null, options: UseTwinBlueprintOptions = {}): UseTwinBlueprintResult {
  void twinId;
  void options;
  return { model: null, loading: true };
}
