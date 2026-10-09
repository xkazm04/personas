/**
 * The door for a milestone with no brief: a note created and linked as its
 * brief in one press (`createNote` then `linkMilestone`, both reporting their
 * own failure), refused with the reason while the notepad is at its cap.
 */
import { Plus } from 'lucide-react';

import { AsyncButton } from '@/features/shared/components/buttons';
import { atCap, createNote, linkMilestone } from '@/features/notepad/notepadStore';

import { useProgressView } from '../../canvasHost';
import type { MilestoneCard } from '../layerModel';

export function StartBrief({ card, projectId }: { card: MilestoneCard; projectId: string }) {
  const { dl } = useProgressView();
  const full = atCap();
  const start = async () => {
    const note = await createNote(card.lane.name, projectId);
    if (note) await linkMilestone(note.id, card.lane.id);
  };
  return (
    <div className="rounded-card border border-dashed border-primary/20 px-4 py-4 flex flex-wrap items-center justify-between gap-3">
      <p className="typo-body text-foreground">{dl.layers_no_brief}</p>
      <AsyncButton
        variant="accent"
        tone="highlight"
        size="sm"
        icon={<Plus className="w-3.5 h-3.5" />}
        disabled={full}
        disabledReason={dl.layers_start_brief_cap}
        onClick={start}
        data-testid="layers-detail-start-brief"
      >
        {dl.layers_start_brief}
      </AsyncButton>
    </div>
  );
}
