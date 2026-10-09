// What a persona says about itself in one phrase, and how far its run has got.
//
// RELOCATED 2026-10-06 from `fleetboard/Tile.tsx`, which drew the Board's
// absolutely-positioned tile and went with the Board view. These two
// derivations did not belong to that drawing: `useTileState` is the phrase
// Activity's persona line puts in its tooltip and its accessible name, and
// `runAgeFraction` is the width of the age bar along the foot of a working
// line (`PersonaLine`, `SessionLine`). Both are pure reads of the pile
// vocabulary beside them.

import { useTranslation } from '@/i18n/useTranslation';
import type { PersonaCardModel } from '../../monitorModel';
import { PILE_VISUAL, REASON_LABEL_KEY, needReason, pileKey } from './piles';

/** What a card says about itself in one phrase: the reason, or the pile. */
export function useTileState(card: PersonaCardModel): string {
  const { t } = useTranslation();
  const reason = needReason(card);
  return reason ? t.monitor[REASON_LABEL_KEY[reason]] : t.monitor[PILE_VISUAL[pileKey(card)].labelKey];
}

/**
 * How far a run has gone, 0-1, for a line with no room for "45 min": a log
 * scale that fills at four hours, so the first minutes move visibly and a
 * long run reads as long without every run past an hour looking the same.
 */
export function runAgeFraction(runningSince: number | null, minute: number): number {
  if (runningSince === null || minute <= 0) return 0;
  const minutes = Math.max(0, minute - runningSince / 60_000);
  return Math.min(1, Math.log1p(minutes) / Math.log1p(240));
}
