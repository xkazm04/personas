// The fused field's tokens: the classic reader (`../useCanvasTheme`) with
// the fused profile's claim palette (`engine/profile.ts`). Same two signals,
// same settle delay after the app's theme cross-fade.
import { useEffect } from 'react';

import { useThemeStore } from '@/stores/themeStore';

import { readCanvasTheme, type CanvasTheme } from '../engine/theme';

const THEME_SETTLE_MS = 300;

export function useFusedTheme(apply: (theme: CanvasTheme) => void): void {
  useEffect(() => {
    let timer = 0;
    const read = () => {
      apply(readCanvasTheme('fused'));
      window.clearTimeout(timer);
      timer = window.setTimeout(() => apply(readCanvasTheme('fused')), THEME_SETTLE_MS);
    };
    read();
    const unsubscribe = useThemeStore.subscribe(read);
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-brightness', 'data-contrast', 'data-density', 'class'],
    });
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
      unsubscribe();
    };
  }, [apply]);
}
