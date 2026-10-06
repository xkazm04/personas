// drawerVariant — which reading of a persona's dossier the Monitor drawer paints.
//
// A per-viewer preference, not a decision about the fleet: the operator's
// choice belongs in localStorage through the shared guarded door, so a
// disabled or full storage never breaks the drawer. Shaped exactly like
// `grid/board/queue/boardVariant.ts` — one `as const` list, one key, one
// guard, and an unknown value reads as the default rather than being mapped
// through a second list of retired names.
//
// THREE READINGS, NOT THREE PAINT JOBS:
//   console — the Annunciator instrument panel. Every domain is a plate on one
//             board, lamps and segment strips carry the counts, nothing is
//             hidden behind a tab. The reading is STATE AT A GLANCE.
//   queue   — one merged, severity-ordered worklist. Reviews, unread reports
//             and input-required processes interleave into a single ranked
//             list of what is waiting on the operator; everything that is not
//             waiting is demoted to a trailing strip. The reading is WHAT DO I
//             DO NEXT.
//   brief   — one continuous document, read top to bottom, reports rendered as
//             full markdown at document density. The reading is WHAT HAPPENED.
//
// This switcher is SCAFFOLD. The operator picks a winner and the losers are
// deleted with it, which is why its three labels borrow existing translated
// keys rather than minting new ones (see `drawerVariantLabels`).

import { safeLocalGet, safeLocalSet } from '@/lib/safeLocalStorage';

export const DRAWER_VARIANTS = ['console', 'queue', 'brief'] as const;
export type DrawerVariant = (typeof DRAWER_VARIANTS)[number];

export const DRAWER_VARIANT_KEY = 'monitor.drawer.variant';
export const DEFAULT_DRAWER_VARIANT: DrawerVariant = 'console';

export function isDrawerVariant(v: unknown): v is DrawerVariant {
  return typeof v === 'string' && (DRAWER_VARIANTS as readonly string[]).includes(v);
}

/** The persisted variant, or `console` for a missing / unknown / unreadable value. */
export function readDrawerVariant(): DrawerVariant {
  const raw = safeLocalGet(DRAWER_VARIANT_KEY, 'monitor/drawerVariant read');
  return isDrawerVariant(raw) ? raw : DEFAULT_DRAWER_VARIANT;
}

export function writeDrawerVariant(v: DrawerVariant): void {
  safeLocalSet(DRAWER_VARIANT_KEY, v, 'monitor/drawerVariant write');
}
