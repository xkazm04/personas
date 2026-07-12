import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import type { SharedEventCatalogEntry } from "@/lib/bindings/SharedEventCatalogEntry";
import type { SharedEventSubscription } from "@/lib/bindings/SharedEventSubscription";
import type { SharedEventChange } from "@/lib/bindings/SharedEventChange";
import type { SharedEventFeedActivity } from "@/lib/bindings/SharedEventFeedActivity";

export const browseCatalog = (category?: string, search?: string) =>
  invoke<SharedEventCatalogEntry[]>("shared_events_browse_catalog", { category, search });

export const refreshCatalog = () =>
  invoke<SharedEventCatalogEntry[]>("shared_events_refresh_catalog");

export const subscribeFeed = (catalogEntryId: string) =>
  invoke<SharedEventSubscription>("shared_events_subscribe", { catalogEntryId });

export const unsubscribeFeed = (subscriptionId: string) =>
  invoke<void>("shared_events_unsubscribe", { subscriptionId });

export const listSubscriptions = () =>
  invoke<SharedEventSubscription[]>("shared_events_list_subscriptions");

/** Change history (baked firings) for one feed, newest first — powers the event-history modal. */
export const listFirings = (slug: string, limit?: number) =>
  invoke<SharedEventChange[]>("shared_events_list_firings", { slug, limit });

/** Per-feed change-activity rollup (latest change + count per slug). */
export const changeActivity = () =>
  invoke<SharedEventFeedActivity[]>("shared_events_change_activity");
