/**
 * The baseline Halo slots: today's usage panel (`ProcessColumns`, halo tiles)
 * on the right and today's centre decision piece (`DeckLayer`, one card at a
 * time) as the stage. Variants A/B/C start from these and replace one or both.
 */

import { useCompanionStore } from '../../../../companionStore';
import { ProcessColumns } from '../../ProcessColumns';
import { NEXT_COPY as C } from '../../nextCopy';
import { frameGradient } from '../../tones';
import { useWorkforce } from '../../useWorkforce';
import { DeckLayer } from '../DeckLayer';
import { FRAME_LOOKS } from '../frameLook';
import { FramePiece } from '../FramePiece';
import type { DecisionStageProps, HaloSlots, RightPanelProps } from '../slots';

const look = FRAME_LOOKS.halo;

/** The usage panel as one framed piece filling the right column's height. */
export function BaseRightPanel({ columns, waiting, onOpenItem, onOpenWaiting }: RightPanelProps) {
  const workforce = useWorkforce();
  return (
    <FramePiece edge="right" look={look} frame={frameGradient(workforce)} label={C.usage} sectionClassName="max-w-[420px]">
      <ProcessColumns columns={columns} waiting={waiting} onOpenItem={onOpenItem} onOpenWaiting={onOpenWaiting} look="halo" />
    </FramePiece>
  );
}

/** Fills the centre column's middle cell with one framed piece while open. */
export function BaseDecisionStage(props: DecisionStageProps) {
  return props.open ? <BaseStagePiece {...props} /> : null;
}

function BaseStagePiece({ items, focusId, onFocus, onClose, onSend }: DecisionStageProps) {
  const workforce = useWorkforce();
  const streaming = useCompanionStore((s) => s.streaming);
  return (
    <FramePiece
      edge="center"
      look={look}
      frame={frameGradient(workforce)}
      working={streaming}
      className="flex flex-col overflow-hidden"
    >
      <DeckLayer items={items} focusId={focusId} lane={null} onFocus={onFocus} onBack={onClose} onSend={onSend} />
    </FramePiece>
  );
}

export const BASE_SLOTS: HaloSlots = {
  id: 'base',
  label: 'Frame · Halo',
  RightPanel: BaseRightPanel,
  DecisionStage: BaseDecisionStage,
};
