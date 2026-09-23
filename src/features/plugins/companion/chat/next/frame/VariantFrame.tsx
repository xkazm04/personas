/**
 * Frame · the four-edge chat, floating over the app in pieces.
 *
 * Top: her latest words (four rows, expandable into the whole conversation)
 * with the mode keys and the dev row. Bottom: chat or voice input. Right: the
 * usage panel (one column per affected project, decisions apart from
 * processes). Left: the tools rail (connectors, brain, voice, settings). A
 * decision opened from the right edge, the Brain Viewer, or a turn's detail
 * appears as one centre piece; the app stays visible and usable around them.
 *
 * `lookId` picks the stylistic direction (see `frameLook`).
 */

import { useMemo, useState } from 'react';
import { BrainViewer } from '../../../BrainViewer';
import { CompanionToolbar } from '../../../CompanionToolbar';
import { useCompanionStore } from '../../../companionStore';
import type { AthenaChatEngine } from '../../athenaChatEngine';
import { ProcessColumns } from '../ProcessColumns';
import { DeckLayer } from '../fused/DeckLayer';
import { NEXT_COPY as C } from '../nextCopy';
import { frameGradient } from '../tones';
import { useLayer } from '../useLayer';
import { useProcessColumns } from '../useProcessColumns';
import { useWorkforce } from '../useWorkforce';
import { FrameBottom } from './FrameBottom';
import { FramePiece } from './FramePiece';
import { FrameTop } from './FrameTop';
import { FRAME_LOOKS, type FrameLookId } from './frameLook';

export function VariantFrame({ engine, lifted, lookId }: { engine: AthenaChatEngine; lifted: boolean; lookId: FrameLookId }) {
  const look = FRAME_LOOKS[lookId];
  const workforce = useWorkforce();
  const columns = useProcessColumns(workforce, C.athena);
  const layer = useLayer();
  const { view } = layer;
  const [expanded, setExpanded] = useState(false);
  const streaming = useCompanionStore((s) => s.streaming);
  const brainOpen = useCompanionStore((s) => s.brainView.open);
  const frame = frameGradient(workforce);

  const focusId = view.kind === 'work' ? (view.focus ?? workforce.items[0]?.id ?? null) : null;
  const about = useMemo(
    () => (view.kind === 'work' ? (workforce.items.find((i) => i.id === focusId) ?? null) : null),
    [view.kind, workforce.items, focusId],
  );
  const centre = brainOpen || view.kind === 'work';

  return (
    <div className={`fixed inset-0 ${lifted ? 'z-[220]' : 'z-[60]'} pointer-events-none`} data-testid="companion-panel">
      <FramePiece
        edge="top"
        look={look}
        frame={frame}
        working={streaming}
        label={C.athena}
        sectionClassName={expanded ? 'bottom-[104px]' : ''}
      >
        <FrameTop
          look={look}
          engine={engine}
          expanded={expanded}
          onExpand={() => setExpanded((v) => !v)}
          onOpenWaiting={() => layer.openWork()}
        />
      </FramePiece>

      <FramePiece edge="bottom" look={look} frame={frame} working={streaming} className="px-2 py-1.5">
        <FrameBottom engine={engine} about={about} onClearAbout={layer.back} />
      </FramePiece>

      <FramePiece edge="left" look={look} frame={frame} label={C.tools} className="py-1">
        <CompanionToolbar dock="left" className="bg-transparent" />
      </FramePiece>

      <FramePiece edge="right" look={look} frame={frame} label={C.usage}>
        <ProcessColumns
          columns={columns}
          waiting={workforce.counts.waiting}
          onOpenItem={(id) => layer.openWork(id, null)}
          onOpenWaiting={layer.toggleWork}
          look={look.columns}
        />
      </FramePiece>

      {centre && (
        <FramePiece edge="center" look={look} frame={frame} className="flex flex-col overflow-hidden">
          {brainOpen ? (
            <div className="relative h-full">
              <BrainViewer
                onClose={() => useCompanionStore.getState().setBrainView({ open: false, kind: null, id: null })}
              />
            </div>
          ) : (
            <div className="h-full flex flex-col">
              <DeckLayer
                items={workforce.items}
                focusId={focusId}
                lane={null}
                onFocus={(id) => layer.openWork(id, null)}
                onBack={layer.back}
                onSend={engine.send}
              />
            </div>
          )}
        </FramePiece>
      )}
    </div>
  );
}
