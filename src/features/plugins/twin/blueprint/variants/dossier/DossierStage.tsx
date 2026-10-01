/**
 * Dossier (WP9), the training overlay's base layer: the four section tiles
 * stand in two quiet rails at the sides (Identity and Voice left, Knowledge
 * and Training right), so the centre stays empty for the question card. When
 * an answer lands, its tile pulses once, its figures count up and its readout
 * shows the topic, then the gain and the why. While the engine works with no
 * live question the centre carries a calm ghost and every gauge shimmers
 * (loading pattern v2: CSS loops, no spinner, stopped under reduced motion).
 */
import { useMemo, useRef } from 'react';

import { Ghost, Tiles } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';

import type { BlueprintDelta, SectionId, TwinBlueprintModel } from '../../blueprintContract';
import { sectionCoverage } from '../../sectionMetrics';
import { DossierCell } from './DossierCell';
import { RAIL_ROOMY_AT, deltaSection } from './dossierModel';
import { SectionTile } from './SectionTile';
import { useRoomy } from './useRoomy';

const RAILS: ReadonlyArray<readonly SectionId[]> = [
  ['identity', 'voice'],
  ['knowledge', 'training'],
];

interface DossierStageProps {
  model: TwinBlueprintModel;
  delta: BlueprintDelta | null;
  working: boolean;
  reduced: boolean;
}

export function DossierStage({ model, delta, working, reduced }: DossierStageProps) {
  const { t } = useTranslation();
  const tb = t.twin.blueprint;
  const coverage = useMemo(() => sectionCoverage(model), [model]);
  const hot = delta ? deltaSection(delta, model) : null;
  const pulseKey = delta ? `${delta.answeredStepId}:${delta.phase}` : undefined;
  const railRef = useRef<HTMLDivElement>(null);
  const roomy = useRoomy(railRef, RAIL_ROOMY_AT);

  const rail = (sections: readonly SectionId[], side: 'left' | 'right') => (
    <div ref={side === 'left' ? railRef : undefined} className="dossier-rail" data-side={side} data-roomy={roomy ? 'true' : undefined}>
      <Tiles label={tb.variantCopy.dossier.heroLabel} cols={1}>
        {sections.map((section) => (
          <DossierCell key={section} section={section} face="stage" hot={hot === section} pulseKey={pulseKey} reduced={reduced}>
            <SectionTile
              section={section}
              face="stage"
              model={model}
              coverage={coverage[section]}
              reduced={reduced}
              roomy={roomy}
              delta={hot === section ? delta : null}
              working={working}
            />
          </DossierCell>
        ))}
      </Tiles>
    </div>
  );

  return (
    <div className="dossier-stage" data-working={working ? 'true' : undefined} data-hot={hot ?? undefined} data-testid="dossier-stage">
      {rail(RAILS[0]!, 'left')}
      <div className="dossier-centre">
        {working && (
          <div className="dossier-working" data-testid="dossier-working">
            <span className="typo-heading">{tb.states.working}</span>
            <span className="dossier-working__ghosts" aria-hidden="true">
              <Ghost width="70%" height="10px" />
              <Ghost width="52%" height="10px" />
              <Ghost width="61%" height="10px" />
            </span>
          </div>
        )}
      </div>
      {rail(RAILS[1]!, 'right')}
    </div>
  );
}
