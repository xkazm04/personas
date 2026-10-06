/**
 * ConversationBody - the island opened as a conversation: a quiet head (her
 * mark, the thread switcher, the mode keys, fold), the tools rail on the
 * sheet's left gutter, the transcript on a reading measure, her live reply at
 * its foot. A turn's tool steps, a report or the Brain open IN the sheet (the
 * sheet grows tall for them) and Esc steps back.
 *
 * It opens pinned to the latest turn - the reader never lands at the top of a
 * long thread - and follows new turns only while the reader is at the bottom.
 *
 * TODO(prototype, 2026-10-07): athena chat round 5 - consolidate after the owner picks.
 */

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { ArrowLeft, ChevronDown } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { Collapse } from '@/features/shared/components/display/Collapse';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useSystemStore } from '@/stores/systemStore';
import { AthenaToolbar } from '../../../../../AthenaToolbar';
import { BrainViewer } from '../../../../../BrainViewer';
import { ConversationSwitcher } from '../../../../../ConversationSwitcher';
import { DevOpLedger } from '../../../../../DevOpLedger';
import { QueuedMessages } from '../../../../../QueuedMessages';
import { QuickReplies } from '../../../../../QuickReplies';
import { useAthenaStore } from '../../../../../athenaStore';
import { useChatScroll } from '../../../../../useChatScroll';
import type { AthenaChatEngine } from '../../../../athenaChatEngine';
import { ReportReader } from '../../../../refs/ReportReader';
import { ExchangeTranscript } from '../../../ExchangeTranscript';
import { TurnPane } from '../../../NextPanes';
import type { LayerApi } from '../../../useLayer';
import { FrameKeys } from '../../FrameKeys';
import { FRAME_LOOKS } from '../../frameLook';
import { IslandMark } from './IslandMark';
import { StreamingReveal } from './StreamingReveal';
import { ISLAND_COPY as I } from './copy';

const closeBrain = () => useAthenaStore.getState().setBrainView({ open: false, kind: null, id: null });

export function ConversationBody({
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
  const streamingText = useAthenaStore((s) => s.streamingText);
  const quickReplies = useAthenaStore((s) => s.quickReplies);
  const brainOpen = useAthenaStore((s) => s.brainView.open);
  const devMode = useSystemStore((s) => s.athenaDevMode);
  const devAvailable = useAthenaStore((s) => s.devModeAvailable);
  const reading = !brainOpen && view.kind === 'chat';
  const { scrollRef, scrollToBottom, maybeAutoScroll } = useChatScroll(reading);

  // Land on the latest turn every time the transcript comes (back) into view.
  useLayoutEffect(() => {
    if (reading) scrollToBottom('auto');
  }, [reading, scrollToBottom]);
  useEffect(maybeAutoScroll, [engine.messages, streaming, streamingText, maybeAutoScroll]);
  // Her words reveal gradually, so the column grows between store updates:
  // follow the growth itself while the reader sits at the bottom.
  const grow = useRef<ResizeObserver | null>(null);
  const followRef = useCallback(
    (el: HTMLDivElement | null) => {
      grow.current?.disconnect();
      grow.current = el ? new ResizeObserver(() => maybeAutoScroll()) : null;
      if (el) grow.current?.observe(el);
    },
    [maybeAutoScroll],
  );

  return (
    <>
      <div className="r5a-head">
        <IslandMark large working={streaming} gated={gated} />
        <ConversationSwitcher />
        <span className="flex-1" />
        <FrameKeys look={FRAME_LOOKS.halo} expanded={tall} onExpand={onToggleTall} />
        <Tooltip content={`${I.foldChat} · ${I.keyEsc}`}>
          <Button
            variant="ghost"
            size="icon-md"
            className="!rounded-full"
            onClick={onFold}
            aria-label={I.foldChat}
            aria-keyshortcuts="Escape"
            data-testid="companion-r5a-fold"
            icon={<ChevronDown className="w-5 h-5" aria-hidden />}
          />
        </Tooltip>
      </div>
      <Collapse open={devAvailable && devMode} unmountWhenClosed className="shrink-0">
        <DevOpLedger />
      </Collapse>
      <div className="r5a-body">
        <div className="r5a-tools">
          <AthenaToolbar dock="single" className="bg-transparent" />
        </div>
        {brainOpen ? (
          <div className="relative flex-1 min-w-0">
            <BrainViewer onClose={closeBrain} />
          </div>
        ) : view.kind === 'report' ? (
          <div className="relative flex-1 min-w-0 overflow-y-auto">
            <ReportReader reportId={view.id} onClose={layer.back} overlay={false} escToClose={false} />
          </div>
        ) : (
          <div ref={scrollRef} className="r5a-scroll" data-testid="companion-r5a-transcript">
            {view.kind === 'turn' ? (
              <div className="mx-auto max-w-[96ch]" data-testid="companion-r5a-turn">
                <Button variant="ghost" size="sm" className="mb-3 -ml-2" icon={<ArrowLeft className="w-4 h-4" aria-hidden />} onClick={layer.back}>
                  {I.back}
                </Button>
                <TurnPane turn={view.turn} />
              </div>
            ) : (
              <div ref={followRef} className="mx-auto max-w-[68ch] flex flex-col gap-9 pt-2">
                <ExchangeTranscript
                  messages={engine.messages}
                  streaming={engine.streaming}
                  interactive={engine.initialized}
                  onSend={engine.send}
                  onOpenTurn={layer.openTurn}
                  onOpenWaiting={() => layer.openWork()}
                />
                {streaming && <StreamingReveal onStop={engine.interrupt} />}
                <div className="flex flex-col gap-2 empty:hidden">
                  <QueuedMessages />
                  {!streaming && quickReplies.length > 0 && (
                    <QuickReplies options={quickReplies} disabled={!engine.initialized} onPick={engine.send} />
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

