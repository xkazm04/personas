// Hand the engine the app's live tokens, and re-read them when the theme flips.
//
// Subscribed through the theme STORE rather than by watching `data-theme` on
// the root: the store is the one owner of every appearance attribute
// (`themeStore.applyThemeToDOM` writes theme, brightness, density and contrast
// from the same place), and brightness alone re-declares every status colour.
// The read is deferred past the 250 ms cross-fade `applyThemeToDOM` starts, or
// the canvas would capture the colours mid-transition.
import { useEffect } from 'react';

import { useThemeStore } from '@/stores/themeStore';

import { readCanvasTheme } from './engine/theme';
import type { CanvasTheme } from './engine/theme';

/** The cross-fade `applyThemeToDOM` starts, plus a frame. */
const THEME_SETTLE_MS = 300;

export function useCanvasTheme(apply: (theme: CanvasTheme) => void): void {
  useEffect(() => {
    let timer = 0;
    const read = () => {
      apply(readCanvasTheme());
      window.clearTimeout(timer);
      timer = window.setTimeout(() => apply(readCanvasTheme()), THEME_SETTLE_MS);
    };
    read();
    const unsubscribe = useThemeStore.subscribe(read);
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [apply]);
}
