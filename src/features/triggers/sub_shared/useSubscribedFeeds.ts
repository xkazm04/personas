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
    let catalog: SharedEventCatalogEntry[] | null = null;
    let slugs: Set<string> | null = null;
    const publish = () => {
      if (!alive || catalog === null || slugs === null) return;
      const subscribed = slugs;
      setFeeds(catalog.filter((e) => subscribed.has(e.slug)));
    };
    api
      .browseCatalog()
      .then((c) => {
        catalog = c;
        publish();
      })
      .catch((e) => {
        silentCatch('features/triggers/sub_shared/useSubscribedFeeds:catalog')(e);
        if (alive) setFeeds([]);
      });
    api
      .listSubscriptions()
      .then((subs) => {
        slugs = new Set(subs.map((s) => s.slug));
        publish();
      })
      .catch((e) => {
        silentCatch('features/triggers/sub_shared/useSubscribedFeeds:subs')(e);
        if (alive) {
          slugs = new Set();
          publish();
        }
      });
    return () => { alive = false; };
  }, []);

  return feeds;
}
