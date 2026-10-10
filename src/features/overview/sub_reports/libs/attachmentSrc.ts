import { convertFileSrc } from '@tauri-apps/api/core';
import { silentCatch } from '@/lib/silentCatch';

/**
 * A webview-loadable URL for a local attachment file, through Tauri's asset
 * protocol (`convertFileSrc`) - the same door the custom persona icons use
 * (`@/lib/icons/customIconStore`). The CSP already allows `asset:` /
 * `http://asset.localhost` for images; WHICH directories the protocol serves is
 * the `assetProtocol.scope` list in `tauri.conf.json`.
 *
 * Returns `null` outside the Tauri shell (browser dev, tests without the mock)
 * so the caller shows its quiet placeholder rather than a broken image.
 */
export function attachmentSrc(path: string): string | null {
  try {
    return convertFileSrc(path);
  } catch (err) {
    silentCatch('reportAttachments:convertFileSrc')(err);
    return null;
  }
}
