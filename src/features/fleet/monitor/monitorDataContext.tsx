// monitorDataContext — ONE monitor data engine per overlay.
//
// ## The defect this exists to remove
//
// Opening Activity mounted `useMonitorData` TWICE. The shell mounts one in
// badge mode (`PersonaMonitor.tsx`). A second, row-mode instance with a
// 100-review limit arrived down a chain nobody reads end to end:
//
//   useRailSurface -> useRailFeeds.useReviewFeed -> useUnifiedTriage
//                  -> usePendingInteractions -> useMonitorData(DECK_FEEDS)
//
// `useReviewFeed(active, filter)` takes an `active` flag and never passes it
// down, so the second engine ran — with its own review poll and its own cloud
// poll — whenever the Activity surface was mounted, regardless of whether the
// decision rail was open or even on the reviews tab. `usePendingInteractions`
// says in its own header: "Mount only when the popover is open —
// useMonitorData polls reviews." The rail is not the popover.
//
// Gating that flag would have quieted it. Two engines would still exist, and
// the next hook to reach for the triage queue would wake the second one again.
// So the engine moves UP: the overlay mounts exactly one and shares it here.
//
// ## Why the fallback is not a convenience
//
// `usePendingInteractions` has a second caller that is NOT inside the monitor
// — the Quick Answer popover (`QuickAnswerBody`), a different overlay that
// mounts on its own. It has no provider and must keep its own instance.
//
// That makes [`useSharedMonitorData`] return `null` outside a provider rather
// than throw, and it is the single most dangerous line in this module: it is
// exactly how the duplicate comes back. A consumer that forgets the provider
// does not crash, it silently gets a second engine, which is the bug this file
// was written to delete. The behaviour is therefore pinned by a test named for
// it, not merely documented here.

import { createContext, useContext, type ReactNode } from 'react';

import type { MonitorData } from './useMonitorData';

/**
 * The overlay's single engine, or `null` when there is no provider above.
 *
 * `null` rather than `undefined` so "no provider" is a value a caller has to
 * handle, not an absence it can forget to check.
 */
export const MonitorDataContext = createContext<MonitorData | null>(null);

/**
 * The shared engine, or `null` when this component is not inside the monitor.
 *
 * A caller that can run in both places takes the shared one when it exists and
 * mounts its own only when it does not:
 *
 * ```ts
 * const shared = useSharedMonitorData();
 * const own = useMonitorData(shared ? OFF_FEEDS : DECK_FEEDS);
 * const data = shared ?? own;
 * ```
 *
 * Hooks cannot be called conditionally, so the second instance is always
 * MOUNTED; `OFF_FEEDS` is what makes it cost nothing. Passing the live feeds
 * there would restore the exact duplicate this module removes.
 */
export function useSharedMonitorData(): MonitorData | null {
  return useContext(MonitorDataContext);
}

/**
 * Publish the overlay's one engine to everything under it.
 *
 * **It takes the engine, it does not start one.** That is the whole point: the
 * single instance already lives in the overlay shell, which needs the same
 * object for its own model memo, and a provider that mounted its OWN
 * `useMonitorData` would be the second engine wearing the name of the fix. So
 * the shell hands down what it already has, and this component is nothing but
 * the context write — deliberately so, because the moment it grows a hook it
 * stops being provably single.
 *
 * A thin wrapper rather than `<MonitorDataContext.Provider>` written out at the
 * call site, because the context has to be exported for the consumer hook
 * anyway and an exported raw Provider is an invitation to hand it a freshly
 * built object. This one's prop is typed as the engine itself.
 */
export function MonitorDataProvider({
  data,
  children,
}: {
  /** The overlay's single `useMonitorData` result. */
  data: MonitorData;
  children: ReactNode;
}) {
  return <MonitorDataContext.Provider value={data}>{children}</MonitorDataContext.Provider>;
}
