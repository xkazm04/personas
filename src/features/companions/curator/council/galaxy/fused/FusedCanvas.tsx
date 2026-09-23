// The field of the fused stage: the product's own engine in its `fused`
// style profile, hosted exactly the way `GalaxyCanvas` hosts the classic
// field - a ref and no render loop, the focus relayed through the council
// store - plus the one thing the fused HUD reads differently: a click on a
// technique pins it, and the pinned technique is the document's subject.
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import { useReducedMotion } from '@/lib/utils/animation/animationPresets';

import { useCouncilStore } from '../../councilStore';
import { GalaxyEngine } from '../engine/GalaxyEngine';
import type { GalaxyFocus } from '../engine/types';
import { buildCaptions } from '../galaxyCaptions';
import { useFusedStore } from './fusedStore';
import { useFusedTheme } from './useFusedTheme';

interface Props {
  describedBy: string;
  onEngine: (engine: GalaxyEngine | null) => void;
}

export function FusedCanvas({ describedBy, onEngine }: Props) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<GalaxyEngine | null>(null);
  const emittedRef = useRef<GalaxyFocus | null>(null);

  const layout = useCouncilStore((s) => s.layout);
  const focus = useCouncilStore((s) => s.focus);
  const setFocus = useCouncilStore((s) => s.setFocus);
  const setCounts = useCouncilStore((s) => s.setCounts);
  const setHover = useCouncilStore((s) => s.setHover);
  const lensOn = useFusedStore((s) => s.lensOn);
  const setTechnique = useFusedStore((s) => s.setTechnique);
  const setTip = useFusedStore((s) => s.setTip);
  const captions = useMemo(() => buildCaptions(t), [t]);
  const reduced = useReducedMotion();

  useEffect(() => {
    const engine = new GalaxyEngine(
      {
        onFocusChange: (next) => {
          emittedRef.current = next;
          setFocus(next);
        },
        onHoverChange: setHover,
        onCounts: setCounts,
        onPointerTarget: (target) => {
          // A pinned technique is the document, never a card over the field.
          const pinned = engineRef.current?.getPath().technique ?? null;
          setTechnique(pinned);
          setTip(target && !target.pinned ? { node: target.node, x: target.x, y: target.y } : null);
        },
      },
      captions,
    );
    engine.setProfile('fused');
    engineRef.current = engine;
    onEngine(engine);
    const canvas = canvasRef.current;
    if (canvas) engine.mount(canvas);
    return () => {
      engine.destroy();
      engineRef.current = null;
      onEngine(null);
    };
    // `captions` is pushed by its own effect; re-creating the engine on a
    // language switch would restart the opening flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onEngine, setCounts, setFocus, setHover, setTechnique, setTip]);

  useEffect(() => {
    engineRef.current?.setCaptions(captions);
  }, [captions]);

  useFusedTheme(useCallback((theme) => engineRef.current?.setTheme(theme), []));

  useEffect(() => {
    engineRef.current?.setData(layout);
  }, [layout]);

  useEffect(() => {
    engineRef.current?.setLens(lensOn);
  }, [lensOn]);

  useEffect(() => {
    engineRef.current?.setReducedMotion(Boolean(reduced));
  }, [reduced]);

  // Store -> engine, never an echo of what the engine just said, and never a
  // second flight to a focus the engine already stands in (`GalaxyCanvas`).
  useEffect(() => {
    if (emittedRef.current === focus) {
      emittedRef.current = null;
      return;
    }
    if (engineRef.current?.hasFocus(focus)) return;
    engineRef.current?.setFocus(focus);
  }, [focus]);

  return (
    <div className="fz-field">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block h-full w-full touch-none"
        role="img"
        aria-label={t.council.galaxy.canvas_label}
        aria-describedby={describedBy}
        data-role="hud-field"
        data-testid="council-fused-canvas"
      />
    </div>
  );
}

export default FusedCanvas;
