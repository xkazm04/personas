/**
 * useSnoozeMap — React-side subscription to the snooze localStorage store.
 *
 * Returns the current snooze map and rerenders when entries are added or
 * removed. Prunes expired entries on first read so the lanes don't carry
 * stale snooze ghosts.
 */
import { useSyncExternalStore, useEffect } from 'react';
import {
  getSnoozeMap,
  pruneExpired,
  subscribeSnooze,
  type SnoozeMap,
} from '../libs/snoozeStore';

export function useSnoozeMap(): SnoozeMap {
  useEffect(() => {
    pruneExpired();
  }, []);
  return useSyncExternalStore(
    subscribeSnooze,
    getSnoozeMap,
    () => ({}),
  );
}
