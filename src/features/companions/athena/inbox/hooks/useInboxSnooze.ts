/**
 * useInboxSnooze — React binding for the inbox snooze registry (`../snooze`).
 *
 * `useSyncExternalStore` over a module store whose snapshot reference changes
 * only on commit, so a surface re-renders when an item is deferred/dismissed
 * and again when a defer expires (the registry arms its own timer), and never
 * in between.
 */
import { useSyncExternalStore } from 'react';

import { getSnoozeSnapshot, subscribeInboxSnooze, type SnoozeMap } from '../snooze';

export function useInboxSnooze(): SnoozeMap {
  return useSyncExternalStore(subscribeInboxSnooze, getSnoozeSnapshot, getSnoozeSnapshot);
}
