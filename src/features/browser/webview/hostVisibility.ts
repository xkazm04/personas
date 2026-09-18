/**
 * The ONE owner of the page host's visibility.
 *
 * The Browser webview is a separate OS window painted above the whole React
 * tree, so "is it on screen" cannot be left to a mounted component's effect
 * pair: two effects on `WebviewPage` used to write `setVisible(true)` on mount
 * and only one wrote `false` on unmount, and the writes are independent async
 * IPC calls with no ordering guarantee between them. Measured 2026-09-18: the
 * host stayed painted over other modules after leaving the page.
 *
 * Now the answer is DERIVED, not written: the host is shown exactly when the
 * app's route state says the Webview page is up (`sidebarSection === 'teams'
 * && teamsTab === 'webview'`) and nothing has asked it to step aside
 * (`suspendHost`, used by the address-bar suggestion popup, which the host
 * would otherwise cover). `BrowserHostVisibility` is mounted once at the app
 * root, subscribes to both, and issues one serialized `setVisible` per change,
 * so the last decision is always the one the host ends in.
 */
import { useEffect, useSyncExternalStore } from 'react';
import * as browserApi from '@/api/browser';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';

/** The route that owns the page slot. */
export const HOST_SECTION = 'teams';
export const HOST_TAB = 'webview';

export interface HostRouteState {
  sidebarSection: string;
  teamsTab: string;
  /** Number of callers asking the host to step aside (popups over the slot). */
  suspended: number;
}

/** Pure: the whole visibility rule in one place, testable without React. */
export function shouldShowHost(s: HostRouteState): boolean {
  return s.sidebarSection === HOST_SECTION && s.teamsTab === HOST_TAB && s.suspended <= 0;
}

// --- suspend/resume refcount (module store, HMR-safe by being a counter) ----
let suspendCount = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const subscribeSuspend = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const readSuspend = () => suspendCount;

/** Ask the host to step aside (a popup will overlap the slot). Pair with `resumeHost`. */
export function suspendHost(): void {
  suspendCount += 1;
  notify();
}
/** Release one `suspendHost`. Never goes below zero. */
export function resumeHost(): void {
  suspendCount = Math.max(0, suspendCount - 1);
  notify();
}
/** How many callers currently hold the host aside. */
export function hostSuspendCount(): number {
  return suspendCount;
}
/** Test seam. */
export function _resetHostSuspend(): void {
  suspendCount = 0;
  notify();
}

/**
 * Mounted once at the app root. Renders nothing; keeps the OS host window in
 * step with the route. The unmount branch hides it too, so an app teardown
 * never leaves a page window behind.
 */
export function BrowserHostVisibility(): null {
  const sidebarSection = useSystemStore((s) => s.sidebarSection);
  const teamsTab = useSystemStore((s) => s.teamsTab);
  const suspended = useSyncExternalStore(subscribeSuspend, readSuspend, readSuspend);
  const show = shouldShowHost({ sidebarSection, teamsTab, suspended });

  useEffect(() => {
    browserApi.setVisible(show).catch(silentCatch(show ? 'browser show host' : 'browser hide host'));
  }, [show]);

  useEffect(
    () => () => {
      browserApi.setVisible(false).catch(silentCatch('browser hide host'));
    },
    [],
  );

  return null;
}
