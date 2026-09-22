/**
 * Audio-reactive speaking bloom.
 *
 * While a spoken reply plays, the orb's glow tracks the live TTS level tapped
 * from the shared analyser. Deliberately IMPERATIVE: the level updates at frame
 * rate, and routing it through React state would re-render the orb (and every
 * decoration on it) sixty times a second to change two style properties. The
 * subscription mutates the node directly and the component never re-renders.
 *
 * Skipped entirely under reduced motion — there the glow is a static bloom.
 */

import { useEffect, useRef, type RefObject } from 'react';
import { subscribeAudioLevel } from '../audioLevel';

export function useOrbAudioGlow(
  speaking: boolean,
  reduceMotion: boolean,
): RefObject<HTMLSpanElement | null> {
  const glowRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (reduceMotion || !speaking) return;
    return subscribeAudioLevel((lvl) => {
      const el = glowRef.current;
      if (!el) return;
      el.style.opacity = String(0.22 + lvl * 0.65);
      el.style.transform = `scale(${1 + lvl * 0.55})`;
    });
  }, [reduceMotion, speaking]);
  return glowRef;
}
