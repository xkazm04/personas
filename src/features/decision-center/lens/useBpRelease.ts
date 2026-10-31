/**
 * useBpRelease - the Release sheet's one door out: bp's Release tab, opened
 * in the system browser, and whether bp answers (spark one-control, WP3).
 *
 * Reachability is a cheap probe of bp's base URL. It can only be made where
 * the webview may connect to localhost: the dev CSP allows `http://localhost:*`,
 * the shipped CSP does not (and no IPC door probes a port), so a production
 * build answers `unknown` and keeps the open action, rather than calling a
 * running bp dead. A failed open is also "not running".
 */
import { useCallback, useEffect, useState } from 'react';

import { getAppSetting } from '@/api/system/settings';
import { openExternalUrl } from '@/api/system/system';
import { silentCatch } from '@/lib/silentCatch';

import { listBpProducts } from '@/api/bpLink';

import { BP_URL_SETTING, bpBaseUrl, bpReleaseUrl, bpSlug, bpSlugByRoot } from './bpLink';

export type BpReach = 'checking' | 'up' | 'down' | 'unknown';

const PROBE_TIMEOUT_MS = 1500;

/** One probe of bp's base URL; `canProbe` is false where the CSP would block it. */
export async function probeBp(
  base: string,
  canProbe: boolean = import.meta.env.DEV,
  fetcher: typeof fetch = fetch,
): Promise<Exclude<BpReach, 'checking'>> {
  if (!canProbe) return 'unknown';
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
  try {
    // An opaque answer is an answer: something listens there.
    await fetcher(base, { mode: 'no-cors', signal: ctl.signal, cache: 'no-store' });
    return 'up';
  } catch (err) {
    // A refused connection is the answer "bp is not running"; the log keeps the cause.
    silentCatch('decisionCenter.lensRelease:probe')(err);
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}

export interface BpRelease {
  /** The Release tab's URL, once the setting is read. */
  url: string | null;
  reach: BpReach;
  open: () => Promise<void>;
}

export function useBpRelease(root: string): BpRelease {
  const [url, setUrl] = useState<string | null>(null);
  const [reach, setReach] = useState<BpReach>('checking');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let setting: string | null = null;
      try {
        setting = await getAppSetting(BP_URL_SETTING);
      } catch (err) {
        // An unreadable setting is the default URL, said once in the log.
        silentCatch('decisionCenter.lensRelease:bpUrl')(err);
      }
      const base = bpBaseUrl(setting);
      // bp's own slug for this root (its product table, read from Rust); the folder name only when bp does not answer
      let slug: string | undefined;
      try {
        slug = bpSlugByRoot(await listBpProducts(), root);
      } catch (err) {
        silentCatch('decisionCenter.lensRelease:bpProducts')(err);
      }
      if (cancelled) return;
      setUrl(bpReleaseUrl(base, slug ?? bpSlug(root)));
      const r = await probeBp(base);
      if (!cancelled) setReach(r);
    })();
    return () => {
      cancelled = true;
    };
  }, [root]);

  const open = useCallback(async () => {
    if (!url) return;
    try {
      await openExternalUrl(url);
    } catch (err) {
      silentCatch('decisionCenter.lensRelease:open')(err);
      setReach('down');
    }
  }, [url]);

  return { url, reach, open };
}
