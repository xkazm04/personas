/**
 * Fusion · the island opened as a conversation: a quiet head (her mark, the
 * thread switcher, the mode keys, fold) over the transcript. A report or the
 * Brain opens IN the sheet (it grows tall for them) and Esc steps back. No
 * tool column in here: the toolset lives on the rail, where it always is.
 *
 * TODO(prototype, 2026-10-07): athena chat fusion - consolidate after the owner picks.
 */

import { Collapse } from '@/features/shared/components/display/Collapse';
import { useSystemStore } from '@/stores/systemStore';
import { BrainViewer } from '../../../../../BrainViewer';
import { ConversationSwitcher } from '../../../../../ConversationSwitcher';
import { DevOpLedger } from '../../../../../DevOpLedger';
import { useAthenaStore } from '../../../../../athenaStore';
import type { AthenaChatEngine } from '../../../../athenaChatEngine';
import { ReportReader } from '../../../../refs/ReportReader';
import type { LayerApi } from '../../../useLayer';
import { FrameKeys } from '../../FrameKeys';
import { FRAME_LOOKS } from '../../frameLook';
import { FUSION_COPY as F } from './copy';
import { IslandMark } from './IslandCapsule';
import { Transcript } from './Transcript';

const closeBrain = () => useAthenaStore.getState().setBrainView({ open: false, kind: null, id: null });

export function Conversation({
  engine,
  layer,
  tall,
  gated,
  onToggleTall,
  onFold,
}: {
  engine: AthenaChatEngine;
  layer: LayerApi;
  tall: boolean;
  gated: boolean;
  onToggleTall: () => void;
  onFold: () => void;
}) {
  const { view } = layer;
  const streaming = useAthenaStore((s) => s.streaming);
  const brainOpen = useAthenaStore((s) => s.brainView.open);
  const devMode = useSystemStore((s) => s.athenaDevMode);
  const devAvailable = useAthenaStore((s) => s.devModeAvailable);

  return (
    <>
      <div className="fu-head">
        <IslandMark large working={streaming} gated={gated} />
        <ConversationSwitcher />
        <span className="flex-1" />
        <FrameKeys
          look={FRAME_LOOKS.halo}
          expanded={tall}
          onExpand={onToggleTall}
          onFold={onFold}
          foldShortcut={{ label: F.keyEsc, aria: 'Escape' }}
        />
      </div>
      <Collapse open={devAvailable && devMode} unmountWhenClosed className="shrink-0">
        <DevOpLedger />
      </Collapse>
      <div className="fu-body">
        {brainOpen ? (
          <div className="relative flex-1 min-w-0">
            <BrainViewer onClose={closeBrain} />
          </div>
        ) : view.kind === 'report' ? (
          <div className="relative flex-1 min-w-0 overflow-y-auto">
            <ReportReader reportId={view.id} onClose={layer.back} overlay={false} escToClose={false} />
          </div>
        ) : (
          <Transcript engine={engine} onOpenWaiting={() => layer.openWork()} />
        )}
      </div>
    </>
  );
}
