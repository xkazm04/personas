/**
 * AthenaChatBody — the open panel's interior: scroll region, footer, side
 * panel and toolbar rail.
 *
 * Layout only. Every subscription, listener and pipeline lives in
 * `useAthenaChatSession`, and the leaves below read their own narrow store
 * slices rather than taking props — the old panel threaded ~25 props down from
 * the top, which made a single high-frequency value re-render everything under
 * it.
 */

import { useCallback, useRef } from 'react';
import type { BrainKind } from '@/api/companion';
import { useTranslation } from '@/i18n/useTranslation';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useSystemStore } from '@/stores/systemStore';
import { useCompanionStore } from '../companionStore';
import { BrainViewer } from '../BrainViewer';
import { CompanionToolbar } from '../CompanionToolbar';
import { FleetStatsSidePanel } from '../fleet/FleetStatsSidePanel';
import { WelcomeHero } from '../WelcomeHero';
import { AthenaChatAlerts } from './AthenaChatAlerts';
import { AthenaChatCompactHandle } from './AthenaChatCompactHandle';
import { AthenaChatErrorNotice } from './AthenaChatErrorNotice';
import { AthenaChatFooter } from './AthenaChatFooter';
import { AthenaChatJumpToLatest } from './AthenaChatJumpToLatest';
import { AthenaChatLiveRegion } from './AthenaChatLiveRegion';
import { AthenaChatApprovals, AthenaChatCards } from './AthenaChatProposals';
import { AthenaChatStreamingTurn } from './AthenaChatStreamingTurn';
import { AthenaChatTranscript } from './AthenaChatTranscript';
import type { TurnSummaryJumpTarget } from './AthenaChatMessageRow';
import { useAthenaChatSession } from './athenaChatSession';

export function AthenaChatBody({ compact }: { compact: boolean }) {
  const { t } = useTranslation();
  const s = useAthenaChatSession();
  const hasProactive = useCompanionStore((st) => st.proactive.length > 0);

  const approvalsAnchorRef = useRef<HTMLDivElement>(null);
  const chatCardsAnchorRef = useRef<HTMLDivElement>(null);
  const handleJumpSummary = useCallback((target: TurnSummaryJumpTarget) => {
    if (target === 'approvals' || target === 'chatCards') {
      const el =
        target === 'approvals' ? approvalsAnchorRef.current : chatCardsAnchorRef.current;
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    // Both 'dashboard' and 'cockpit' route to Home → Cockpit; the dedicated
    // Dashboard tab was retired and Cockpit is the dynamic dashboard surface.
    const sys = useSystemStore.getState();
    sys.setSidebarSection('home');
    sys.setHomeTab('cockpit');
  }, []);

  // RecallStrip stage 2 / brain-link chips: open the Brain Viewer pinned to a
  // memory id, which paints itself over the transcript.
  const handleOpenInBrain = useCallback((kind: BrainKind, id: string) => {
    useCompanionStore.getState().setBrainView({ open: true, kind, id });
  }, []);

  const showHero =
    s.initialized && s.messages.length === 0 && !s.streaming && !hasProactive;

  return (
    <div className="flex flex-row flex-1 min-h-0">
      <div className="relative flex flex-col flex-1 min-w-0">
        <div className="relative flex-1 min-h-0 flex flex-col">
          <div
            ref={s.scrollRef}
            className={`flex-1 overflow-y-auto scrollbar-thin companion-scroll ${
              compact ? 'px-2.5 py-2.5 space-y-1.5' : 'px-5 py-5 space-y-3'
            }`}
          >
            {/* Earlier page in flight. Above the transcript so it reads as
                "there is more up here"; no label — the position says it. */}
            {s.loadingOlder && (
              <div className="flex justify-center py-1" aria-hidden="true">
                <LoadingSpinner size="sm" />
              </div>
            )}
            {!s.initialized && !s.initError && (
              <div className="flex items-center gap-3 text-foreground typo-body">
                <LoadingSpinner size="sm" />
                <span>{t.plugins.companion.initializing}</span>
              </div>
            )}
            {s.initError && (
              <div className="rounded-card border border-rose-500/30 bg-rose-500/10 px-3 py-2 typo-body text-rose-400">
                {t.plugins.companion.init_failed}: {s.initError}
              </div>
            )}
            <AthenaChatAlerts onEngage={s.send} />
            {showHero && (
              <WelcomeHero onPick={s.send} disabled={!s.initialized || s.streaming} />
            )}
            <AthenaChatTranscript
              messages={s.transcriptWindow.visible}
              offset={s.transcriptWindow.hiddenCount}
              hiddenCount={s.transcriptWindow.hiddenCount}
              onShowEarlier={s.showEarlier}
              compact={compact}
              streaming={s.streaming}
              interactive={s.initialized}
              onOpenInBrain={handleOpenInBrain}
              onJumpSummary={handleJumpSummary}
              onSend={s.send}
            />
            <AthenaChatLiveRegion />
            <AthenaChatStreamingTurn
              compact={compact}
              messageCount={s.messages.length}
              lastStreamEventAtRef={s.lastStreamEventAtRef}
              onInterrupt={s.interrupt}
              onOpenInBrain={handleOpenInBrain}
            />
            <AthenaChatApprovals ref={approvalsAnchorRef} />
            <AthenaChatCards ref={chatCardsAnchorRef} />
            <AthenaChatErrorNotice onSend={s.send} />
          </div>
          <AthenaChatJumpToLatest visible={!s.atBottom} onClick={s.scrollToBottom} />
        </div>
        <AthenaChatFooter
          compact={compact}
          interactive={s.initialized}
          streaming={s.streaming}
          brainOpen={s.brainOpen}
          onSend={s.send}
          onSendOrQueue={s.sendOrQueue}
        />
        {s.brainOpen && (
          <BrainViewer
            onClose={() =>
              useCompanionStore
                .getState()
                .setBrainView({ open: false, kind: null, id: null })
            }
          />
        )}
      </div>
      {/* Inner side-panel slot, left of the toolbar rail. NOT wrapped in
          `Collapse`: that primitive animates HEIGHT (the grid 0fr→1fr trick),
          which is the wrong axis for a side rail and — because the child then
          sizes to a grid row — also defeats the panel's full-height stretch.
          The rail animates its own width instead, and compact simply drops it
          while the whole window is already animating narrower. */}
      {!compact && <FleetStatsSidePanel />}
      {/* Compact hides the rail entirely so the shrunk panel is chat and
          nothing else; the expand handle it normally hosts moves to the panel
          edge (see AthenaChatCompactHandle). */}
      {compact ? <AthenaChatCompactHandle /> : <CompanionToolbar />}
    </div>
  );
}
