import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import type { SharedEventCatalogEntry } from "@/lib/bindings/SharedEventCatalogEntry";
import type { SharedEventSubscription } from "@/lib/bindings/SharedEventSubscription";

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
