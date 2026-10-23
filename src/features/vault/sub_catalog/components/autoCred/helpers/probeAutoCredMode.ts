import { checkPlaywrightAvailable } from '@/api/vault/autoCredBrowser';
import { silentCatch } from '@/lib/silentCatch';
import type { AutoCredMode } from './types';

/**
 * Single-flight Playwright availability probe.
 *
 * `CatalogAutoSetup` and the `AutoCredPanel` it mounts both need the mode, and
 * both mounted in the same commit, so a cold open fired two
 * `check_auto_cred_playwright_available` calls at once. The backend's 300 s
 * cache is not single-flight, so each one spawned its own
 * `npx --yes @playwright/mcp@latest --help` (up to 15 s, a package download on
 * a cold npx cache). Concurrent callers now share one in-flight probe; once it
 * settles the next call goes back to the backend, whose cache answers it.
 */
let inflight: Promise<AutoCredMode> | null = null;

export function probeAutoCredMode(): Promise<AutoCredMode> {
  if (!inflight) {
    inflight = checkPlaywrightAvailable()
      .then((available): AutoCredMode => (available ? 'playwright' : 'guided'))
      .catch((err: unknown): AutoCredMode => {
        silentCatch('probeAutoCredMode:checkPlaywrightAvailable')(err);
        return 'guided';
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}
