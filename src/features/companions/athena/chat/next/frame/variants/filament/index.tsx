/**
 * Filament — the right panel is a lit bezel line (contest B/1, owner's pick
 * 2026-10-03), slim by default, unrolling into a glass panel on click or
 * `Alt+T`; decisions play on the same line as a queue of beads instead of a
 * dealt card spread (contract: `../../slots.ts`).
 *
 * First in-app port, scoped to what the contest judged: the top piece's
 * surface (`FRAME_LOOKS.filament`), the right panel and the decision stage.
 * `AthenaToolbar` (left-docked in production, not part of this slot) is not
 * re-skinned yet — see this variant's files for the known gaps.
 *
 * TODO(prototype, 2026-10-03): consolidate the Athena chat switcher.
 */

import { FRAME_LOOKS } from '../../frameLook';
import type { HaloSlots } from '../../slots';
import { FILAMENT_COPY } from './copy';
import { FilamentPanel } from './FilamentPanel';
import { FilamentStage } from './FilamentStage';
import { FilamentTopView } from './FilamentTopView';

export const HALO_FILAMENT_SLOTS: HaloSlots = {
  id: 'a',
  label: FILAMENT_COPY.tab,
  look: FRAME_LOOKS.filament,
  Top: FilamentTopView,
  RightPanel: FilamentPanel,
  DecisionStage: FilamentStage,
};
