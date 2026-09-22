/**
 * Nested-layer panes every two-layer variant shares.
 *
 * - `ModesPane`: the header's old toggles and strips (cadence, boldness, dev
 *   mode + ledger, daily goals) plus the toolbar rail (brain, voice,
 *   connectors, settings), each at a readable size instead of a 16px glyph.
 * - `TurnPane`: what sits behind one turn: her recall, her plan, the jobs she
 *   started, and every machine row as the app's own system notes.
 * - `LiveLine`: the working beat and live plan under the conversation.
 */

import { useCallback } from 'react';
import { Wrench } from 'lucide-react';
import type { BrainKind } from '@/api/companion';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { CompanionToolbar } from '../../CompanionToolbar';
import { DailyGoalsBar } from '../../DailyGoalsBar';
import { DevConversationLogButton } from '../../DevConversationLogButton';
import { DevOpLedger } from '../../DevOpLedger';
import { FleetBoldnessDial } from '../../FleetBoldnessDial';
import { OperationalThread } from '../../OperationalThread';
import { RecallStrip } from '../../RecallStrip';
import { TypingDots } from '../../TypingDots';
import { WakeCadence } from '../../WakeCadence';
import { useCompanionStore } from '../../companionStore';
import { AthenaChatMessageJobs } from '../AthenaChatMessageJobs';
import { AthenaChatMessageRow } from '../AthenaChatMessageRow';
import { AthenaChatSleepButton } from '../AthenaChatSleepButton';
import { setDevMode } from '../athenaChatActions';
import type { Turn } from './exchange';
import { NEXT_COPY as C } from './nextCopy';

const noop = () => {};

export function PaneTitle({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div className="mb-5">
      <p className="typo-label uppercase tracking-wider text-primary">{kicker}</p>
      <h2 className="typo-section-title text-foreground mt-1">{title}</h2>
    </div>
  );
}

export function ModesPane() {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const autonomous = useSystemStore((s) => s.companionAutonomousMode);
  const devMode = useSystemStore((s) => s.companionDevMode);
  const devAvailable = useCompanionStore((s) => s.devModeAvailable);
  return (
    <div className="flex gap-6 min-h-0">
      <div className="flex-1 min-w-0 space-y-4">
        <PaneTitle kicker={C.modes} title={autonomous ? c.autonomous_toggle_off : c.autonomous_toggle_on} />
        {autonomous && (
          <div className="rounded-card border border-foreground/10 overflow-hidden divide-y divide-foreground/10">
            <WakeCadence />
            <FleetBoldnessDial />
          </div>
        )}
        {devAvailable && (
          <div className="rounded-card border border-status-warning/25 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2">
              <button
                type="button"
                onClick={() => setDevMode(!devMode)}
                aria-pressed={devMode}
                data-testid="companion-toggle-dev-mode"
                className={`inline-flex items-center gap-2 rounded-interactive px-2.5 py-1 typo-body focus-ring ${
                  devMode ? 'bg-status-warning/15 text-status-warning' : 'text-foreground hover:bg-foreground/[0.05]'
                }`}
              >
                <Wrench className="w-4 h-4" aria-hidden />
                {devMode ? c.dev_toggle_off : c.dev_toggle_on}
              </button>
              <span className="ml-auto flex items-center gap-1">
                <DevConversationLogButton />
                <AthenaChatSleepButton />
              </span>
            </div>
            {devMode && <DevOpLedger />}
            <DailyGoalsBar />
          </div>
        )}
      </div>
      <div className="shrink-0 rounded-card border border-foreground/10 flex">
        <CompanionToolbar />
      </div>
    </div>
  );
}

export function TurnPane({ turn }: { turn: Turn }) {
  const lastReply = turn.replies[turn.replies.length - 1];
  const recall = useCompanionStore((s) => (lastReply ? s.recallByEpisodeId[lastReply.id] : undefined));
  const steps = useCompanionStore((s) => (lastReply ? s.stepsByEpisodeId[lastReply.id] : undefined));
  const jobIds = useCompanionStore((s) => (lastReply ? s.connectorJobIdsByEpisodeId[lastReply.id] : undefined));
  const openInBrain = useCallback((kind: BrainKind, id: string) => {
    useCompanionStore.getState().setBrainView({ open: true, kind, id });
  }, []);
  return (
    <div className="space-y-3 max-w-[96ch]">
      <PaneTitle kicker={C.turnDetail} title={turn.ask?.content.slice(0, 120) ?? C.autonomousTurn} />
      {recall && <RecallStrip preview={recall} onOpenInBrain={openInBrain} />}
      {steps && steps.length > 0 && <OperationalThread steps={steps} />}
      {jobIds && <AthenaChatMessageJobs jobIds={jobIds} />}
      {turn.machine.map((m, i) => (
        <AthenaChatMessageRow
          key={m.id}
          message={{ id: m.id, role: 'system', content: m.content, createdAt: turn.createdAt }}
          index={i}
          compact={false}
          groupStart
          groupEnd
          daySepLabel={null}
          recall={undefined}
          steps={undefined}
          summary={undefined}
          jobIds={[]}
          isLastAssistant={false}
          priorUserMessage=""
          streaming={false}
          interactive={false}
          onOpenInBrain={openInBrain}
          onJumpSummary={noop}
          onSend={noop}
        />
      ))}
    </div>
  );
}

export function LiveLine() {
  const { t } = useTranslation();
  const streaming = useCompanionStore((s) => s.streaming);
  const beat = useCompanionStore((s) => s.streamingBeat);
  const steps = useCompanionStore((s) => s.streamingSteps);
  if (!streaming) return null;
  return (
    <div className="mx-auto w-full max-w-[74ch] mt-6 space-y-2" aria-live="polite">
      <div className="flex items-center gap-3">
        <span className="typo-label uppercase tracking-wider text-primary">{C.athena}</span>
        <span className="typo-body text-foreground/80">{beat ?? t.plugins.companion.working}</span>
        <TypingDots />
      </div>
      {steps.length > 0 && <OperationalThread steps={steps} />}
    </div>
  );
}
