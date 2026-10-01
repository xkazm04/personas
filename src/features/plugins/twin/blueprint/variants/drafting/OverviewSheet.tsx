import type { SectionId, TwinBlueprintModel } from '../../blueprintContract';
import { sectionCoverage } from '../../sectionMetrics';
import IdentityDrawing from './IdentityDrawing';
import KnowledgeDrawing from './KnowledgeDrawing';
import SheetRegion from './SheetRegion';
import TrainingDrawing from './TrainingDrawing';
import TwinTitleBlock from './TwinTitleBlock';
import VoiceDrawing from './VoiceDrawing';
import { useTranslation } from '@/i18n/useTranslation';

/** The sheet's plan: four regions sharing walls, the title block in the bottom-right corner. */
const PLAN = {
  gridTemplateColumns: 'minmax(0, 0.95fr) minmax(0, 1.3fr) minmax(0, 1fr)',
  gridTemplateRows: 'minmax(0, 1fr) minmax(0, 1fr) auto',
  gridTemplateAreas: '"identity voice training" "knowledge voice training" "knowledge title title"',
} as const;

/**
 * Layer one of the Detail page: the twin drawn as a plan. Each region is a
 * small drawing of its quantities and the door to its zoom. `drawn` counts
 * how far the build-up has come (identity, voice, knowledge, training, then
 * the title block), so the first visit draws the sheet part by part.
 */
export default function OverviewSheet({
  model,
  drawn,
  reduced,
  roomy,
  onFocus,
  register,
}: {
  model: TwinBlueprintModel;
  drawn: number;
  reduced: boolean;
  /** A large sheet: identity letters its scale and names its languages. */
  roomy: boolean;
  onFocus: (section: SectionId) => void;
  register: (key: string) => (el: HTMLElement | null) => void;
}) {
  const { t } = useTranslation();
  const states = t.twin.blueprint.states;
  const cov = sectionCoverage(model);
  const region = (section: SectionId, index: number) => ({
    section,
    number: index + 1,
    coverage: cov[section],
    drawn: drawn > index,
    reduced,
    onActivate: () => onFocus(section),
    regionRef: register(`region:${section}`),
    style: { gridArea: section },
  });

  return (
    <div className="grid h-full min-h-0 gap-4" style={PLAN}>
      <SheetRegion {...region('identity', 0)} unmeasuredLabel={states.notDrawn}>
        <IdentityDrawing identity={model.identity} detailed={roomy} drawn={drawn > 0} reduced={reduced} />
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
        <TwinTitleBlock model={model} drawn={drawn > 4} reduced={reduced} />
      </div>
    </div>
  );
}
