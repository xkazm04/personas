import { useSyncExternalStore } from 'react';
import {
  isMobilePreviewActive,
  onMobilePreviewChange,
  IS_MOBILE as BUILD_IS_MOBILE,
} from '@/lib/utils/platform';

const BUILD_MOBILE =
  (globalThis as any).__VITE_PLATFORM_ANDROID__ ||
  (globalThis as any).__VITE_PLATFORM_IOS__ ||
  false;

function subscribe(cb: () => void) {
  return onMobilePreviewChange(cb);
}

function getSnapshot(): boolean {
  if (!import.meta.env.DEV) return BUILD_IS_MOBILE;
  return BUILD_MOBILE || isMobilePreviewActive();
}

/**
 * Reactive hook that returns true when mobile layout should be shown.
 * In dev mode, responds to Ctrl+Shift+M toggle. In production, returns
 * the build-time constant.
 */
export function useMobilePreview(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
