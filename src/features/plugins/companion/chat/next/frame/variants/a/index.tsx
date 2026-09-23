/**
 * Halo · Hand (round-3 variant A, the Hearthstone direction).
 *
 * Right panel: the tavern board (`TavernBoard`), one slim lane per project
 * with a crest, a mini deck of waiting card-backs and round process tokens;
 * Athena's lane is built from the same shapes. Decision stage: the hand
 * (`HandStage`), waiting items dealt as cards and played one round at a time.
 * Contract: `../../slots.ts`.
 *
 * TODO(prototype, 2026-09-22): consolidate the Athena chat switcher.
 */

import type { HaloSlots } from '../../slots';
import { HAND_COPY } from './copy';
import { HandStage } from './HandStage';
import { TavernBoard } from './TavernBoard';

export const HALO_A_SLOTS: HaloSlots = {
  id: 'a',
  label: HAND_COPY.label,
  RightPanel: TavernBoard,
  DecisionStage: HandStage,
};
