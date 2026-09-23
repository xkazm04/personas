/**
 * NextHeader — the header clarity the owner liked in Marginalia, rebuilt:
 * who (mark + thread), one status SENTENCE in place of ten glyph toggles, and
 * the two things worth a pill (what waits on you, whether she runs on her own).
 * Everything else (cadence, boldness, dev mode, goals, tools, reset) lives one
 * layer down behind "More", where it has room to explain itself.
 */

import { useState } from 'react';
import { Inbox, Settings2, Square, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { useSystemStore } from '@/stores/systemStore';
import { ConversationSwitcher } from '../../ConversationSwitcher';
import { TypingDots } from '../../TypingDots';
import { useCompanionStore } from '../../companionStore';
import { resetConversation, setAutonomousMode } from '../athenaChatActions';
import { NEXT_COPY as C } from './nextCopy';
import type { Workforce } from './useWorkforce';

export function NextHeader({
  workforce,
  onOpenWaiting,
  onOpenModes,
  onInterrupt,
  waitingActive,
  modesActive,
}: {
  workforce: Workforce;
  onOpenWaiting: () => void;
  onOpenModes: () => void;
  onInterrupt: () => void;
  waitingActive: boolean;
  modesActive: boolean;
}) {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const streaming = useCompanionStore((s) => s.streaming);
  const beat = useCompanionStore((s) => s.streamingBeat);
  const autonomous = useSystemStore((s) => s.companionAutonomousMode);
  const orbEnabled = useSystemStore((s) => s.companionOrbEnabled);
  const [resetOpen, setResetOpen] = useState(false);

  const tally = { working: 0, needs: 0, stale: 0 };
  for (const lane of workforce.lanes) {
    for (const b of lane.bullets) {
      if (b.tone === 'working') tally.working++;
      else if (b.tone === 'needs_you') tally.needs++;
      else if (b.tone === 'stale') tally.stale++;
    }
  }

  return (
    <header className="relative flex items-center gap-3 h-14 px-4 text-foreground border-b border-foreground/10 bg-secondary/40 shrink-0">
      <img
        src="/athena/athena_baseline.jpg"
        alt=""
        aria-hidden
        draggable={false}
        className={`w-8 h-8 rounded-full object-cover select-none ${autonomous ? 'ring-2 ring-primary/60' : 'ring-1 ring-primary/25'}`}
      />
      <ConversationSwitcher />
      <div
        className={`flex-1 min-w-0 flex items-center gap-2 h-9 px-3 rounded-full border typo-body transition-colors ${
          streaming ? 'border-status-info/30 bg-status-info/10 text-foreground' : 'border-transparent text-foreground/75'
        }`}
        role="status"
        aria-live="polite"
      >
        {streaming ? (
          <>
            <span className="font-semibold">{C.working}</span>
            <span className="truncate text-foreground/80">{beat ?? c.working}</span>
            <TypingDots />
            <button
              type="button"
              onClick={onInterrupt}
              data-testid="companion-stop-turn"
              className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-status-error/15 text-status-error px-2.5 py-0.5 typo-label hover:bg-status-error/25 focus-ring"
            >
              <Square className="w-3 h-3" fill="currentColor" aria-hidden />
              {c.stop_turn}
            </button>
          </>
        ) : (
          <>
            <span className="w-2 h-2 rounded-full bg-muted-dark shrink-0" aria-hidden />
            <span className="font-semibold text-foreground">{C.idle}</span>
            <span className="truncate">
              {' · '}
              <span className="text-status-info">{C.fleetWorking(tally.working)}</span>
              {tally.needs > 0 && <>, <span className="text-status-warning">{C.fleetWaiting(tally.needs)}</span></>}
              {tally.stale > 0 && <>, <span className="text-status-error">{C.fleetStale(tally.stale)}</span></>}
            </span>
          </>
        )}
      </div>
      <button
        type="button"
        onClick={onOpenWaiting}
        aria-pressed={waitingActive}
        className={`inline-flex items-center gap-2 h-9 px-3 rounded-full border typo-body focus-ring transition-colors ${
          waitingActive ? 'border-primary/50 bg-primary/15 text-foreground' : 'border-foreground/15 text-foreground/85 hover:bg-foreground/[0.05]'
        }`}
      >
        <Inbox className="w-4 h-4" aria-hidden />
        {C.waitingOnYou}
        {workforce.counts.waiting > 0 && (
          <span className="min-w-5 h-5 px-1.5 rounded-full bg-status-error/20 text-status-error typo-label grid place-items-center">
            {workforce.counts.waiting}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={() => setAutonomousMode(!autonomous)}
        aria-pressed={autonomous}
        data-testid="companion-toggle-autonomous"
        className={`inline-flex items-center gap-2 h-9 px-3 rounded-full border typo-body focus-ring transition-colors ${
          autonomous ? 'border-primary/45 bg-primary/10 text-foreground' : 'border-foreground/15 text-foreground/75 hover:bg-foreground/[0.05]'
        }`}
      >
        <span className={`relative w-7 h-4 rounded-full transition-colors ${autonomous ? 'bg-primary' : 'bg-foreground/20'}`} aria-hidden>
          <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-background transition-transform ${autonomous ? 'translate-x-3' : ''}`} />
        </span>
        {autonomous ? C.autonomyOn : C.autonomyOff}
      </button>
      <button
        type="button"
        onClick={onOpenModes}
        aria-pressed={modesActive}
        aria-label={C.modes}
        className={`p-2 rounded-interactive focus-ring ${modesActive ? 'bg-primary/15 text-primary' : 'text-foreground/75 hover:bg-foreground/[0.06]'}`}
      >
        <Settings2 className="w-4 h-4" aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => setResetOpen(true)}
        className="px-2 h-8 rounded-interactive typo-caption text-foreground/70 hover:bg-foreground/[0.06] focus-ring"
        data-testid="companion-reset"
      >
        {c.reset}
      </button>
      <button
        type="button"
        onClick={() => useCompanionStore.getState().setState(orbEnabled ? 'minimized' : 'collapsed')}
        aria-label={t.common.close}
        data-testid="companion-close"
        className="p-2 rounded-interactive text-foreground/75 hover:bg-foreground/[0.06] focus-ring"
      >
        <X className="w-4 h-4" aria-hidden />
      </button>
      {resetOpen && (
        <ConfirmDialog
          title={c.reset_confirm_title}
          body={c.reset_confirm_body}
          danger
          confirmLabel={c.reset_confirm_action}
          onConfirm={async () => {
            await resetConversation();
            setResetOpen(false);
          }}
          onCancel={() => setResetOpen(false)}
        />
      )}
    </header>
  );
}
