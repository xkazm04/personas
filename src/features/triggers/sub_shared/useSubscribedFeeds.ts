import { useEffect, useState } from 'react';
import * as api from '@/api/events/sharedEvents';
import { silentCatch } from '@/lib/silentCatch';
import type { SharedEventCatalogEntry } from '@/lib/bindings/SharedEventCatalogEntry';

/**
 * The catalog entries the user is currently subscribed to in the Marketplace —
 * the source list for wiring subscribed feeds into personas in Chain Studio.
 * Loads once on mount (re-mounts on tab switch pick up new subscriptions).
 */
export function useSubscribedFeeds(): SharedEventCatalogEntry[] {
  const [feeds, setFeeds] = useState<SharedEventCatalogEntry[]>([]);

  useEffect(() => {
    let alive = true;
    Promise.all([api.listSubscriptions(), api.browseCatalog()])
      .then(([subs, catalog]) => {
        if (!alive) return;
        const subscribedSlugs = new Set(subs.map((s) => s.slug));
        setFeeds(catalog.filter((e) => subscribedSlugs.has(e.slug)));
      })
      .catch((e) => {
        silentCatch('features/triggers/sub_shared/useSubscribedFeeds')(e);
        if (alive) setFeeds([]);
      });
    return () => { alive = false; };
  }, []);

  return feeds;
}
