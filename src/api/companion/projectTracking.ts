import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import type { SubscriptionUpdate } from '@/lib/bindings/SubscriptionUpdate';
import type { SubscriptionWithProject } from '@/lib/bindings/SubscriptionWithProject';

/**
 * List all known projects with their tracking subscription state.
 * Disabled projects appear too — the editor needs to render them so
 * the user can flip the enable toggle.
 */
export const projectTrackingListSubscriptions = (): Promise<SubscriptionWithProject[]> =>
  invoke('project_tracking_list_subscriptions');

/**
 * Upsert one project's subscription. The engine scheduler picks up the
 * change on its next 1h tick (no signal needed — `list_enabled` re-reads
 * the table each tick).
 */
export const projectTrackingSetSubscription = (update: SubscriptionUpdate): Promise<void> =>
  invoke('project_tracking_set_subscription', { update });

/**
 * Master enable for the entire project_tracking subsystem. Wired to
 * the "Track development activity" toggle in Companion's plugin setup.
 */
export const projectTrackingSetMasterEnabled = (enabled: boolean): Promise<void> =>
  invoke('project_tracking_set_master_enabled', { enabled });

/**
 * Read the master enable flag. Used by Companion's plugin setup to
 * hydrate the toggle UI on mount.
 */
export const projectTrackingIsMasterEnabled = (): Promise<boolean> =>
  invoke('project_tracking_is_master_enabled');

/**
 * Fire one tick out-of-cadence — used as the "first-run backfill" path
 * when the user flips the master toggle ON. Per the locked design:
 * consume the last 24h of git/ledger activity and produce one immediate
 * pulse instead of waiting an hour.
 */
export const projectTrackingRunNow = (): Promise<void> =>
  invoke('project_tracking_run_now');
