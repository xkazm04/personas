/**
 * Platform detection utilities for mobile vs desktop differentiation.
 *
 * Build-time detection uses env vars set by build scripts (TAURI_ANDROID, TAURI_IOS).
 * In dev mode, you can toggle mobile preview via localStorage or the keyboard shortcut
 * Ctrl+Shift+M to test mobile layout without an Android device.
 */

// Build-time flag — true only when building for Android/iOS.
const BUILD_MOBILE: boolean =
  import.meta.env.VITE_PLATFORM === 'android' ||
  import.meta.env.VITE_PLATFORM === 'ios';

// ---------------------------------------------------------------------------
// Dev-mode mobile preview toggle (runtime override)
// ---------------------------------------------------------------------------

/** Read the dev override from localStorage. Only checked in dev mode. */
function readDevMobileOverride(): boolean {
  if (!import.meta.env.DEV) return false;
  try { return localStorage.getItem('dev-mobile-preview') === '1'; } catch { return false; }
}

/** Mutable runtime state — toggled by Ctrl+Shift+M in dev mode. */
let _devMobileOverride = readDevMobileOverride();

/** Listeners notified when the override changes. */
const _listeners = new Set<() => void>();

export function onMobilePreviewChange(fn: () => void) {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

export function toggleMobilePreview(): boolean {
  _devMobileOverride = !_devMobileOverride;
  try { localStorage.setItem('dev-mobile-preview', _devMobileOverride ? '1' : '0'); } catch { /* intentional no-op */ }
  _listeners.forEach((fn) => fn());
  return _devMobileOverride;
}

export function isMobilePreviewActive(): boolean {
  return _devMobileOverride;
}

// ---------------------------------------------------------------------------
// Public flags — used throughout the app via `import { IS_MOBILE } from '...'`
//
// In production builds these are compile-time constants (esbuild inlines them).
// In dev mode, the getter checks the runtime override so Ctrl+Shift+M works.
// ---------------------------------------------------------------------------

// For production: direct constants so esbuild can tree-shake.
// For dev: use Object.defineProperty with getter for reactivity.
// We use a simple approach: in dev, the module-level export is a let that
// gets updated when the toggle fires + we force a re-render.
// Components that need reactivity use the useMobilePreview() hook.

export let IS_MOBILE: boolean = BUILD_MOBILE || _devMobileOverride;
export let IS_DESKTOP: boolean = !IS_MOBILE;
export const IS_ANDROID: boolean = import.meta.env.VITE_PLATFORM === 'android';
export const IS_IOS: boolean = import.meta.env.VITE_PLATFORM === 'ios';

// When the toggle fires in dev mode, update the module-level exports.
if (import.meta.env.DEV) {
  onMobilePreviewChange(() => {
    IS_MOBILE = BUILD_MOBILE || _devMobileOverride;
    IS_DESKTOP = !IS_MOBILE;
  });
}

/** Sidebar sections available on mobile. */
export const MOBILE_SECTIONS = new Set<string>([
  'home',
  'overview',
  'personas',
  'design-reviews',
  'credentials',
]);
