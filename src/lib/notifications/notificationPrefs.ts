/**
 * The one typed reader of the `notification_prefs` blob.
 *
 * Notification Settings writes five preferences into one JSON value. Before
 * this module the blob was parsed twice with two default semantics (the
 * Notifications tab spread unchecked values, the Limits tab narrowed one
 * field), and the four healing-severity toggles had no reader at all: the
 * healing toast hard-coded critical + high. Every reader now goes through
 * `parseNotificationPrefs`, and the event doors (the healing toast and the
 * spend watcher) read it where their events arrive, not inside a settings tab
 * that unmounts when the operator leaves it.
 *
 * Adding a category: add a boolean field and its default here, then read it
 * at the door where that event arrives.
 */

export const NOTIFICATION_PREFS_KEY = 'notification_prefs';

export interface NotificationPrefs {
  healing_critical: boolean;
  healing_high: boolean;
  healing_medium: boolean;
  healing_low: boolean;
  /**
   * The monthly spend ceiling's 80% / 100% crossings. Default ON: a ceiling the
   * operator set is a ceiling they want to hear about. Read by
   * `overview/components/feedback/SpendAlertWatcher.tsx`.
   */
  spend_alerts: boolean;
}

/**
 * The healing defaults reproduce the filter the toast hard-coded before it
 * read prefs (critical + high), so an install that never opened the tab sees
 * no change.
 */
export const DEFAULT_NOTIFICATION_PREFS: Readonly<NotificationPrefs> = Object.freeze({
  healing_critical: true,
  healing_high: true,
  healing_medium: false,
  healing_low: false,
  spend_alerts: true,
});

const FIELDS = Object.keys(DEFAULT_NOTIFICATION_PREFS) as (keyof NotificationPrefs)[];

/**
 * Parse the stored blob. Each field takes the stored value only when it is a
 * boolean; anything else (absent, a string, a number, a non-object blob,
 * unparseable JSON, `null`) falls back to that field's default. Never throws,
 * and never carries through a key that is not a declared preference.
 */
export function parseNotificationPrefs(raw: string | null | undefined): NotificationPrefs {
  let parsed: unknown = null;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      // intentional: an unparseable blob reads as the defaults
      parsed = null;
    }
  }
  const out: NotificationPrefs = { ...DEFAULT_NOTIFICATION_PREFS };
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return out;
  // Narrowed field by field below: the blob is whatever an earlier version of
  // the app (or a hand-edited store) left behind.
  const record = parsed as Record<string, unknown>;
  for (const field of FIELDS) {
    const v = record[field];
    if (typeof v === 'boolean') out[field] = v;
  }
  return out;
}

const SEVERITY_FIELD: Record<string, keyof NotificationPrefs> = {
  critical: 'healing_critical',
  high: 'healing_high',
  medium: 'healing_medium',
  low: 'healing_low',
};

/**
 * Whether a `healing-event` should raise a toast. Auto-fixed issues never do;
 * otherwise the operator's toggle for that severity decides. An unknown
 * severity has no toggle and does not toast (the old filter dropped it too).
 */
export function shouldToastHealing(
  prefs: NotificationPrefs,
  event: { severity: string; auto_fixed: boolean },
): boolean {
  if (event.auto_fixed) return false;
  const field = SEVERITY_FIELD[event.severity];
  return field ? prefs[field] : false;
}
