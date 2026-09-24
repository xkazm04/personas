/**
 * The four doors off the lane, in one place.
 *
 * Only one of them is ever open: the three rail doors share a single `door`
 * value, and the fields layer closes whichever one summoned it. That is the
 * "one act at a time" rule made structural rather than remembered — there is
 * no state in which two layers can be open over each other.
 */

import type { TopicCoverage } from '../../../sub_training/topicCoverage';
import type { SetupFocus, SetupSessionApi } from '../../../setup/setupContract';
import type { TwinSlotId } from '../../../shared/twinStatus';
import { DeckLayer } from '../layers/DeckLayer';
import { FieldsLayer } from '../layers/FieldsLayer';
import { SheetLayer } from '../layers/SheetLayer';
import { VoiceLayer } from '../layers/VoiceLayer';
import type { VoiceDock } from '../layers/useVoiceDock';
import type { MirrorDoor } from './StageRail';

interface StageLayersProps {
  session: SetupSessionApi;
  door: MirrorDoor | null;
  onDoor: (door: MirrorDoor | null) => void;
  fieldsOpen: boolean;
  onFields: (open: boolean) => void;
  dock: VoiceDock;
  coverage: TopicCoverage[];
  rounds: number;
  onPickTopic: (prompt: string, presetId: string) => void;
  onOpenHub: () => void;
  onAskGuide: (slot: SetupFocus) => void;
}

export function StageLayers({
  session,
  door,
  onDoor,
  fieldsOpen,
  onFields,
  dock,
  coverage,
  rounds,
  onPickTopic,
  onOpenHub,
  onAskGuide,
}: StageLayersProps) {
  // The readiness jump inside the fields editor names a Hub slot; this surface
  // has one Hub and no deep link into it, so every slot lands in the same place.
  const openHubSlot = (_slot: TwinSlotId) => onOpenHub();

  return (
    <>
      <SheetLayer
        open={door === 'sheet'}
        onClose={() => onDoor(null)}
        session={session}
        onOpenFields={() => {
          onDoor(null);
          onFields(true);
        }}
        onOpenHub={onOpenHub}
      />
      <DeckLayer
        open={door === 'deck'}
        onClose={() => onDoor(null)}
        topicPreset={session.topicPreset}
        coverage={coverage}
        rounds={rounds}
        onPick={onPickTopic}
      />
      <VoiceLayer open={door === 'voice'} onClose={() => onDoor(null)} dock={dock} />
      <FieldsLayer
        open={fieldsOpen}
        onClose={() => onFields(false)}
        session={session}
        onOpenHub={openHubSlot}
        onAskGuide={onAskGuide}
      />
    </>
  );
}

export default StageLayers;
