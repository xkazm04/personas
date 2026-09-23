/**
 * Halo · Rows (Gwent direction) — variant slot (contract: `../../slots.ts`).
 *
 * Right panel: every project is a compact battlefield row (Athena's first,
 * with her portrait as its emblem), processes as unit tokens, what waits on
 * the operator as one leader card with a count. Decision stage: a Gwent round,
 * cards dealt from both sides, raised one at a time, thrown back when played.
 *
 * TODO(prototype, 2026-09-22): consolidate the Athena chat switcher.
 */

import type { HaloSlots } from '../../slots';
import { ROWS_COPY } from './copy';
import { RoundStage } from './RoundStage';
import { RowsPanel } from './RowsPanel';

export const HALO_B_SLOTS: HaloSlots = {
  id: 'b',
  label: ROWS_COPY.tabLabel,
  RightPanel: RowsPanel,
  DecisionStage: RoundStage,
};
