/**
 * Frame · the four-edge chat, floating over the app in pieces.
 *
 * ONE fixed, full-app layer under the title bar and the prototype switcher,
 * laid out as a grid: `[left rail auto] [centre minmax(0,1fr)] [right panel
 * auto]`. The layer is `pointer-events-none`; only the pieces take the pointer,
 * so the app stays visible and usable around them. Nothing sizes itself from
 * the viewport width.
 *
 * Centre column, top to bottom: her latest words (four rows, expandable into
 * the whole conversation) with the mode keys; a middle cell that holds the
 * Brain Viewer / a report reader, and always mounts the slot's decision stage;
 * the chat or voice input. Left: the tools rail. Right: the slot's panel.
 *
 * `slots` picks the right panel and the decision stage (see `slots.ts`).
 */

import { useMemo, useState } from 'react';
import { BrainViewer } from '../../../BrainViewer';
import { CompanionToolbar } from '../../../CompanionToolbar';
import { useCompanionStore } from '../../../companionStore';
import type { AthenaChatEngine } from '../../athenaChatEngine';
import { NEXT_COPY as C } from '../nextCopy';
import { frameGradient } from '../tones';
import { useLayer } from '../useLayer';
import { useLayerRefOpener } from '../useLayerRefOpener';
import { ReportReader } from '../../refs/ReportReader';
import { RefOpenerProvider } from '../../refs/RefOpenerContext';
import { useProcessColumns } from '../useProcessColumns';
import { useWorkforce } from '../useWorkforce';
import { FrameBottom } from './FrameBottom';
import { FramePiece } from './FramePiece';
import { FrameTop } from './FrameTop';
import { FRAME_LOOKS } from './frameLook';
import type { HaloSlots } from './slots';

const look = FRAME_LOOKS.halo;

export function VariantFrame({ engine, lifted, slots }: { engine: AthenaChatEngine; lifted: boolean; slots: HaloSlots }) {
  const { RightPanel, DecisionStage } = slots;
  const workforce = useWorkforce();
  const columns = useProcessColumns(workforce, C.athena);
  const layer = useLayer();
  const { view } = layer;
  const refOpener = useLayerRefOpener(layer, workforce.items);
  const [expanded, setExpanded] = useState(false);
  const streaming = useCompanionStore((s) => s.streaming);
  const brainOpen = useCompanionStore((s) => s.brainView.open);
  const frame = frameGradient(workforce);

  const decisionsOpen = view.kind === 'work' && !brainOpen;
  const focusId = view.kind === 'work' ? (view.focus ?? workforce.items[0]?.id ?? null) : null;
  const about = useMemo(
    () => (view.kind === 'work' ? (workforce.items.find((i) => i.id === focusId) ?? null) : null),
    [view.kind, workforce.items, focusId],
  );
  const centreOpen = brainOpen || view.kind === 'report';
  // The expanded conversation takes the middle cell only while nothing else
  // claims it; opening decisions or the Brain folds it back to four rows.
  const expandedTop = expanded && !centreOpen && !decisionsOpen;
  const toggleExpanded = () => {
    if (expandedTop) {
      setExpanded(false);
      return;
    }
    // Expanding asks for the middle cell: whatever holds it steps aside.
    if (view.kind !== 'chat') layer.back();
    if (brainOpen) useCompanionStore.getState().setBrainView({ open: false, kind: null, id: null });
    setExpanded(true);
  };

  return (
    <RefOpenerProvider value={refOpener}>
    <div
      className={`fixed inset-x-0 bottom-0 top-[112px] ${lifted ? 'z-[220]' : 'z-[60]'} pointer-events-none grid grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-[minmax(0,1fr)] gap-5 px-5 pb-6`}
      data-testid="companion-panel"
    >
      <div className="min-h-0 flex items-center">
        <FramePiece edge="left" look={look} frame={frame} label={C.tools} className="py-1">
          <CompanionToolbar dock="left" className="bg-transparent" />
        </FramePiece>
      </div>

      <div className="min-w-0 min-h-0 flex flex-col gap-4">
        <FramePiece
          edge="top"
          look={look}
          frame={frame}
          working={streaming}
          label={C.athena}
          sectionClassName={expandedTop ? 'flex-1 min-h-0' : 'shrink-0'}
        >
          <FrameTop
            look={look}
            engine={engine}
            expanded={expandedTop}
            onExpand={toggleExpanded}
            onOpenWaiting={() => layer.openWork()}
          />
        </FramePiece>

        <div className={expandedTop ? 'relative h-0 -mt-4' : 'relative flex-1 min-h-0'}>
          {centreOpen && (
            <FramePiece edge="center" look={look} frame={frame} className="flex flex-col overflow-hidden">
              {brainOpen ? (
                <div className="relative h-full">
                  <BrainViewer
                    onClose={() => useCompanionStore.getState().setBrainView({ open: false, kind: null, id: null })}
                  />
                </div>
              ) : view.kind === 'report' ? (
                <ReportReader reportId={view.id} onClose={layer.back} overlay={false} escToClose={false} />
              ) : null}
            </FramePiece>
          )}
          <DecisionStage
            items={workforce.items}
            open={decisionsOpen}
            focusId={focusId}
            onFocus={(id) => layer.openWork(id, null)}
            onClose={layer.back}
            onSend={engine.send}
          />
        </div>

        <FramePiece edge="bottom" look={look} frame={frame} working={streaming} sectionClassName="shrink-0" className="px-2 py-1.5">
          <FrameBottom engine={engine} about={about} onClearAbout={layer.back} />
        </FramePiece>
      </div>

      <div className="min-h-0 flex">
        <RightPanel
          columns={columns}
          waiting={workforce.counts.waiting}
          onOpenItem={(id) => layer.openWork(id, null)}
          onOpenWaiting={layer.toggleWork}
        />
      </div>
    </div>
    </RefOpenerProvider>
  );
}
