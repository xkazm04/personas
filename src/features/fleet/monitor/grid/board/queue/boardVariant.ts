// boardVariant — which of the three layouts the Activity board paints.
//
// A per-viewer preference, not a decision about the fleet: the operator's
// choice of layout belongs in localStorage (client-state-persistence golden
// path — "who is the authority" is this browser profile), through the shared
// guarded door so a disabled or full storage never breaks the board.
//
// Two layouts were retired (`ranked`, `horizon`): a stored value naming one
// of them is unknown now and reads as `classic`, the same as any other stray
// string — `isBoardVariant` is the only decision, so there is no second list
// of "old" names to keep in step.

import { safeLocalGet, safeLocalSet } from '@/lib/safeLocalStorage';

export const BOARD_VARIANTS = ['classic', 'runway', 'lanes'] as const;
export type BoardVariant = (typeof BOARD_VARIANTS)[number];

export const BOARD_VARIANT_KEY = 'monitor.board.variant';
export const DEFAULT_BOARD_VARIANT: BoardVariant = 'classic';

export function isBoardVariant(v: unknown): v is BoardVariant {
  return typeof v === 'string' && (BOARD_VARIANTS as readonly string[]).includes(v);
}

/** The persisted variant, or `classic` for a missing / unknown / unreadable value. */
export function readBoardVariant(): BoardVariant {
  const raw = safeLocalGet(BOARD_VARIANT_KEY, 'monitor/boardVariant read');
  return isBoardVariant(raw) ? raw : DEFAULT_BOARD_VARIANT;
}

export function writeBoardVariant(v: BoardVariant): void {
  safeLocalSet(BOARD_VARIANT_KEY, v, 'monitor/boardVariant write');
}
