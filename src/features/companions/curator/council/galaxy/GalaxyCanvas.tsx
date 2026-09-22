// The thin React host for the galaxy.
//
// It owns a ref, not a render loop: nothing inside the field is a component
// and no engine state ever becomes React state. The host's whole job is to
// hand the engine its data, its tokens and its captions, to relay the focus
// the engine derives into the store, and to give the canvas an accessible
// name plus a pointer at the docked list, which IS the non-pointer path.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

import { MOTION_PRESETS } from '@/lib/utils/animation/animationPresets';
import { useTranslation } from '@/i18n/useTranslation';

import { useCouncilStore } from '../councilStore';
import { GalaxyEngine } from './engine/GalaxyEngine';
import type { GalaxyFocus, GalaxyNode } from './engine/types';
import { buildCaptions, describeNode } from './galaxyCaptions';
import { useCanvasTheme } from './useCanvasTheme';

interface Props {
  /** The id of the element that carries the list alternative. */
  describedBy: string;
  onEngine: (engine: GalaxyEngine | null) => void;
}

export function GalaxyCanvas({ describedBy, onEngine }: Props) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<GalaxyEngine | null>(null);
  const emittedRef = useRef<GalaxyFocus | null>(null);
  const [pointer, setPointer] = useState<{ node: GalaxyNode; x: number; y: number; pinned: boolean } | null>(
    null,
  );

  const layout = useCouncilStore((s) => s.layout);
  const focus = useCouncilStore((s) => s.focus);
  const lensOn = useCouncilStore((s) => s.lensOn);
  const hover = useCouncilStore((s) => s.hover);
  const setFocus = useCouncilStore((s) => s.setFocus);
  const setCounts = useCouncilStore((s) => s.setCounts);
  const setHover = useCouncilStore((s) => s.setHover);

  const captions = useMemo(() => buildCaptions(t), [t]);

  // One engine per mount. StrictMode's double invoke tears the first one down
  // through `destroy()` before the second mounts, which is why every listener
  // and the ResizeObserver are removed there rather than left to GC.
  useEffect(() => {
    const engine = new GalaxyEngine(
      {
        onFocusChange: (next) => {
          emittedRef.current = next;
          setFocus(next);
        },
        onHoverChange: setHover,
        onCounts: setCounts,
        onPointerTarget: setPointer,
      },
      captions,
    );
    engineRef.current = engine;
    onEngine(engine);
    const canvas = canvasRef.current;
    if (canvas) engine.mount(canvas);
    return () => {
      engine.destroy();
      engineRef.current = null;
      onEngine(null);
    };
    // `captions` is pushed by its own effect below; re-creating the engine on a
    // language switch would restart the opening flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onEngine, setCounts, setFocus, setHover]);

  useEffect(() => {
    engineRef.current?.setCaptions(captions);
  }, [captions]);

  useCanvasTheme(useCallback((theme) => engineRef.current?.setTheme(theme), []));

  useEffect(() => {
    engineRef.current?.setData(layout);
  }, [layout]);

  useEffect(() => {
    engineRef.current?.setLens(lensOn);
  }, [lensOn]);

  useEffect(() => {
    engineRef.current?.setHover(hover);
  }, [hover]);

  // Store -> engine, but never an echo of what the engine just told the store,
  // and never a second flight to a focus the engine is already standing in.
  // The second guard is what lets the bench hand the focus back WITHOUT a
  // flight on its way down and then restore the exact camera: this effect
  // would otherwise fly to the focus's own altitude and undo it.
  useEffect(() => {
    if (emittedRef.current === focus) {
      emittedRef.current = null;
      return;
    }
    if (engineRef.current?.hasFocus(focus)) return;
    engineRef.current?.setFocus(focus);
  }, [focus]);

  const card = pointer ? describeNode(t, pointer.node) : null;

  return (
    <div className="absolute inset-0 overflow-hidden" data-testid="council-galaxy">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block h-full w-full touch-none"
        role="img"
        aria-label={t.council.galaxy.canvas_label}
        aria-describedby={describedBy}
        data-testid="council-galaxy-canvas"
      />
      {/* The card FADES rather than blinking. `snappy` (150 ms) because it
          follows a pointer, and anything slower lags behind the hand. */}
      <AnimatePresence>
      {card && pointer ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={MOTION_PRESETS.snappy.framer}
          className="pointer-events-none absolute z-20 max-w-[340px] rounded-card border border-primary/15 bg-secondary/95 px-3 py-2.5 shadow-elevation-3 backdrop-blur-sm"
          style={{ left: Math.min(pointer.x + 18, Math.max(0, (canvasRef.current?.clientWidth ?? 0) - 355)), top: Math.max(8, pointer.y - 14) }}
          data-testid="council-galaxy-hovercard"
        >
          <div className="typo-heading text-foreground">{card.title}</div>
          <div className="typo-caption text-muted">{card.detail}</div>
          {/* A pinned card is the END of the descent, and it says so rather
              than leaving the reader clicking at a technique that will never
              open. */}
          {pointer.pinned ? (
            <div className="mt-1.5 typo-caption text-accent" data-testid="council-galaxy-pinned">
              {t.council.galaxy.technique_deepest}
            </div>
          ) : null}
        </motion.div>
      ) : null}
      </AnimatePresence>
    </div>
  );
}

export default GalaxyCanvas;
