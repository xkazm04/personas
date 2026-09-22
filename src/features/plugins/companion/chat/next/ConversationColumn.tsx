/**
 * ConversationColumn — layer one's main surface in every variant: the
 * conversation, the live working line, and the composer. Variants decide what
 * sits beside it and what replaces it when the nested layer opens.
 */

import type { ReactNode } from 'react';
import { WelcomeHero } from '../../WelcomeHero';
import { useCompanionStore } from '../../companionStore';
import { AthenaChatErrorNotice } from '../AthenaChatErrorNotice';
import { AthenaChatJumpToLatest } from '../AthenaChatJumpToLatest';
import { AthenaChatLiveRegion } from '../AthenaChatLiveRegion';
import type { AthenaChatEngine } from '../athenaChatEngine';
import { useAthenaChatView } from '../athenaChatSession';
import { ExchangeTranscript } from './ExchangeTranscript';
import { LiveLine } from './NextPanes';
import { NextComposer } from './NextComposer';
import type { LayerApi } from './useLayer';
import type { WorkItem } from './useWorkforce';

export function ConversationColumn({
  engine,
  layer,
  about,
  onClearAbout,
  measure = 'reading',
  nested,
}: {
  engine: AthenaChatEngine;
  layer: LayerApi;
  about?: WorkItem | null;
  onClearAbout?: () => void;
  measure?: 'reading' | 'wide';
  /** Nested-layer content shown where the conversation was; the composer stays. */
  nested?: ReactNode;
}) {
  const view = useAthenaChatView(engine, true);
  const hasProactive = useCompanionStore((s) => s.proactive.length > 0);
  const showHero = engine.initialized && engine.messages.length === 0 && !engine.streaming && !hasProactive;

  return (
    <div className="relative flex-1 min-w-0 flex flex-col">
      {nested && <div className="relative flex-1 min-h-0 flex flex-col">{nested}</div>}
      {/* The conversation stays mounted under the nested layer so its scroll
          position and windowing survive a trip down and back. */}
      <div className={`relative flex-1 min-h-0 flex flex-col ${nested ? 'hidden' : ''}`}>
        <div ref={view.scrollRef} className="flex-1 overflow-y-auto scrollbar-thin companion-scroll px-8 py-8">
          {showHero && (
            <div className="mx-auto max-w-[74ch]">
              <WelcomeHero onPick={engine.send} disabled={!engine.initialized || engine.streaming} />
            </div>
          )}
          <ExchangeTranscript
            messages={engine.messages}
            streaming={engine.streaming}
            interactive={engine.initialized}
            onSend={engine.send}
            onOpenTurn={layer.openTurn}
            onOpenWaiting={() => layer.openWork()}
            measure={measure}
          />
          <LiveLine />
          <AthenaChatLiveRegion />
          <div className="mx-auto max-w-[74ch] mt-4">
            <AthenaChatErrorNotice onSend={engine.send} />
          </div>
        </div>
        <AthenaChatJumpToLatest visible={!view.atBottom} onClick={view.scrollToBottom} />
      </div>
      <NextComposer
        interactive={engine.initialized}
        streaming={engine.streaming}
        onSend={engine.send}
        onSendOrQueue={engine.sendOrQueue}
        about={about}
        onClearAbout={onClearAbout}
        measure={measure}
      />
    </div>
  );
}
