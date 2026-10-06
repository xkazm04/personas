/**
 * The prototype round's shortlist: one entry per CONCEPT, which on this surface
 * means a different container for the same material - not a different palette.
 * The round that varied a map of border and background utilities was thrown out
 * by the owner, and the mechanism went with it (see `LifecyclePage`).
 *
 * The default is `railBelow`, the arrangement the owner already kept, so nothing
 * changes for a user until he picks. The picker itself is dev-only and gated on
 * a named module constant in `LifecyclePage`, never an `import.meta.env.DEV`
 * test inside JSX.
 *
 * The prototypes are imported EAGERLY and therefore ship in the route
 * chunk even though only the default is reachable in production. That is a
 * deliberate, stated cost: a `lazy()` boundary per concept would buy ~15 KB back
 * and add a Suspense fallback to each, and these three exist to be reduced to
 * one. Delete the losers and the cost goes with them. If the round stalls and
 * they live here for weeks, fold them behind `lazy()`.
 *
 * The display names are dev chrome and are deliberately not i18n keys: the
 * control does not ship, and the locale files are contested by other sessions.
 */
import { Charter } from './charter/Charter';
import { Crosscheck } from './crosscheck/Crosscheck';
import { RailBelow } from './railBelow/RailBelow';

export interface LifecycleConcept {
  id: string;
  /** Dev-chrome label for the picker. */
  name: string;
  View: () => React.ReactElement;
}

export const CONCEPTS: readonly LifecycleConcept[] = [
  { id: 'railBelow', name: 'Rail Below', View: RailBelow },
  { id: 'crosscheck', name: 'Crosscheck', View: Crosscheck },
  { id: 'charter', name: 'Charter', View: Charter },
];

export const DEFAULT_CONCEPT_ID = 'railBelow';

export function conceptById(id: string): LifecycleConcept {
  return CONCEPTS.find((c) => c.id === id) ?? CONCEPTS[0]!;
}
