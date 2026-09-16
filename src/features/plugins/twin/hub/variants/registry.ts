/**
 * The four Hub prototypes, in switcher order. Each variant is a lazy chunk so
 * the switcher never pays for the three the user is not looking at.
 *
 * All four renderers have landed. The union, the storage key and this table
 * were written complete on day one and the two later files (`BrainMapVariant`,
 * `ContactsVariant`) dropped into the slots already reserved for them.
 */

import type { ComponentType } from 'react';
import { lazyRetry } from '@/lib/lazyRetry';
import { Inbox, Network, Users, Waves, type LucideIcon } from 'lucide-react';
import type { HubVariantId, HubVariantProps } from '../hubContract';

export interface HubVariantDef {
  id: HubVariantId;
  Icon: LucideIcon;
  /** i18n key under `twin.hub.variants`. Never a hand-typed label. */
  labelKey: HubVariantId;
  Component: ComponentType<HubVariantProps>;
}

export const HUB_VARIANTS: readonly HubVariantDef[] = [
  { id: 'desk', Icon: Inbox, labelKey: 'desk', Component: lazyRetry(() => import('./TriageDeskVariant')) },
  { id: 'river', Icon: Waves, labelKey: 'river', Component: lazyRetry(() => import('./RiverVariant')) },
  { id: 'map', Icon: Network, labelKey: 'map', Component: lazyRetry(() => import('./BrainMapVariant')) },
  { id: 'contacts', Icon: Users, labelKey: 'contacts', Component: lazyRetry(() => import('./ContactsVariant')) },
] as const;

export const DEFAULT_HUB_VARIANT: HubVariantId = 'desk';
export const HUB_VARIANT_STORAGE_KEY = 'twin-variant:hub';

export function isHubVariantId(value: string): value is HubVariantId {
  return HUB_VARIANTS.some((v) => v.id === value);
}
