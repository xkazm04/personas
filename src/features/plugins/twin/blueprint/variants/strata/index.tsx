/**
 * Blueprint variant "strata" (spark twin-portable-blueprint, WP8): EXPLODED
 * STRATA. The twin as four translucent plates in isometric projection, one per
 * section (Identity on top, then Voice, Knowledge, Training), each top face
 * drawing its section's quantities and filled to its `sectionCoverage`.
 *
 * - detail L1: the exploded stack, a flat callout per plate on a leader line.
 * - detail L2 (`focus`): the chosen plate lifts forward and flattens face-on,
 *   carrying the detailed charts; the others recede into a rail on the left.
 * - stage: the stack sits compressed in the left rail at lower contrast (the
 *   question card owns the centre) and breathes; the answered plate lifts and
 *   the delta lands on it; `working` sends a slow scan line down the plates.
 *
 * Motion: geometry travels by CSS transitions, loops are CSS (breathe, scan,
 * dots), one-shots are framer; `reduced` turns travel into fades and drops the
 * loops (`data-motion="reduced"`).
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { useTranslation } from '@/i18n/useTranslation';

import type { BlueprintVariantProps, SectionId } from '../../blueprintContract';
import { sectionCoverage } from '../../sectionMetrics';
import { StageReadout } from './StageReadout';
import { StrataCallout } from './StrataCallout';
import { StrataPanel } from './StrataPanel';
import { StrataStack, type StrataLayout } from './StrataStack';
import { PLATE_ORDER, deltaSection, sectionStats } from './strataModel';
import './strata.css';
import './strata-surfaces.css';
import './strata-panel.css';

export default function StrataBlueprint(props: BlueprintVariantProps) {
  const { model, mode, focus, onFocus, onOpenDetail, delta, working, reduced } = props;
  const { t } = useTranslation();
  const tb = t.twin.blueprint;
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const rootRef = useRef<HTMLDivElement>(null);
  const [hot, setHot] = useState<SectionId | null>(null);
  const [panelTakesFocus, setPanelTakesFocus] = useState(false);
  const returnTo = useRef<SectionId | null>(null);

  const layout: StrataLayout = mode === 'stage' ? 'stage' : focus ? 'focus' : 'overview';
  const coverage = useMemo(() => sectionCoverage(model), [model]);
  const answered = mode === 'stage' && delta ? deltaSection(delta, model) : null;

  const activate = useCallback(
    (section: SectionId) => {
      if (mode === 'stage') return;
      setPanelTakesFocus(true);
      setHot(null);
      onFocus(section);
    },
    [mode, onFocus],
  );

  const back = useCallback(() => {
    returnTo.current = focus;
    onFocus(null);
  }, [focus, onFocus]);

  // Back on the overview: hand keyboard focus to the plate that was open.
  useEffect(() => {
    if (layout !== 'overview' || !returnTo.current) return;
    const plate = rootRef.current?.querySelector<HTMLElement>(`[data-testid="strata-plate-${returnTo.current}"]`);
    returnTo.current = null;
    plate?.focus({ preventScroll: true });
  }, [layout]);

  return (
    <div
      ref={rootRef}
      className="strata-root"
      data-testid="twin-blueprint-strata"
      data-mode={mode}
      data-focus={focus ?? 'overview'}
      data-motion={reduced ? 'reduced' : 'full'}
    >
      <div
        key={reduced ? layout : 'scene'}
        className="strata-scene"
        data-layout={layout}
        data-motion={reduced ? 'reduced' : 'full'}
        data-working={working ? 'true' : undefined}
        role="group"
        aria-label={tb.variants.strata}
      >
        <StrataStack
          layout={layout}
          model={model}
          coverage={coverage}
          focus={focus}
          hot={hot}
          labels={tb.sections}
          uid={uid}
          delta={mode === 'stage' ? delta : null}
          deltaSection={answered}
          working={working}
          reduced={reduced}
          onActivate={activate}
          onHot={setHot}
        />

        {mode === 'detail' &&
          PLATE_ORDER.map((section, index) => (
            <StrataCallout
              key={section}
              id={`${uid}-callout-${section}`}
              section={section}
              index={index}
              coverage={coverage[section]}
              stats={sectionStats(model, section, tb.metrics)}
              hot={hot === section}
              onActivate={activate}
              onHot={setHot}
            />
          ))}
        {layout === 'overview' && <p className="strata-hint typo-caption">{tb.variantCopy.strata.plateHint}</p>}

        {layout === 'focus' && focus && (
          <StrataPanel
            section={focus}
            model={model}
            coverage={coverage[focus]}
            takeFocus={panelTakesFocus}
            reduced={reduced}
            onBack={back}
            onOpenDetail={onOpenDetail}
          />
        )}

        {layout === 'stage' && (
          <StageReadout model={model} delta={delta} section={answered} working={working} reduced={reduced} />
        )}
      </div>
    </div>
  );
}
