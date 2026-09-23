/**
 * Halo · A — variant slot. Reuses the baseline right panel and decision stage
 * until its builder replaces one or both (contract: `../../slots.ts`).
 *
 * TODO(prototype, 2026-09-22): consolidate the Athena chat switcher.
 */

import { BaseDecisionStage, BaseRightPanel } from '../../slots/base';
import type { HaloSlots } from '../../slots';

export const HALO_A_SLOTS: HaloSlots = {
  id: 'a',
  label: 'Halo · A',
  RightPanel: BaseRightPanel,
  DecisionStage: BaseDecisionStage,
};
