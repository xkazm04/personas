/**
 * Blueprint variant "radial" (spark twin-portable-blueprint, WP10): RADIAL
 * ANATOMY. The twin's initial sits at the centre, ringed by readiness; the
 * four sections are quadrants of a coverage ring whose arcs fill to
 * `sectionCoverage` (hatched and dashed while nothing is measured), and the
 * band outside each quadrant draws its sub-quantities: Voice channels as
 * spokes with a style star at the tip, Training topics as six cells with the
 * awaiting share hatched, Knowledge as an approved / awaiting / rejected
 * tri-arc with fact ticks, Identity as the bio arc and language marks.
 *
 * - detail L1: the full anatomy, a full-size label in each corner.
 * - detail L2 (`focus`): the figure zooms into the chosen quadrant, which
 *   unfolds into its own detailed sub-ring with a legend; Back returns.
 * - stage: the anatomy in the rail left of the question card at lower
 *   contrast; the answered quadrant lights, the delta plays on it, the words
 *   sit under it; `working` orbits a slow tick around the ring.
 *
 * Motion: the zoom is a CSS transform transition, loops are CSS, one-shots are
 * framer; `reduced` fades only and drops every loop (`data-motion="reduced"`).
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { useTranslation } from '@/i18n/useTranslation';

import type { BlueprintVariantProps, SectionId } from '../../blueprintContract';
import { sectionCoverage } from '../../sectionMetrics';
import { radialIds } from './glyphs/primitives';
import { RadialFocus } from './RadialFocus';
import { RadialOverview } from './RadialOverview';
import { RadialStage } from './RadialStage';
import { useCanvasSize } from './useCanvasSize';
import './radial.css';
import './radial-panels.css';

/** The canvas before it is measured (and in jsdom): a 1280x800 window's content region. */
const FALLBACK = { w: 950, h: 750 };

export default function RadialBlueprint(props: BlueprintVariantProps) {
  const { model, mode, focus, onFocus, onOpenDetail, delta, working, reduced } = props;
  const { t } = useTranslation();
  const tb = t.twin.blueprint;
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const ids = useMemo(() => radialIds(`rd-${uid}`), [uid]);
  const focusIds = useMemo(() => radialIds(`rd-${uid}-l2`), [uid]);
  const rootRef = useRef<HTMLDivElement>(null);
  const { w, h, measured } = useCanvasSize(rootRef, FALLBACK);
  const coverage = useMemo(() => sectionCoverage(model), [model]);
  const [hot, setHot] = useState<SectionId | null>(null);
  const [takeFocus, setTakeFocus] = useState(false);
  const returnTo = useRef<SectionId | null>(null);
  const zoom = mode === 'detail' ? focus : null;

  const activate = useCallback(
    (section: SectionId) => {
      setTakeFocus(true);
      setHot(null);
      onFocus(section);
    },
    [onFocus],
  );

  const back = useCallback(() => {
    returnTo.current = focus;
    onFocus(null);
  }, [focus, onFocus]);

  // Back on the overview: hand keyboard focus to the segment that was open.
  useEffect(() => {
    if (zoom !== null || !returnTo.current) return;
    const seg = rootRef.current?.querySelector<SVGGElement>(`[data-testid="radial-seg-${returnTo.current}"]`);
    returnTo.current = null;
    seg?.focus({ preventScroll: true });
  }, [zoom]);

  return (
    <div
      ref={rootRef}
      className="rd-root"
      data-testid="twin-blueprint-radial"
      data-mode={mode}
      data-focus={zoom ?? 'overview'}
      data-motion={reduced ? 'reduced' : 'full'}
      data-sized={measured ? 'true' : 'false'}
      data-working={mode === 'stage' && working ? 'true' : undefined}
      role="group"
      aria-label={tb.variants.radial}
    >
      {mode === 'stage' ? (
        <RadialStage model={model} coverage={coverage} w={w} h={h} ids={ids} delta={delta} working={working} reduced={reduced} />
      ) : (
        <>
          <RadialOverview
            model={model}
            coverage={coverage}
            w={w}
            h={h}
            uid={uid}
            ids={ids}
            hot={hot}
            zoom={zoom}
            reduced={reduced}
            onActivate={activate}
            onHot={setHot}
          />
          {zoom && (
            <RadialFocus
              key={zoom}
              section={zoom}
              model={model}
              coverage={coverage[zoom]}
              ids={focusIds}
              w={w}
              takeFocus={takeFocus}
              reduced={reduced}
              onBack={back}
              onOpenDetail={onOpenDetail}
            />
          )}
        </>
      )}
    </div>
  );
}
