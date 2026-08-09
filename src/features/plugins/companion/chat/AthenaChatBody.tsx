/**
 * AthenaChatBody — the open panel's interior: scroll region, footer, side
 * panel and toolbar rail.
 *
 * Layout only. The listening half of the session lives in `athenaChatEngine`,
 * mounted by the always-on panel shell; the view half (scroll, transcript
 * window, paging) is `useAthenaChatView`. Leaves read their own narrow store
 * slices rather than taking props — the old panel threaded ~25 props down from
 * the top, which made a single high-frequency value re-render everything under
 * it.
 *
 * `ready` stages the expensive interior behind the open animation (see
 * `athenaChatMount`). Only rendering waits: nothing behind that gate listens
 * for anything, so a turn landing mid-open is already in the store by the time
 * the transcript exists to show it.
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
import { AthenaChatSkeleton } from './AthenaChatSkeleton';
import { AthenaChatStreamingTurn } from './AthenaChatStreamingTurn';
import { AthenaChatTranscript } from './AthenaChatTranscript';
import type { TurnSummaryJumpTarget } from './AthenaChatMessageRow';
import type { AthenaChatEngine } from './athenaChatEngine';
import { useAthenaChatView } from './athenaChatSession';

export function AthenaChatBody({
  compact,
  engine,
  ready,
  chromeReady,
}: {
  compact: boolean;
  engine: AthenaChatEngine;
  /** The open animation has landed — the conversation may mount. */
  ready: boolean;
  /** Second wave — the peripheral chrome may mount. See `athenaChatMount`. */
  chromeReady: boolean;
}) {
  const { t } = useTranslation();
  const view = useAthenaChatView(engine);
  const brainOpen = useCompanionStore((s) => s.brainView.open);
  const hasProactive = useCompanionStore((st) => st.proactive.length > 0);

  const approvalsAnchorRef = useRef<HTMLDivElement>(null);
  const chatCardsAnchorRef = useRef<HTMLDivElement>(null);
  const handleJumpSummary = useCallback((target: TurnSummaryJumpTarget) => {
    if (target === 'approvals' || target === 'chatCards') {
      // The turn summary counts what a turn dispatched, but by click time the
      // approval may already be resolved (empty `approvals`) or now render as a
      // durable chat card. Route to whichever section actually has content so
      // the jump never lands on a blank region; if neither has anything, do
      // nothing rather than scroll the user to an empty window.
      const store = useCompanionStore.getState();
      const approvalsHas = store.approvals.length > 0;
      const cardsHas = store.chatCards.length > 0;
      const el =
        target === 'approvals'
          ? approvalsHas
            ? approvalsAnchorRef.current
            : cardsHas
              ? chatCardsAnchorRef.current
              : null
          : cardsHas
            ? chatCardsAnchorRef.current
            : approvalsHas
              ? approvalsAnchorRef.current
              : null;
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
    engine.initialized && engine.messages.length === 0 && !engine.streaming && !hasProactive;

  return (
    <div className="flex flex-row flex-1 min-h-0">
      <div className="relative flex flex-col flex-1 min-w-0">
        <div className="relative flex-1 min-h-0 flex flex-col">
          {ready ? (
            <div
              ref={view.scrollRef}
              className={`flex-1 overflow-y-auto scrollbar-thin companion-scroll ${
                compact ? 'px-2.5 py-2.5 space-y-1.5' : 'px-5 py-5 space-y-3'
              }`}
            >
              {/* Earlier page in flight. Above the transcript so it reads as
                  "there is more up here"; no label — the position says it. */}
              {view.loadingOlder && (
                <div className="flex justify-center py-1" aria-hidden="true">
                  <LoadingSpinner size="sm" />
                </div>
              )}
              {!engine.initialized && !engine.initError && (
                <div className="flex items-center gap-3 text-foreground typo-body">
                  <LoadingSpinner size="sm" />
                  <span>{t.plugins.companion.initializing}</span>
                </div>
              )}
              {engine.initError && (
                <div className="rounded-card border border-rose-500/30 bg-rose-500/10 px-3 py-2 typo-body text-rose-400">
                  {t.plugins.companion.init_failed}: {engine.initError}
                </div>
              )}
              <AthenaChatAlerts onEngage={engine.send} />
              {showHero && (
                <WelcomeHero
                  onPick={engine.send}
                  disabled={!engine.initialized || engine.streaming}
                />
              )}
              <AthenaChatTranscript
                messages={view.transcriptWindow.visible}
                offset={view.transcriptWindow.hiddenCount}
                hiddenCount={view.transcriptWindow.hiddenCount}
                onShowEarlier={view.showEarlier}
                compact={compact}
                streaming={engine.streaming}
                interactive={engine.initialized}
                onOpenInBrain={handleOpenInBrain}
                onJumpSummary={handleJumpSummary}
                onSend={engine.send}
              />
              <AthenaChatLiveRegion />
              <AthenaChatStreamingTurn
                compact={compact}
                messageCount={engine.messages.length}
                lastStreamEventAtRef={engine.lastStreamEventAtRef}
                onInterrupt={engine.interrupt}
                onOpenInBrain={handleOpenInBrain}
              />
              <AthenaChatApprovals ref={approvalsAnchorRef} />
              <AthenaChatCards ref={chatCardsAnchorRef} />
              <AthenaChatErrorNotice onSend={engine.send} />
            </div>
          ) : (
            <AthenaChatSkeleton compact={compact} />
          )}
          <AthenaChatJumpToLatest visible={ready && !view.atBottom} onClick={view.scrollToBottom} />
        </div>
        <AthenaChatFooter
          compact={compact}
          interactive={engine.initialized}
          streaming={engine.streaming}
          brainOpen={brainOpen}
          onSend={engine.send}
          onSendOrQueue={engine.sendOrQueue}
        />
        {brainOpen && (
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
      {chromeReady && !compact && <FleetStatsSidePanel />}
      {/* Compact hides the rail entirely so the shrunk panel is chat and
          nothing else; the expand handle it normally hosts moves to the panel
          edge (see AthenaChatCompactHandle). */}
      {compact ? <AthenaChatCompactHandle /> : chromeReady && <CompanionToolbar />}
    </div>
  );
}
