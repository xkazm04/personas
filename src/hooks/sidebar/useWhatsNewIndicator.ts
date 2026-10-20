import { useCallback, useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { useSystemStore } from '@/stores/systemStore';
import { silentCatch } from '@/lib/silentCatch';

/**
 * "What's New" update indicator.
 *
 * Lights a dismissable dot on the Home (L1) and Roadmap (L2) sidebar entries
 * after the app updates to a version the user hasn't acknowledged yet — a
 * gentle nudge to open Home → What's New and see what shipped.
 *
 * Trigger: the running binary version (`getVersion()`) differs from the
 * persisted `whatsNewSeenVersion`. On a fresh install (`null`) we record the
 * current version as a silent baseline and show no dot — there's nothing
 * "new" relative to a prior version the user never ran. The dot only appears
 * after a genuine version change.
 *
 * Clearing: `dismiss()` (wired to the dot click) and viewing the What's New
 * page both re-acknowledge the running version, which persists across
 * relaunches so the dot doesn't reappear.
 *
 * The version lookup is cached module-side so the L1 and L2 call sites share a
 * single IPC round-trip. `whatsNewSeenVersion` is the reactive driver — when
 * any surface dismisses, every consumer re-renders and the dot disappears.
 */

// Shared across all hook consumers — one getVersion() IPC call per app launch.
let cachedVersionPromise: Promise<string> | null = null;
function loadAppVersion(): Promise<string> {
  if (!cachedVersionPromise) cachedVersionPromise = getVersion();
  return cachedVersionPromise;
}

export interface WhatsNewIndicator {
  /** True when the app updated to a version the user hasn't acknowledged. */
  hasUpdate: boolean;
  /** Acknowledge the running version — clears the dot everywhere. */
  dismiss: () => void;
}

export function useWhatsNewIndicator(): WhatsNewIndicator {
  // One visibility rule with the tab: the What's New (`roadmap`) Home tab is
  // `devOnly`, so a production dot would point nowhere. Shipping the releases
  // surface to production is the alternative; until then dot and tab agree.
  const enabled = import.meta.env.DEV;
  const seenVersion = useSystemStore((s) => s.whatsNewSeenVersion);
  const markWhatsNewSeen = useSystemStore((s) => s.markWhatsNewSeen);
  const [appVersion, setAppVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    loadAppVersion()
      .then((v) => { if (!cancelled) setAppVersion(v); })
      .catch(silentCatch('useWhatsNewIndicator:getVersion'));
    return () => { cancelled = true; };
  }, [enabled]);

  // First-ever launch: record a baseline silently so a future update — not
  // the install itself — is what lights the dot.
  useEffect(() => {
    if (enabled && appVersion && seenVersion === null) markWhatsNewSeen(appVersion);
  }, [enabled, appVersion, seenVersion, markWhatsNewSeen]);

  const hasUpdate =
    enabled && appVersion !== null && seenVersion !== null && seenVersion !== appVersion;

  const dismiss = useCallback(() => {
    if (appVersion) markWhatsNewSeen(appVersion);
  }, [appVersion, markWhatsNewSeen]);

  return { hasUpdate, dismiss };
}
