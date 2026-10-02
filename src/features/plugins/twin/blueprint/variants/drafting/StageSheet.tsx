import { useMemo, type ReactNode } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { BlueprintDelta, SectionId, TwinBlueprintModel } from '../../blueprintContract';
import { sectionCoverage } from '../../sectionMetrics';
import BoxFrame from './BoxFrame';
import IdentityDrawing from './IdentityDrawing';
import KnowledgeDrawing from './KnowledgeDrawing';
import { Letter } from './Lettering';
import type { SheetDraw } from './OverviewSheet';
import SheetBorder from './SheetBorder';
import SheetRegion from './SheetRegion';
import TrainingDrawing from './TrainingDrawing';
import TwinTitleBlock from './TwinTitleBlock';
import VoiceDrawing from './VoiceDrawing';
import WorkingPlan from './WorkingPlan';
import type { DeltaTarget } from './draftingTwinModel';
import DrawSheet from './draw/DrawSheet';

/**
 * The training overlay's base layer (the layout lives in `.twd-stage`). The
 * card is dealt into the middle, so the middle column is open paper a card
 * wide, with the title block above it and the notes below it, where the last
 * answer's gain and reason are written; identity, voice and knowledge stand
 * in the left column and training, where most answers land, in the right.
 * While the engine works with no question, the open middle shows the sheet
 * being drafted. The whole sheet is one drawing: it draws itself in once,
 * when the overlay opens, and the answers' deltas play on it once it stands.
 */
export default function StageSheet({
  model,
  reduced,
  roomy,
  working,
  delta,
  target,
  draw,
  finish,
  register,
  notes,
}: {
  model: TwinBlueprintModel;
  reduced: boolean;
  /** A large sheet: the regions draw their layer-one forms instead of the one-line ones. */
  roomy: boolean;
  working: boolean;
  /** The delta to show; `null` while the sheet still draws itself in. */
  delta: BlueprintDelta | null;
  target: DeltaTarget | null;
  draw: SheetDraw;
  /** An answer arrived mid-draw: show the rest drawn so its delta plays on a whole sheet. */
  finish: boolean;
  register: (key: string) => (el: HTMLElement | null) => void;
  notes: ReactNode;
}) {
  const { t } = useTranslation();
  const b = t.twin.blueprint;
  const cov = sectionCoverage(model);
  const replanKey = useMemo(() => ({ roomy, model }), [roomy, model]);
  const region = (section: SectionId) => ({
    section,
    coverage: cov[section],
    dense: true,
    targeted: target?.key === `region:${section}`,
    regionRef: register(`region:${section}`),
  });

  return (
    <DrawSheet {...draw} finish={finish} replanKey={replanKey} className="twd-stage h-full min-h-0">
      <SheetBorder />
      <div data-area="left" className="flex min-h-0 min-w-0 flex-col gap-2">
        <SheetRegion {...region('identity')} unmeasuredLabel={b.states.notDrawn} className="twd-stage-secondary">
          <IdentityDrawing identity={model.identity} compact={!roomy} />
        </SheetRegion>
        <SheetRegion {...region('voice')} unmeasuredLabel={b.states.emptyVoice} className="flex-1">
          <VoiceDrawing voice={model.voice} compact={!roomy} targetKey={target?.key ?? null} register={register} />
        </SheetRegion>
        <SheetRegion {...region('knowledge')} unmeasuredLabel={b.states.notMeasured} className="twd-stage-secondary">
          <KnowledgeDrawing knowledge={model.knowledge} size={roomy ? 'l1' : 'compact'} />
        </SheetRegion>
      </div>
      <div data-area="title" ref={register('title')} className="min-w-0">
        <TwinTitleBlock model={model} slots={false} />
      </div>
      <div data-area="well" data-testid="twd-card-well" className="relative flex min-h-0 items-center justify-center">
        {working && !delta && <WorkingPlan reduced={reduced} />}
      </div>
      <div
        data-area="notes"
        ref={register('notes')}
        data-testid="twd-notes"
        data-draw-scope=""
        className="twd-card relative flex min-w-0 flex-col gap-1 px-3 py-2"
      >
        <BoxFrame />
        <Letter>{b.variantCopy.drafting.notes}</Letter>
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
    </DrawSheet>
  );
}
