// The board-wide half of the feature chip's inputs.
//
// One referentially stable object computed once per board render, so adding
// the chip to `LedgerRow` costs the memoised row exactly one prop that never
// changes identity between renders (`contextMapPerf.tsx`'s mechanic 2).
import type { CouncilTarget } from './councilDispatch';

export interface FeatureChipContext {
  /** null when no project is active: the chip stays display-only. */
  project: CouncilTarget | null;
  /** contextId -> the group that owns it. The popover DERIVES each feature's
   *  group span from this rather than looking a precomputed count up by id:
   *  a derived span cannot silently become a confident zero when the lookup
   *  misses (census `absent-entity-count-as-zero`). */
  groupIdByContext: Map<string, string>;
  /** The project has features and NOT ONE of them is linked to a context. */
  featuresUnlinked: boolean;
  /** How many features the project has at all (the 'not scanned' copy uses it). */
  featureTotal: number;
}
