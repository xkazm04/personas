/**
 * The Setup variant registry — the ONE place a prototype renderer is declared.
 *
 * Every id in `SetupVariantId` maps to a lazily-imported component so the
 * switcher only pays for the variant the user is actually looking at. The
 * shell renders the active entry inside a `Suspense` boundary with a calm
 * header-only ghost, never a spinner (loading pattern v2, law 1).
 *
 * All four renderers have landed. `ready` stays on the entry rather than
 * being deleted: it is how a variant is declared here BEFORE its file exists
 * (the switcher then marks it pending instead of pretending it is there),
 * which is how `orbit` and `canvas` were carried while they were being built.
 */

import type { ComponentType } from 'react';
import { lazyRetry } from '@/lib/lazyRetry';
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
  Component: ComponentType<SetupVariantProps>;
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
    Component: lazyRetry(() => import('./ConversationVariant')),
  },
  desk: {
    id: 'desk',
    Icon: PanelsTopLeft,
    labelKey: 'desk',
    ready: true,
    Component: lazyRetry(() => import('./DeskVariant')),
  },
  orbit: {
    id: 'orbit',
    Icon: Orbit,
    labelKey: 'orbit',
    ready: true,
    Component: lazyRetry(() => import('./OrbitVariant')),
  },
  canvas: {
    id: 'canvas',
    Icon: Shapes,
    labelKey: 'canvas',
    ready: true,
    Component: lazyRetry(() => import('./CanvasVariant')),
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
