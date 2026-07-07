import { useCallback, useEffect, useMemo, useState } from 'react';
import * as api from '@/api/events/sharedEvents';
import type { SharedEventCatalogEntry } from '@/lib/bindings/SharedEventCatalogEntry';
import type { SharedEventSubscription } from '@/lib/bindings/SharedEventSubscription';
import type { SharedEventFeedActivity } from '@/lib/bindings/SharedEventFeedActivity';
import { useDebounce } from '@/hooks/utility/timing/useDebounce';
import { silentCatch } from '@/lib/silentCatch';
import { createLogger } from '@/lib/log';

const logger = createLogger('shared-events');

/**
 * Shared data + mutation logic for the Marketplace, so the card baseline and the
 * table variants render from one source of truth (one load, consistent state).
 */
export function useSharedEvents() {
  const [catalog, setCatalog] = useState<SharedEventCatalogEntry[]>([]);
  const [subscriptions, setSubscriptions] = useState<SharedEventSubscription[]>([]);
  const [activity, setActivity] = useState<SharedEventFeedActivity[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const debouncedSearch = useDebounce(search, 300);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cat, subs, act] = await Promise.all([
        api.browseCatalog(category || undefined, debouncedSearch || undefined),
        api.listSubscriptions(),
        api.changeActivity(),
      ]);
      setCatalog(cat);
      setSubscriptions(subs);
      setActivity(act);
    } catch (err) {
      silentCatch('features/triggers/sub_shared/useSharedEvents:load')(err);
    } finally {
      setLoading(false);
    }
  }, [category, debouncedSearch]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const entries = await api.refreshCatalog();
      setCatalog(entries);
      const [subs, act] = await Promise.all([api.listSubscriptions(), api.changeActivity()]);
      setSubscriptions(subs);
      setActivity(act);
    } catch (err) {
      silentCatch('features/triggers/sub_shared/useSharedEvents:refresh')(err);
    } finally {
      setLoading(false);
    }
  }, []);

  const subscribe = useCallback(async (entryId: string) => {
    try {
      const sub = await api.subscribeFeed(entryId);
      setSubscriptions((prev) => [sub, ...prev]);
    } catch (e) {
      logger.error('Subscribe failed', { entryId, error: String(e) });
    }
  }, []);

  const unsubscribe = useCallback(async (subId: string) => {
    try {
      await api.unsubscribeFeed(subId);
      setSubscriptions((prev) => prev.filter((s) => s.id !== subId));
    } catch (e) {
      logger.error('Unsubscribe failed', { subId, error: String(e) });
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
    subscriptions,
    loading,
    search,
    setSearch,
    category,
    setCategory,
    categories,
    refresh,
    subscribe,
    unsubscribe,
    subByEntryId,
    activityBySlug,
  };
}

export type UseSharedEvents = ReturnType<typeof useSharedEvents>;
