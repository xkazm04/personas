// React binding for the durable layout store. `useSyncExternalStore` keeps ONE
// copy of the panels — the store's — so a composition Athena writes out of band
// paints without a remount.
import { useSyncExternalStore } from 'react';

import { athenaPanelsSnapshot, subscribeLayout, type AthenaPanel } from './layoutStore';

export const useAthenaPanels = (): Readonly<Record<string, AthenaPanel>> =>
  useSyncExternalStore(subscribeLayout, athenaPanelsSnapshot);
