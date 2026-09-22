/**
 * Panel motion — the orb→chat morph and the width/compact transition.
 *
 * The panel is anchored bottom-left, so its bottom-left corner sits at screen
 * (16, vh − 48) regardless of height. Pinning `transformOrigin` to that corner
 * lets us fly + scale the panel out of the orb's recorded centre for an "orb
 * expands into chat" feel, and collapse back toward it on close.
 *
 * Width is animated by the motion value rather than a CSS `transition-[width]`
 * so it shares one easing curve with everything else the panel does, and so
 * the compact toggle reads as the panel *resizing* rather than snapping
 * between two layouts.
 */

import { useMemo } from 'react';
import { useReducedMotion, type Transition, type TargetAndTransition } from 'framer-motion';
import { useCompanionStore } from '../companionStore';
import { PANEL_BOTTOM_INSET_PX, panelWidthPx } from './athenaChatGeometry';

/** Shared easing — the app's standard "settle" curve. */
export const CHAT_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** Left inset of the panel (`left-4`), needed to aim the morph at the orb. */
const PANEL_LEFT_INSET_PX = 16;

/** How long the compact/expanded resize takes. */
const RESIZE_MS = 320;

export interface PanelMotion {
  initial: TargetAndTransition | boolean;
  animate: TargetAndTransition;
  exit: TargetAndTransition;
  transition: Transition;
  style?: React.CSSProperties;
  /** How long the open animation takes, in ms — the staged-mount gate. */
  settleMs: number;
}

export function usePanelMotion(compact: boolean): PanelMotion {
  const orbOpenOrigin = useCompanionStore((s) => s.orbOpenOrigin);
  const reduceMotion = useReducedMotion();
  const width = panelWidthPx(compact);

  return useMemo<PanelMotion>(() => {
    // Width still animates under reduced motion — a resize is a layout change,
    // not decoration, and snapping it is more jarring than easing it. Everything
    // vestibular (fly, scale) is what gets dropped.
    const widthTransition = {
      duration: reduceMotion ? 0 : RESIZE_MS / 1000,
      ease: CHAT_EASE,
    };

    if (reduceMotion) {
      return {
        initial: { opacity: 0, width },
        animate: { opacity: 1, width },
        exit: { opacity: 0 },
        transition: { duration: 0.12, width: widthTransition },
        settleMs: 120,
      };
    }

    if (orbOpenOrigin) {
      const dx = orbOpenOrigin.x - PANEL_LEFT_INSET_PX;
      const dy = orbOpenOrigin.y - (window.innerHeight - PANEL_BOTTOM_INSET_PX);
      return {
        initial: { opacity: 0, scale: 0.18, x: dx, y: dy, width },
        animate: { opacity: 1, scale: 1, x: 0, y: 0, width },
        exit: { opacity: 0, scale: 0.18, x: dx, y: dy },
        transition: { duration: 0.28, ease: CHAT_EASE, width: widthTransition },
        style: { transformOrigin: 'bottom left' },
        settleMs: 280,
      };
    }

    return {
      initial: { opacity: 0, y: 12, scale: 0.98, width },
      animate: { opacity: 1, y: 0, scale: 1, width },
      exit: { opacity: 0, y: 8, scale: 0.98 },
      transition: { duration: 0.18, ease: CHAT_EASE, width: widthTransition },
      settleMs: 180,
    };
  }, [orbOpenOrigin, reduceMotion, width]);
}
