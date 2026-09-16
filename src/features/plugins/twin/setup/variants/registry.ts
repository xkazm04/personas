/**
 * The Setup variant registry — the ONE place a prototype renderer is declared.
 *
 * Every id in `SetupVariantId` maps to a lazily-imported component so the
 * switcher only pays for the variant the user is actually looking at. The
 * shell renders the active entry inside a `Suspense` boundary with a calm
 * header-only ghost, never a spinner (loading pattern v2, law 1).
 *
 * `orbit` and `canvas` are declared here ahead of their files existing: a
 * later work package adds `./OrbitVariant` and `./CanvasVariant` against the
 * same `SetupVariantProps`. Until then those two imports do not resolve and
 * the switcher marks them pending rather than pretending they are there.
 */

import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { MessagesSquare, Orbit, PanelsTopLeft, Shapes } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { SetupVariantId, SetupVariantProps } from '../setupContract';

export interface SetupVariantDef {
  id: SetupVariantId;
  Icon: LucideIcon;
  /** i18n key under `twin.setup.variants`. Never render the raw id. */
  labelKey: SetupVariantId;
  /** False while the renderer has not landed yet. */
  ready: boolean;
  Component: LazyExoticComponent<ComponentType<SetupVariantProps>>;
}

/** Render order of the pill strip. */
export const SETUP_VARIANT_ORDER: readonly SetupVariantId[] = [
  'conversation',
  'desk',
  'orbit',
  'canvas',
] as const;

export const DEFAULT_SETUP_VARIANT: SetupVariantId = 'conversation';

/** localStorage slot, per the prototype-switcher convention. */
export const SETUP_VARIANT_STORAGE_KEY = 'twin-variant:setup';

export const SETUP_VARIANTS: Record<SetupVariantId, SetupVariantDef> = {
  conversation: {
    id: 'conversation',
    Icon: MessagesSquare,
    labelKey: 'conversation',
    ready: true,
    Component: lazy(() => import('./ConversationVariant')),
  },
  desk: {
    id: 'desk',
    Icon: PanelsTopLeft,
    labelKey: 'desk',
    ready: true,
    Component: lazy(() => import('./DeskVariant')),
  },
  orbit: {
    id: 'orbit',
    Icon: Orbit,
    labelKey: 'orbit',
    ready: false,
    Component: lazy(() => import('./OrbitVariant')),
  },
  canvas: {
    id: 'canvas',
    Icon: Shapes,
    labelKey: 'canvas',
    ready: false,
    Component: lazy(() => import('./CanvasVariant')),
  },
};

/** Narrow an arbitrary stored string back to a known variant id. */
export function isSetupVariantId(value: string | null): value is SetupVariantId {
  return value !== null && Object.prototype.hasOwnProperty.call(SETUP_VARIANTS, value);
}

/** The entry to render, falling back to the default for an unknown id. */
export function setupVariantDef(id: SetupVariantId): SetupVariantDef {
  return SETUP_VARIANTS[id] ?? SETUP_VARIANTS[DEFAULT_SETUP_VARIANT];
}
