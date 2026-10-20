import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from '@/api/events/sharedEvents';
import type { SharedEventCatalogEntry } from '@/lib/bindings/SharedEventCatalogEntry';
import type { SharedEventSubscription } from '@/lib/bindings/SharedEventSubscription';
import type { SharedEventFeedActivity } from '@/lib/bindings/SharedEventFeedActivity';
import { silentCatch, toastCatch } from '@/lib/silentCatch';

/**
 * Shared data + mutation logic for the Marketplace, so the card baseline and the
 * table variants render from one source of truth (one load, consistent state).
 */
export function useSharedEvents() {
  const [catalog, setCatalog] = useState<SharedEventCatalogEntry[]>([]);
  const [subscriptions, setSubscriptions] = useState<SharedEventSubscription[]>([]);
  const [activity, setActivity] = useState<SharedEventFeedActivity[]>([]);
  const [loading, setLoading] = useState(true);

  // Stale-response guard: a refresh re-runs `load` while the mount load may
  // still be in flight; the slower response must not clobber the newer one.
  // Search and category filtering happen client-side in SharedEventsTab, so
  // the catalog is always read unfiltered (the hook's own server-side
  // search/category state had no caller and was removed).
  const loadSeqRef = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    // Catalog, watch-toggles, and last-change cells are independent lists.
    // Paint rows as soon as browseCatalog returns; merge subs/activity later.
    const catP = api
      .browseCatalog()
      .then((cat) => {
        if (seq !== loadSeqRef.current) return;
        setCatalog(cat);
        setLoading(false);
      });
    api
      .listSubscriptions()
      .then((subs) => {
        if (seq !== loadSeqRef.current) return;
        setSubscriptions(subs);
      })
      .catch(silentCatch('features/triggers/sub_shared/useSharedEvents:subs'));
    api
      .changeActivity()
      .then((act) => {
        if (seq !== loadSeqRef.current) return;
        setActivity(act);
      })
      .catch(silentCatch('features/triggers/sub_shared/useSharedEvents:activity'));
    try {
      await catP;
    } catch (err) {
      if (seq === loadSeqRef.current) {
        silentCatch('features/triggers/sub_shared/useSharedEvents:load')(err);
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    // `refreshCatalog` is filter-less and returns the full catalog — re-run
    // `load()` afterward so the active category/search filter is reapplied
    // instead of the unfiltered result silently overwriting it. Existing rows
    // stay on screen while the refresh round-trip is in flight (law 1).
    try {
      await api.refreshCatalog();
    } catch (err) {
      // Refresh, Watch and Unwatch are user presses: a failure is owed to the
      // user. They used to log only, so a failed toggle just snapped back.
      toastCatch('features/triggers/sub_shared/useSharedEvents:refresh')(err);
      return;
    }
    await load();
  }, [load]);

  const subscribe = useCallback(async (entryId: string) => {
    try {
      const sub = await api.subscribeFeed(entryId);
      setSubscriptions((prev) => [sub, ...prev]);
    } catch (e) {
      toastCatch('features/triggers/sub_shared/useSharedEvents:subscribe')(e);
    }
  }, []);

  const unsubscribe = useCallback(async (subId: string) => {
    try {
      await api.unsubscribeFeed(subId);
      setSubscriptions((prev) => prev.filter((s) => s.id !== subId));
    } catch (e) {
      toastCatch('features/triggers/sub_shared/useSharedEvents:unsubscribe')(e);
    }
  }, []);

  /** Subscription keyed by the catalog entry id it targets. */
  const subByEntryId = useMemo(() => {
    const m = new Map<string, SharedEventSubscription>();
    for (const s of subscriptions) m.set(s.catalogEntryId, s);
    return m;
  }, [subscriptions]);

  /** Change-activity rollup keyed by feed slug. */
  const activityBySlug = useMemo(() => {
    const m = new Map<string, SharedEventFeedActivity>();
    for (const a of activity) m.set(a.slug, a);
    return m;
  }, [activity]);

  const categories = useMemo(
    () => [...new Set(catalog.map((e) => e.category))].sort(),
    [catalog],
  );

  return {
    catalog,
    loading,
    categories,
    refresh,
    subscribe,
    unsubscribe,
    subByEntryId,
    activityBySlug,
  };
}
