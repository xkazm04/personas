/**
 * The four blueprint renderers behind the Detail page's switcher (spark
 * twin-portable-blueprint). Each variant is its own chunk; the page shell and
 * the training overlay mount whichever one `useBlueprintVariant` names.
 * Paths: `variants/<id>/index.tsx`, and the drafting sheet's three theme
 * versions at `variants/drafting/themes/<theme>.tsx`; default export, props
 * `BlueprintVariantProps`.
 */
import type { ComponentType } from 'react';
import { lazyRetry } from '@/lib/lazyRetry';

import type { BlueprintVariantId, BlueprintVariantProps } from './blueprintContract';

export const BLUEPRINT_VARIANTS: Record<BlueprintVariantId, ComponentType<BlueprintVariantProps>> = {
  drafting: lazyRetry(() => import('./variants/drafting')),
  draftingTint: lazyRetry(() => import('./variants/drafting/themes/tint')),
  draftingSurface: lazyRetry(() => import('./variants/drafting/themes/surface')),
  draftingNative: lazyRetry(() => import('./variants/drafting/themes/native')),
  strata: lazyRetry(() => import('./variants/strata')),
};
