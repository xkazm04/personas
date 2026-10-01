import type { ReactNode } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { BlueprintDelta, SectionId, TwinBlueprintModel } from '../../blueprintContract';
import { sectionCoverage } from '../../sectionMetrics';
import IdentityDrawing from './IdentityDrawing';
import KnowledgeDrawing from './KnowledgeDrawing';
import { LETTER_STYLE } from './Lettering';
import SheetRegion from './SheetRegion';
import TrainingDrawing from './TrainingDrawing';
import TwinTitleBlock from './TwinTitleBlock';
import VoiceDrawing from './VoiceDrawing';
import WorkingPlan from './WorkingPlan';
import type { DeltaTarget } from './draftingTwinModel';

/** The order the stage sheet builds up in: the regions, then the title block. */
export const STAGE_ORDER = ['identity', 'voice', 'knowledge', 'training', 'title'] as const;

/**
 * The training overlay's base layer (the layout lives in `.twd-stage`). The
 * card is dealt into the middle, so the middle column is open paper a card
 * wide, with the title block above it and the notes below it, where the last
 * answer's gain and reason are written; identity, voice and knowledge stand
 * in the left column and training, where most answers land, in the right.
 * While the engine works with no question, the open middle shows the sheet
 * being drafted.
 */
export default function StageSheet({
  model,
  drawn,
  reduced,
  roomy,
  working,
  delta,
  target,
  register,
  notes,
}: {
  model: TwinBlueprintModel;
  drawn: number;
  reduced: boolean;
  /** A large sheet: the regions draw their layer-one forms instead of the one-line ones. */
  roomy: boolean;
  working: boolean;
  delta: BlueprintDelta | null;
  target: DeltaTarget | null;
  register: (key: string) => (el: HTMLElement | null) => void;
  notes: ReactNode;
}) {
  const { t } = useTranslation();
  const b = t.twin.blueprint;
  const cov = sectionCoverage(model);
  const region = (section: SectionId) => {
    const index = STAGE_ORDER.indexOf(section);
    return {
      section,
      number: index + 1,
      coverage: cov[section],
      drawn: drawn > index,
      reduced,
      dense: true,
      targeted: target?.key === `region:${section}`,
      regionRef: register(`region:${section}`),
    };
  };

  return (
    <div className="twd-stage h-full min-h-0">
      <div data-area="left" className="flex min-h-0 min-w-0 flex-col gap-2">
        <SheetRegion {...region('identity')} unmeasuredLabel={b.states.notDrawn} className="twd-stage-secondary">
          <IdentityDrawing identity={model.identity} compact={!roomy} drawn={drawn > 0} reduced={reduced} />
        </SheetRegion>
        <SheetRegion {...region('voice')} unmeasuredLabel={b.states.emptyVoice} className="flex-1">
          <VoiceDrawing voice={model.voice} compact={!roomy} targetKey={target?.key ?? null} register={register} />
        </SheetRegion>
        <SheetRegion {...region('knowledge')} unmeasuredLabel={b.states.notMeasured} className="twd-stage-secondary">
          <KnowledgeDrawing knowledge={model.knowledge} size={roomy ? 'l1' : 'compact'} />
        </SheetRegion>
      </div>
      <div data-area="title" ref={register('title')} className="min-w-0">
        <TwinTitleBlock model={model} drawn={drawn > 4} reduced={reduced} slots={false} />
      </div>
      <div data-area="well" data-testid="twd-card-well" className="relative flex min-h-0 items-center justify-center">
        {working && !delta && <WorkingPlan reduced={reduced} />}
      </div>
      <div
        data-area="notes"
        ref={register('notes')}
        data-testid="twd-notes"
        className="flex min-w-0 flex-col gap-1 px-3 py-2"
        style={{ border: '1px solid var(--ink)', background: 'color-mix(in srgb, var(--paper) 92%, transparent)' }}
      >
        <span className="typo-label" style={{ ...LETTER_STYLE, color: 'var(--ink)' }}>
          {b.variantCopy.drafting.notes}
        </span>
        {notes}
      </div>
      <div data-area="right" className="flex min-h-0 min-w-0 flex-col">
        <SheetRegion {...region('training')} unmeasuredLabel={b.states.emptyTraining} className="flex-1">
          <TrainingDrawing
            training={model.training}
            compact={!roomy}
            targetKey={target?.key ?? null}
            targetGoalId={target?.goalId ?? null}
            delta={delta}
            reduced={reduced}
            register={register}
          />
        </SheetRegion>
      </div>
    </div>
  );
}
