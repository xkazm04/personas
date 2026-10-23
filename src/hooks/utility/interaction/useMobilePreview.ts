import { useSyncExternalStore } from 'react';
import {
  isMobilePreviewActive,
  onMobilePreviewChange,
  IS_MOBILE as BUILD_IS_MOBILE,
  IS_ANDROID,
  IS_IOS,
} from '@/lib/utils/platform/platform';

// The phone-build flag, from the same VITE_PLATFORM env platform.ts reads. It
// used to read `globalThis.__VITE_PLATFORM_ANDROID__` / `__VITE_PLATFORM_IOS__`,
// globals nothing defines, so a dev Android/iOS build rendered the desktop
// layout here while `IS_MOBILE` said mobile.
const BUILD_MOBILE = IS_ANDROID || IS_IOS;

function subscribe(cb: () => void) {
  return onMobilePreviewChange(cb);
}

function getSnapshot(): boolean {
  if (!import.meta.env.DEV) return BUILD_IS_MOBILE;
  return BUILD_MOBILE || isMobilePreviewActive();
}

/**
 * Reactive hook that returns true when mobile should be shown.
 * In dev mode, responds to Ctrl+Shift+M toggle. In production, returns
 * the build-time constant.
 */
export function useMobilePreview(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
