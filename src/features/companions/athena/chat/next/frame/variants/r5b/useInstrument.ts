/**
 * The instrument's own plumbing: the layer's measured size (the spine and the
 * console size themselves from it) and the keys the layer adds on top of
 * `useLayer`'s Alt+W / Esc - Alt+T raises or folds the transcript, `/` puts
 * the caret in the composer from anywhere, Esc folds the transcript (an empty
 * composer gives its Esc up for that).
 *
 * TODO(prototype, 2026-10-07): athena chat round 5 - consolidate after the owner picks.
 */

import { useLayoutEffect, useState, type MutableRefObject, type RefObject } from 'react';
import { FULLSCREEN_LAYER_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { isTyping } from './useSurfaceKeys';

export function useLayerBox(ref: RefObject<HTMLElement | null>): { width: number; height: number } {
  const [box, setBox] = useState(() => ({ width: window.innerWidth, height: Math.max(320, window.innerHeight - 112) }));
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const next = { width: Math.round(r.width), height: Math.round(r.height) };
      setBox((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return box;
}

export function useInstrumentKeys({
  engaged,
  inputRoot,
  onToggleTranscript,
  onFold,
}: {
  engaged: boolean;
  inputRoot: MutableRefObject<HTMLDivElement | null>;
  onToggleTranscript: () => void;
  onFold: () => void;
}) {
  useAppKeyboard(
    (e) => {
      const el = document.activeElement;
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 't' || e.key === 'T')) {
        e.preventDefault();
        onToggleTranscript();
        return true;
      }
      if (e.key === '/' && !e.altKey && !e.ctrlKey && !e.metaKey && !isTyping(el)) {
        const field = inputRoot.current?.querySelector('textarea');
        if (!field) return false;
        e.preventDefault();
        field.focus();
        return true;
      }
      if (e.key === 'Escape' && engaged) {
        if (el && isTyping(el) && (el as HTMLTextAreaElement).value) return false;
        e.preventDefault();
        if (el instanceof HTMLElement && inputRoot.current?.contains(el)) el.blur();
        onFold();
        return true;
      }
      return false;
    },
    { priority: FULLSCREEN_LAYER_PRIORITY + 1 },
  );
}
