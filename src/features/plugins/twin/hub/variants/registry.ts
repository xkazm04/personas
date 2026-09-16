/**
 * The four Hub prototypes, in switcher order. Each variant is a lazy chunk so
 * the switcher never pays for the three the user is not looking at.
 *
 * `BrainMapVariant` and `ContactsVariant` are PENDING — a later work package
 * adds those two files. The imports are deliberate placeholders so the
 * switcher, the storage key and the `HubVariantId` union are complete on day
 * one; until those files land, `tsc` reports exactly two unresolved modules
 * here and nothing else.
 */

import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { Inbox, Network, Users, Waves, type LucideIcon } from 'lucide-react';
import type { HubVariantId, HubVariantProps } from '../hubContract';

export interface HubVariantDef {
  id: HubVariantId;
  Icon: LucideIcon;
  /** i18n key under `twin.hub.variants`. Never a hand-typed label. */
  labelKey: HubVariantId;
  Component: LazyExoticComponent<ComponentType<HubVariantProps>>;
}

export const HUB_VARIANTS: readonly HubVariantDef[] = [
  { id: 'desk', Icon: Inbox, labelKey: 'desk', Component: lazy(() => import('./TriageDeskVariant')) },
  { id: 'river', Icon: Waves, labelKey: 'river', Component: lazy(() => import('./RiverVariant')) },
  { id: 'map', Icon: Network, labelKey: 'map', Component: lazy(() => import('./BrainMapVariant')) },
  { id: 'contacts', Icon: Users, labelKey: 'contacts', Component: lazy(() => import('./ContactsVariant')) },
] as const;

export const DEFAULT_HUB_VARIANT: HubVariantId = 'desk';
export const HUB_VARIANT_STORAGE_KEY = 'twin-variant:hub';

export function isHubVariantId(value: string): value is HubVariantId {
  return HUB_VARIANTS.some((v) => v.id === value);
}
