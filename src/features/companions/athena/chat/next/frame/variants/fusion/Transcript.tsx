/**
 * Fusion · the conversation's scroll. The view half is Current's own
 * (`useAthenaChatView`): windowing to the recent rounds, "earlier messages",
 * backend paging on scroll-up, bottom-aware autoscroll and open-at-latest.
 * Around the turns sit Current's other pieces (alerts, the welcome hero on an
 * empty thread, the error notice, jump-to-latest), plus queued messages and
 * quick replies, and her live turn at the foot.
 *
 * Rows are TURNS (`buildTurns`) on a tight vertical rhythm: one gap between
 * turns, none of the 36px canyons the R5 sheet left, and the meta in a side
 * gutter (`TurnRow`). Her words grow between store writes while she streams,
 * so the scroll follows the growth itself while the reader sits at the foot.
 *
 * TODO(prototype, 2026-10-07): athena chat fusion - consolidate after the owner picks.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { ChevronUp } from 'lucide-react';
import type { BrainKind } from '@/api/companion';
import Button from '@/features/shared/components/buttons/Button';
import { useSystemStore } from '@/stores/systemStore';
import { QueuedMessages } from '../../../../../QueuedMessages';
import { QuickReplies } from '../../../../../QuickReplies';
import { WelcomeHero } from '../../../../../WelcomeHero';
import { useAthenaStore } from '../../../../../athenaStore';
import { AthenaChatAlerts } from '../../../../AthenaChatAlerts';
import { AthenaChatErrorNotice } from '../../../../AthenaChatErrorNotice';
import { AthenaChatJumpToLatest } from '../../../../AthenaChatJumpToLatest';
import type { TurnSummaryJumpTarget } from '../../../../AthenaChatMessageRow';
import type { AthenaChatEngine } from '../../../../athenaChatEngine';
import { useAthenaChatView } from '../../../../athenaChatSession';
import { buildTurns } from '../../../exchange';
import { FUSION_COPY as F } from './copy';
import { StreamingTurn } from './StreamingTurn';
import { TurnRow } from './TurnRow';

const openInBrain = (kind: BrainKind, id: string) => useAthenaStore.getState().setBrainView({ open: true, kind, id });

export function Transcript({ engine, onOpenWaiting }: { engine: AthenaChatEngine; onOpenWaiting: () => void }) {
  const view = useAthenaChatView(engine, true);
  const quickReplies = useAthenaStore((s) => s.quickReplies);
  const hasProactive = useAthenaStore((s) => s.proactive.length > 0);
  const { visible, hiddenCount } = view.transcriptWindow;
  const turns = useMemo(() => buildTurns(visible), [visible]);
  const latestId = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i--) if (turns[i]!.replies.length) return turns[i]!.id;
    return null;
  }, [turns]);

  const onJumpSummary = useCallback(
    (target: TurnSummaryJumpTarget) => {
      if (target === 'approvals' || target === 'chatCards') {
        onOpenWaiting();
        return;
      }
      const sys = useSystemStore.getState();
      sys.setSidebarSection('home');
      sys.setHomeTab('cockpit');
    },
    [onOpenWaiting],
  );

  // Follow the column's growth (the streaming reveal) while the reader is at the foot.
  const { scrollRef } = view;
  const grow = useRef<ResizeObserver | null>(null);
  const followRef = useCallback(
    (el: HTMLDivElement | null) => {
      grow.current?.disconnect();
      grow.current = null;
      if (!el) return;
      let lastH = el.offsetHeight;
      grow.current = new ResizeObserver(() => {
        const box = scrollRef.current;
        const h = el.offsetHeight;
        const grew = h - lastH;
        lastH = h;
        if (!box || grew <= 0) return;
        if (box.scrollHeight - box.scrollTop - box.clientHeight - grew < 96) box.scrollTop = box.scrollHeight;
      });
      grow.current.observe(el);
    },
    [scrollRef],
  );
  useEffect(() => () => grow.current?.disconnect(), []);

  const showHero = engine.initialized && engine.messages.length === 0 && !engine.streaming && !hasProactive;

  return (
    <div className="relative flex-1 min-w-0 min-h-0 flex">
      <div
        ref={scrollRef}
        className="fu-scroll"
        role="log"
        aria-label={F.transcript}
        aria-relevant="additions"
        data-testid="companion-fusion-transcript"
      >
        <div ref={followRef} className="fu-column athena-exchange">
          {engine.initError && <p className="typo-body text-status-error">{engine.initError}</p>}
          <AthenaChatAlerts onEngage={engine.send} />
          {showHero && <WelcomeHero onPick={engine.send} disabled={!engine.initialized || engine.streaming} />}
          {hiddenCount > 0 && (
            <div className="flex justify-center">
              <Button
                variant="ghost"
                size="xs"
                onClick={view.showEarlier}
                icon={<ChevronUp className="w-3.5 h-3.5" aria-hidden />}
                data-testid="companion-show-earlier"
              >
                {F.earlier(hiddenCount)}
              </Button>
            </div>
          )}
          {turns.map((turn, i) => (
            <TurnRow
              key={turn.id}
              turn={turn}
              index={hiddenCount + i}
              isLatest={turn.id === latestId}
              streaming={engine.streaming}
              interactive={engine.initialized}
              onSend={engine.send}
              onOpenInBrain={openInBrain}
              onJumpSummary={onJumpSummary}
            />
          ))}
          {engine.streaming && (
            <StreamingTurn onStop={engine.interrupt} onOpenInBrain={openInBrain} lastStreamEventAtRef={engine.lastStreamEventAtRef} />
          )}
          <div className="fu-after empty:hidden">
            <QueuedMessages />
            {!engine.streaming && quickReplies.length > 0 && (
              <QuickReplies options={quickReplies} disabled={!engine.initialized} onPick={engine.send} />
            )}
          </div>
          <AthenaChatErrorNotice onSend={engine.send} />
        </div>
      </div>
      <AthenaChatJumpToLatest visible={!view.atBottom} onClick={view.scrollToBottom} />
    </div>
  );
}
