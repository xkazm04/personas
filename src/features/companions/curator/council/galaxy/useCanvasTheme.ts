// Hand the engine the app's live tokens, and re-read them when the theme flips.
//
// TWO sources, because the store is the usual writer but not the only thing
// that can be true. `themeStore.applyThemeToDOM` owns every appearance
// attribute in normal use (theme, brightness, density, contrast - brightness
// alone re-declares every status colour), so the store subscription is the
// primary signal. But the tokens live on `document.documentElement`, and
// ANYTHING that sets those attributes changes what the canvas should paint
// with: a harness, a dev tool, a future writer, a restore that runs before
// this component mounts. A canvas that is dark inside a white page is not a
// theme bug, it is a canvas that was never told - so the attributes
// themselves are observed too, and the observer is the backstop that makes
// "the engine is showing the wrong theme" unreachable rather than unlikely.
//
// The read is deferred past the 250 ms cross-fade `applyThemeToDOM` starts,
// or the canvas would capture the colours mid-transition.
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
