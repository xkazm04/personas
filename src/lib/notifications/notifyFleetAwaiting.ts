import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { silentCatch } from '@/lib/silentCatch';

/**
 * Fire an OS notification when a Fleet session transitions into
 * awaiting_input — the desktop-side "push alert when something needs a
 * human" that the mobile companion will eventually deliver remotely.
 *
 * Title + body are resolved by the caller (so they go through i18n). Best
 * effort: permission is requested lazily on first use and any failure is
 * swallowed — a missing notification must never break the session grid.
 */
export async function notifyFleetAwaiting(title: string, body: string): Promise<void> {
  try {
    let permitted = await isPermissionGranted();
    if (!permitted) {
      permitted = (await requestPermission()) === 'granted';
    }
    if (permitted) {
      sendNotification({ title, body });
    }
  } catch (err) {
    silentCatch('lib/notifications/notifyFleetAwaiting')(err);
  }
}
