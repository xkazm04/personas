/**
 * The blueprint renderers behind the Detail page's switcher (spark
 * twin-portable-blueprint). Each variant is its own chunk; the page shell and
 * the training overlay mount whichever one `useBlueprintVariant` names.
 * Paths: `variants/<id>/index.tsx`; default export, props
 * `BlueprintVariantProps`.
 */
import type { ComponentType } from 'react';
import { lazyRetry } from '@/lib/lazyRetry';

import type { BlueprintVariantId, BlueprintVariantProps } from './blueprintContract';

export const BLUEPRINT_VARIANTS: Record<BlueprintVariantId, ComponentType<BlueprintVariantProps>> = {
  drafting: lazyRetry(() => import('./variants/drafting')),
  strata: lazyRetry(() => import('./variants/strata')),
};
