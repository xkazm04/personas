import { useCallback, useState } from 'react';
import { FileDown } from 'lucide-react';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import {
  companionExportConversationLog,
  companionListRecentMessages,
} from '@/api/companion';
import { useCompanionStore } from './companionStore';
import { buildConversationLogMarkdown, buildLogFileStem } from './devConversationLog';

/**
 * Dev-only header button: dump the active Athena conversation (messages
 * plus the session-scoped tool trail / plan / summaries / recall /
 * autonomous-actions ledger) into the gitignored
 * `logs/athena-conversations/` directory for reflective development.
 *
 * The component carries no environment gate itself — the call site in
 * `CompanionPanel`'s header renders it behind `devModeAvailable`.
 */
export function DevConversationLogButton() {
  const { t, tx } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const [busy, setBusy] = useState(false);

  const onExport = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const s = useCompanionStore.getState();
      // Prefer the freshest full transcript from the backend (the store
      // may hold a shorter window); fall back to the store on error.
      let messages = s.messages;
      try {
        messages = await companionListRecentMessages(500, s.activeConversationId);
      } catch (e) {
        // Store snapshot is an acceptable fallback for a dev dump.
        silentCatch('DevConversationLogButton:listRecent')(e);
      }
      const markdown = buildConversationLogMarkdown({
        conversationId: s.activeConversationId,
        exportedAt: new Date(),
        messages,
        narrationByEpisodeId: s.narrationByEpisodeId,
        stepsByEpisodeId: s.stepsByEpisodeId,
        turnSummaryByEpisodeId: s.turnSummaryByEpisodeId,
        recallByEpisodeId: s.recallByEpisodeId,
        athenaActions: s.athenaActions,
      });
      const stem = buildLogFileStem(s.activeConversationId, new Date());
      const path = await companionExportConversationLog(stem, markdown);
      // 30s: the path is the point — a default-duration toast loses it.
      addToast(tx(t.plugins.companion.dev_dump_log_saved, { path }), 'success', 30_000);
    } catch (e) {
      toastCatch('DevConversationLogButton', t.plugins.companion.dev_dump_log_failed)(e);
    } finally {
      setBusy(false);
    }
  }, [busy, addToast, t, tx]);

  return (
    <button
      type="button"
      onClick={() => void onExport()}
      disabled={busy}
      data-testid="companion-dev-dump-log"
      className="p-1.5 rounded-interactive text-foreground hover:text-foreground hover:bg-foreground/5 transition-colors focus-ring disabled:opacity-50"
      aria-label={t.plugins.companion.dev_dump_log}
      title={t.plugins.companion.dev_dump_log}
    >
      <FileDown className="w-4 h-4" />
    </button>
  );
}
