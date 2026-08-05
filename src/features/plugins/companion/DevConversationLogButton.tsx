import { useCallback, useState } from 'react';
import { FileDown } from 'lucide-react';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import {
  companionExportConversationLog,
  companionListRecentMessages,
  type CompanionMessage,
} from '@/api/companion';
import { useCompanionStore } from './companionStore';
import { buildConversationLogMarkdown, buildLogFileStem } from './devConversationLog';
import { cursorFromMessages, fetchAllOlderMessages } from './useTranscriptPages';
import { parseSidecars } from './turnSidecars';
import { fetchSidecarsFor } from './useTurnSidecars';

/**
 * The freshest FULL conversation: the newest window plus every older
 * keyset page. Falls back to whatever we already have on any failure —
 * a partial dump beats no dump for a dev affordance.
 */
async function fetchFullTranscript(
  conversationId: string,
  fallback: CompanionMessage[],
): Promise<CompanionMessage[]> {
  let newest: CompanionMessage[];
  try {
    newest = await companionListRecentMessages(500, conversationId);
  } catch (e) {
    silentCatch('DevConversationLogButton:listRecent')(e);
    return fallback;
  }
  const cursor = cursorFromMessages(newest);
  if (!cursor) return newest;
  try {
    const older = await fetchAllOlderMessages(conversationId, cursor);
    return [...older, ...newest];
  } catch (e) {
    silentCatch('DevConversationLogButton:pageWalk')(e);
    return newest;
  }
}

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
      // Prefer the freshest FULL transcript from the backend (the store
      // only holds the loaded window); fall back to the store on error.
      const messages = await fetchFullTranscript(s.activeConversationId, s.messages);

      // Side channels: the store's live maps only cover this session's
      // turns, so pull persisted sidecars for every assistant message in
      // the dump. Live entries win on merge; a failure just thins the dump.
      let hydrated = parseSidecars([]);
      const episodeIds = messages.filter((m) => m.role === 'assistant').map((m) => m.id);
      if (episodeIds.length > 0) {
        try {
          hydrated = parseSidecars(await fetchSidecarsFor(episodeIds));
        } catch (e) {
          silentCatch('DevConversationLogButton:sidecars')(e);
        }
      }

      const markdown = buildConversationLogMarkdown({
        conversationId: s.activeConversationId,
        exportedAt: new Date(),
        messages,
        narrationByEpisodeId: { ...hydrated.narrationByEpisodeId, ...s.narrationByEpisodeId },
        stepsByEpisodeId: { ...hydrated.stepsByEpisodeId, ...s.stepsByEpisodeId },
        turnSummaryByEpisodeId: {
          ...hydrated.turnSummaryByEpisodeId,
          ...s.turnSummaryByEpisodeId,
        },
        recallByEpisodeId: { ...hydrated.recallByEpisodeId, ...s.recallByEpisodeId },
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
