/**
 * NextComposer — the composer composition the owner picked from Marginalia:
 * one centred measure shared with the conversation, quick replies above the
 * box. No hint legend: the one non-obvious key (Alt+W) sits beside the
 * decision indicators in the usage panel.
 *
 * It is also half of how the two layers talk to each other. When the nested
 * layer has an item in focus, the composer shows an "About: …" chip and every
 * message sent carries a one-line `[re: …]` prefix, so Athena answers about the
 * card the operator is looking at without either side copying text across.
 */

import { X } from 'lucide-react';
import { companionAnalyzeFleet, companionDailyBrief } from '@/api/companion';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import { Composer } from '../../Composer';
import { QueuedMessages } from '../../QueuedMessages';
import { QuickReplies } from '../../QuickReplies';
import { useCompanionStore } from '../../companionStore';
import { NEXT_COPY as C } from './nextCopy';
import type { WorkItem } from './useWorkforce';

export function aboutPrefix(item: WorkItem): string {
  return `[re: ${C.kind[item.kind].toLowerCase()} "${item.title.slice(0, 80)}"] `;
}

export function NextComposer({
  interactive,
  streaming,
  onSend,
  onSendOrQueue,
  about,
  onClearAbout,
  measure = 'reading',
}: {
  interactive: boolean;
  streaming: boolean;
  onSend: (text: string) => void;
  onSendOrQueue: (text: string, nonce: string) => void;
  about?: WorkItem | null;
  onClearAbout?: () => void;
  measure?: 'reading' | 'wide';
}) {
  const { t } = useTranslation();
  const quickReplies = useCompanionStore((s) => s.quickReplies);

  return (
    <div className="shrink-0 border-t border-foreground/10 bg-background/60 px-6 pt-2 pb-3">
      <div className={`mx-auto w-full ${measure === 'reading' ? 'max-w-[74ch]' : 'max-w-[96ch]'} flex flex-col gap-2`}>
        <QueuedMessages />
        {!streaming && (
          <QuickReplies options={quickReplies} disabled={!interactive || streaming} onPick={onSend} />
        )}
        {about && (
          <div className="flex items-center gap-2 self-start rounded-full border border-primary/35 bg-primary/10 pl-3 pr-1 py-0.5 typo-caption text-foreground max-w-full">
            <span className="text-primary font-semibold shrink-0">{C.about}:</span>
            <span className="truncate">{C.kind[about.kind]} · {about.title}</span>
            <button
              type="button"
              onClick={onClearAbout}
              aria-label={C.clearAbout}
              className="p-1 rounded-full hover:bg-foreground/10 focus-ring"
            >
              <X className="w-3.5 h-3.5" aria-hidden />
            </button>
          </div>
        )}
        <Composer
          disabled={!interactive}
          onSend={(text, nonce) => onSendOrQueue(about ? aboutPrefix(about) + text : text, nonce)}
          onAnalyzeFleet={() => {
            void companionAnalyzeFleet().catch(silentCatch('companion_analyze_fleet'));
            useToastStore.getState().addToast(t.plugins.companion.analyze_fleet_started, 'success');
          }}
          onDailyBrief={() => {
            void companionDailyBrief().catch(silentCatch('companion_daily_brief'));
            useToastStore.getState().addToast(t.plugins.companion.daily_brief_started, 'success');
          }}
        />
      </div>
    </div>
  );
}
