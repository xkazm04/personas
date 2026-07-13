/**
 * Appearance-preference mirror — durable backup of the webview-local theme state.
 *
 * # Why this exists
 *
 * Theme / density / text-scale / brightness / timezone / a11y toggles live in
 * `localStorage` under the `persona-theme` key (see {@link useThemeStore}). That
 * is the correct **render-path authority** — reading it is synchronous and needs
 * no IPC, so first paint is never blocked. But localStorage is *per-webview-
 * profile*: clearing the WebView2 profile (or a fresh profile on a new machine)
 * silently wipes every appearance choice. That is the exact loss mode that
 * dropped the Obsidian saved-vaults list until it was mirrored into
 * `app_settings` in 2026-06.
 *
 * This module applies the same **mirror pattern**: localStorage stays the
 * render authority (no IPC in the render path), and every change is *also*
 * written through to the backend `app_settings` store (debounced, fire-and-
 * forget). On a fresh/cleared profile we hydrate back from the backend, one
 * corrected repaint after mount (IPC can't be read before first paint cheaply,
 * so we accept the repaint rather than block startup — documented trade-off).
 *
 * The backend row is validated for shape + the stable scalar enums
 * (text-scale / brightness / density) in `settings_keys::validate_value`; the
 * volatile values (theme id, timezone, custom-theme JSON) are coerced here on
 * read, where the enums actually live, so a newly-added theme id never trips a
 * stale Rust validator.
 */

import { getAppSetting, setAppSetting } from '@/api/system/settings';
import { silentCatch } from '@/lib/silentCatch';
import { isDensity, DEFAULT_DENSITY, type Density } from '@/lib/density';
import {
  useThemeStore,
  THEMES,
  TEXT_SCALES,
  type ThemeId,
  type TextScale,
  type BrightnessLevel,
  type TimezoneMode,
  type CustomThemeConfig,
} from '@/stores/themeStore';

/**
 * `app_settings` key holding the mirrored appearance snapshot (JSON).
 * MUST match `settings_keys::APPEARANCE_PREFERENCES` on the Rust side.
 */
export const APPEARANCE_PREFERENCES_KEY = 'appearance_preferences';

/** The mirrored appearance shape. A superset never rendered directly — the
 *  store is the runtime source; this is durability only. */
export interface AppearancePrefs {
  themeId: ThemeId;
  textScale: TextScale;
  brightness: BrightnessLevel;
  density: Density;
  timezone: TimezoneMode;
  ambientTimeOfDay: boolean;
  dim: boolean;
  cvdSafe: boolean;
  highContrast: boolean;
  reduceMotion: boolean;
  customTheme: CustomThemeConfig | null;
}

const VALID_THEME_IDS = new Set<string>([...THEMES.map((t) => t.id), 'custom']);
const VALID_TEXT_SCALES = new Set<string>(TEXT_SCALES.map((s) => s.id));
const VALID_BRIGHTNESS = new Set<string>(['low', 'mid', 'high']);

/** Read the current appearance choices off the store into a plain snapshot. */
export function snapshotAppearance(): AppearancePrefs {
  const s = useThemeStore.getState();
  return {
    themeId: s.themeId,
    textScale: s.textScale,
    brightness: s.brightness,
    density: s.density,
    timezone: s.timezone,
    ambientTimeOfDay: s.ambientTimeOfDay,
    dim: s.dim,
    cvdSafe: s.cvdSafe,
    highContrast: s.highContrast,
    reduceMotion: s.reduceMotion,
    customTheme: s.customTheme,
  };
}

/**
 * Coerce an untrusted backend blob into a valid {@link AppearancePrefs}. Unknown
 * enum values fall back to the store's current value (safe default) rather than
 * throwing — a partial/older row still hydrates the fields it does carry.
 */
export function coerceAppearancePrefs(raw: unknown): AppearancePrefs {
  const cur = snapshotAppearance();
  if (typeof raw !== 'object' || raw === null) return cur;
  const r = raw as Record<string, unknown>;

  const themeId = typeof r.themeId === 'string' && VALID_THEME_IDS.has(r.themeId)
    ? (r.themeId as ThemeId)
    : cur.themeId;
  const textScale = typeof r.textScale === 'string' && VALID_TEXT_SCALES.has(r.textScale)
    ? (r.textScale as TextScale)
    : cur.textScale;
  const brightness = typeof r.brightness === 'string' && VALID_BRIGHTNESS.has(r.brightness)
    ? (r.brightness as BrightnessLevel)
    : cur.brightness;
  const density = isDensity(r.density) ? r.density : (cur.density ?? DEFAULT_DENSITY);
  const timezone = typeof r.timezone === 'string' && r.timezone.length > 0
    ? (r.timezone as TimezoneMode)
    : cur.timezone;
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  const customTheme = typeof r.customTheme === 'object' && r.customTheme !== null
    ? (r.customTheme as CustomThemeConfig)
    : null;

  return {
    themeId,
    textScale,
    brightness,
    density,
    timezone,
    ambientTimeOfDay: bool(r.ambientTimeOfDay, cur.ambientTimeOfDay),
    dim: bool(r.dim, cur.dim),
    cvdSafe: bool(r.cvdSafe, cur.cvdSafe),
    highContrast: bool(r.highContrast, cur.highContrast),
    reduceMotion: bool(r.reduceMotion, cur.reduceMotion),
    customTheme,
  };
}

/** Apply a coerced snapshot onto the live store via its setters (which re-apply
 *  the DOM attributes). Write-through is suppressed for the duration so the
 *  hydrate does not immediately echo back to the backend. */
export function applyAppearancePrefs(prefs: AppearancePrefs): void {
  const st = useThemeStore.getState();
  suppressWriteThrough = true;
  try {
    if (prefs.themeId === 'custom' && prefs.customTheme) {
      st.setCustomTheme(prefs.customTheme);
    } else {
      st.setTheme(prefs.themeId);
    }
    st.setTextScale(prefs.textScale);
    st.setBrightness(prefs.brightness);
    st.setDensity(prefs.density);
    st.setTimezone(prefs.timezone);
    st.setAmbientTimeOfDay(prefs.ambientTimeOfDay);
    st.setDim(prefs.dim);
    st.setCvdSafe(prefs.cvdSafe);
    st.setHighContrast(prefs.highContrast);
    st.setReduceMotion(prefs.reduceMotion);
  } finally {
    suppressWriteThrough = false;
  }
}

// --- Write-through (debounced, fire-and-forget) -----------------------------

let suppressWriteThrough = false;
let writeTimer: ReturnType<typeof setTimeout> | undefined;
/** Exposed for tests to force a flush. Debounce window is deliberately short —
 *  appearance changes are user-paced, not high-frequency. */
export const WRITE_THROUGH_DEBOUNCE_MS = 400;

function flushWriteThrough(): void {
  const snapshot = snapshotAppearance();
  void setAppSetting(APPEARANCE_PREFERENCES_KEY, JSON.stringify(snapshot)).catch(
    silentCatch('appearanceMirror:writeThrough'),
  );
}

/** Schedule a debounced backend write of the current appearance snapshot. */
export function scheduleWriteThrough(): void {
  if (suppressWriteThrough) return;
  clearTimeout(writeTimer);
  writeTimer = setTimeout(flushWriteThrough, WRITE_THROUGH_DEBOUNCE_MS);
}

// --- Boot: hydrate (fresh profile) or migrate (existing local) --------------

let bootstrapped = false;

/**
 * Wire the mirror once at startup.
 *
 * @param hadLocalAppearance whether `localStorage['persona-theme']` existed at
 *   boot (captured in main.tsx BEFORE the store can write it). When false, the
 *   webview profile is fresh/cleared → hydrate from the backend. When true →
 *   one-time migration push if the backend has no row yet.
 *
 * In both cases a store subscription is registered so every subsequent
 * appearance change writes through (debounced).
 */
export async function bootstrapAppearanceMirror(hadLocalAppearance: boolean): Promise<void> {
  if (bootstrapped) return;
  bootstrapped = true;

  // Subscribe first so nothing is missed while the async read is in flight.
  // Any store change (theme, density, timezone, a11y toggles) triggers a
  // debounced write-through. `subscribe` fires on every state transition, which
  // is why this captures timezone even though its setter emits no storeBus event.
  useThemeStore.subscribe(() => scheduleWriteThrough());

  try {
    const raw = await getAppSetting(APPEARANCE_PREFERENCES_KEY);
    if (!hadLocalAppearance) {
      // Fresh/cleared profile — restore from the backend if we have a row.
      if (raw) {
        applyAppearancePrefs(coerceAppearancePrefs(JSON.parse(raw)));
      }
      // No backend row either → first-ever run; the defaults already applied.
    } else if (!raw) {
      // Existing local prefs but no backend mirror yet — one-time migration.
      // Idempotent: a subsequent boot finds the row and skips this.
      flushWriteThrough();
    }
  } catch (err) {
    silentCatch('appearanceMirror:bootstrap')(err);
  }
}

/** Test-only reset of module state. */
export function __resetAppearanceMirrorForTests(): void {
  bootstrapped = false;
  suppressWriteThrough = false;
  clearTimeout(writeTimer);
  writeTimer = undefined;
}
