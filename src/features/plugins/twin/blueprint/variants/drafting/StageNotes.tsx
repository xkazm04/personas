import { useTranslation } from '@/i18n/useTranslation';
import { channelLabel } from './channelLabel';
import type { BlueprintDelta, TwinBlueprintModel } from '../../blueprintContract';
import DeltaNote from './DeltaNote';
import { useTopicLabel } from './TrainingDrawing';
import type { DeltaTarget } from './draftingTwinModel';

/** The words for the mark an answer landed on: a topic, a goal, a channel or a section. */
export function useTargetLabel(target: DeltaTarget | null, model: TwinBlueprintModel): string | null {
  const { t } = useTranslation();
  const topicLabel = useTopicLabel();
  if (!target) return null;
  const cut = target.key.indexOf(':');
  const kind = target.key.slice(0, cut);
  const id = target.key.slice(cut + 1);
  if (kind === 'topic') return topicLabel(id);
  if (kind === 'goal') {
    const goal = model.training.goals.find((g) => g.id === id);
    // A goal the plan has since replaced is named by its section, never left blank.
    return goal ? goal.title : t.twin.blueprint.sections[target.section];
  }
  if (kind === 'channel') return channelLabel(id, t.twin.experience.sheet.everywhere);
  return t.twin.blueprint.sections[target.section];
}

/** Stage mode's notes: the last answer, or when the twin last trained. */
export default function StageNotes({
  model,
  delta,
  target,
  reduced,
}: {
  model: TwinBlueprintModel;
  delta: BlueprintDelta | null;
  target: DeltaTarget | null;
  reduced: boolean;
}) {
  const label = useTargetLabel(target, model);
  return <DeltaNote model={model} delta={delta} targetLabel={label} reduced={reduced} />;
}
