import { useMemo } from 'react';
import type { SectionId, TwinBlueprintModel } from '../../blueprintContract';
import { sectionCoverage } from '../../sectionMetrics';
import IdentityDrawing from './IdentityDrawing';
import KnowledgeDrawing from './KnowledgeDrawing';
import SheetBorder from './SheetBorder';
import SheetRegion from './SheetRegion';
import TrainingDrawing from './TrainingDrawing';
import TwinTitleBlock from './TwinTitleBlock';
import VoiceDrawing from './VoiceDrawing';
import DrawSheet, { type DrawSheetProps } from './draw/DrawSheet';
import { useTranslation } from '@/i18n/useTranslation';

/** The sheet's plan: four regions sharing walls, the title block in the bottom-right corner. */
const PLAN = {
  gridTemplateColumns: 'minmax(0, 0.95fr) minmax(0, 1.3fr) minmax(0, 1fr)',
  gridTemplateRows: 'minmax(0, 1fr) minmax(0, 1fr) auto',
  gridTemplateAreas: '"identity voice training" "knowledge voice training" "knowledge title title"',
} as const;

/** What the variant hands each drawing: whether it draws itself in, and who listens. */
export type SheetDraw = Pick<DrawSheetProps, 'instant' | 'onPlan' | 'onDone' | 'onLeave'>;

/**
 * Layer one of the Detail page: the twin drawn as a plan. Each region is a
 * small drawing of its quantities and the door to its zoom. The plan is one
 * drawing (`DrawSheet`): on the first visit it draws itself in, frames level
 * by level, then every container's content in reading order; back from a
 * zoom it is simply there.
 */
export default function OverviewSheet({
  model,
  roomy,
  reduced,
  draw,
  onFocus,
  register,
}: {
  model: TwinBlueprintModel;
  reduced: boolean;
  /** A large sheet: identity letters its scale and names its languages. */
  roomy: boolean;
  draw: SheetDraw;
  onFocus: (section: SectionId) => void;
  register: (key: string) => (el: HTMLElement | null) => void;
}) {
  const { t } = useTranslation();
  const states = t.twin.blueprint.states;
  const cov = sectionCoverage(model);
  // Rows a resize moves in or out, or a refreshed model, are re-read while the plan still draws.
  const replanKey = useMemo(() => ({ roomy, model }), [roomy, model]);
  const region = (section: SectionId, index: number) => ({
    section,
    number: index + 1,
    coverage: cov[section],
    onActivate: () => onFocus(section),
    regionRef: register(`region:${section}`),
    style: { gridArea: section },
  });

  return (
    <DrawSheet {...draw} replanKey={replanKey} data-testid="twd-overview" className="twd-plan grid h-full min-h-0 gap-4" style={PLAN}>
      <SheetBorder />
      <SheetRegion {...region('identity', 0)} unmeasuredLabel={states.notDrawn}>
        <IdentityDrawing identity={model.identity} detailed={roomy} />
      </SheetRegion>
      <SheetRegion {...region('voice', 1)} unmeasuredLabel={states.emptyVoice}>
        <VoiceDrawing voice={model.voice} />
      </SheetRegion>
      <SheetRegion {...region('knowledge', 2)} unmeasuredLabel={states.notMeasured}>
        <KnowledgeDrawing knowledge={model.knowledge} size="l1" />
      </SheetRegion>
      <SheetRegion {...region('training', 3)} unmeasuredLabel={states.emptyTraining}>
        <TrainingDrawing training={model.training} reduced={reduced} />
      </SheetRegion>
      <div style={{ gridArea: 'title' }} ref={register('title')} className="min-w-0">
        <TwinTitleBlock model={model} />
      </div>
    </DrawSheet>
  );
}
