// dockVariant — which of the three Launch Rail shells the dispatch dock paints.
//
// A per-viewer preference, not a decision about the fleet: the operator's
// choice of composer layout belongs in localStorage, through the shared
// guarded door so a disabled or full storage never breaks the dock.
//
// Deliberately the same shape as `board/queue/boardVariant.ts` — a frozen
// tuple, one guard, an unknown stored value reading as the default — because
// the operator picks a winner later and the losers get deleted, and a second
// bespoke persistence shape would be one more thing to unpick when they do.
//
// The three differ ONLY in how they arrange the same blocks:
//   · rail    — the readout keeps its own manifest line ABOVE the toolbar.
//   · console — toolbar and readout share one dense line; the target path
//               drops to the chip rail. One row shorter than the others.
//   · ribbon  — the toolbar is the band on top and the readout becomes a
//               FOOTER under the command row: toolbar -> act -> confirm.
// Every one of them obeys the same four shape rules (one command row, a
// toolbar above it, shared `Button` throughout, no control splitting its icon
// and label across two lines) and the same anti-shake contract.

import { safeLocalGet, safeLocalSet } from '@/lib/safeLocalStorage';

export const DOCK_VARIANTS = ['rail', 'console', 'ribbon'] as const;
export type DockVariant = (typeof DOCK_VARIANTS)[number];

export const DOCK_VARIANT_KEY = 'monitor.dock.variant';
export const DEFAULT_DOCK_VARIANT: DockVariant = 'rail';

export function isDockVariant(v: unknown): v is DockVariant {
  return typeof v === 'string' && (DOCK_VARIANTS as readonly string[]).includes(v);
}

/** The persisted variant, or `rail` for a missing / unknown / unreadable value. */
export function readDockVariant(): DockVariant {
  const raw = safeLocalGet(DOCK_VARIANT_KEY, 'monitor/dockVariant read');
  return isDockVariant(raw) ? raw : DEFAULT_DOCK_VARIANT;
}

export function writeDockVariant(v: DockVariant): void {
  safeLocalSet(DOCK_VARIANT_KEY, v, 'monitor/dockVariant write');
}
