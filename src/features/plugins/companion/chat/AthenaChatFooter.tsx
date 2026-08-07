/**
 * AthenaChatFooter — everything below the scroll region: in-flight tasks,
 * queued messages, quick replies, and the composer.
 *
 * The two deterministic actions (analyze fleet / daily brief) deliberately
 * bypass the chat turn: they pre-gather their inputs server-side and spawn a
 * proactive turn, so Athena can't shortcut to an inline read or reach for the
 * wrong connector.
 */

import { companionAnalyzeFleet, companionDailyBrief } from '@/api/companion';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import { ActivityTray } from '../ActivityTray';
import { Composer } from '../Composer';
import { QueuedMessages } from '../QueuedMessages';
import { QuickReplies } from '../QuickReplies';
import { useCompanionStore } from '../companionStore';

export function AthenaChatFooter({
  compact,
  interactive,
  streaming,
  brainOpen,
  onSend,
  onSendOrQueue,
}: {
  compact: boolean;
  /** Session is initialized — gates every input affordance. */
  interactive: boolean;
  streaming: boolean;
  brainOpen: boolean;
  onSend: (text: string) => void;
  onSendOrQueue: (text: string, nonce: string) => void;
}) {
  const { t } = useTranslation();
  const quickReplies = useCompanionStore((s) => s.quickReplies);

  return (
    <>
      <ActivityTray />
      <QueuedMessages />
      <QuickReplies
        options={quickReplies}
        disabled={!interactive || streaming}
        // The picked text becomes the user's next turn; the send pipeline
        // handles persistence, the reply, and clearing the chip set.
        onPick={onSend}
      />
      <Composer
        // Async-UX phase 4: the composer is intentionally NOT disabled while
        // streaming — mid-turn input routes through sendOrQueue (interrupt vs
        // queue) instead of being blocked.
        disabled={!interactive || brainOpen}
        compact={compact}
        onSend={onSendOrQueue}
        onAnalyzeFleet={() => {
          void companionAnalyzeFleet().catch(silentCatch('companion_analyze_fleet'));
          useToastStore
            .getState()
            .addToast(t.plugins.companion.analyze_fleet_started, 'success');
        }}
        onDailyBrief={() => {
          void companionDailyBrief().catch(silentCatch('companion_daily_brief'));
          useToastStore
            .getState()
            .addToast(t.plugins.companion.daily_brief_started, 'success');
        }}
      />
    </>
  );
}
