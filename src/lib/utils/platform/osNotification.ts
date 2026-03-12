/**
 * Lightweight OS notification helper using the standard Web Notification API.
 * Works in Tauri's WebView -- no plugin required.
 */

/** Request permission proactively (non-blocking). */
export function requestNotificationPermission(): void {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {
      /* intentional: non-critical -- permission denied is acceptable */
    });
  }
}

/** Send an OS notification. Requests permission on first call if needed. */
export async function sendOsNotification(title: string, body: string): Promise<void> {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    const result = await Notification.requestPermission();
    if (result !== 'granted') return;
  }
  if (Notification.permission !== 'granted') return;
  const notif = new Notification(title, { body });
  notif.onclick = () => {
    window.focus();
  };
}
