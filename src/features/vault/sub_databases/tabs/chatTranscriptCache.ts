/**
 * The NL chat transcript outlives the component, because the component does
 * not outlive a tab switch. ChatTab unmounts the moment the user opens Tables,
 * so component state took every generated answer with it -- and this is the
 * most expensive surface in the console, one model call per question.
 *
 * ConsoleTab already keeps its last ten queries this way, for the reason the
 * sql-console golden path gives: the built-in console is a CONTAINMENT
 * feature, and every convenience it lacks is a reason to paste the connection
 * credential into an external client, where the vault stops having custody
 * of it.
 *
 * Memory-only and never localStorage -- a question and its generated SQL can
 * carry the very data the vault is responsible for, so a transcript must not
 * survive the process or reach disk. Keyed by credential, so it carries a
 * ceiling in both directions rather than growing with the vault.
 */
import { createModuleCache } from '@/hooks/utility/data/useModuleSubscription';
import type { ChatMessage } from './ChatMessages';

/** Turns kept per database. A transcript is a convenience, not an archive. */
export const MAX_TRANSCRIPT_TURNS = 40;
/** Databases whose transcripts stay resident before the oldest is evicted. */
export const MAX_TRACKED_CREDENTIALS = 20;

export const transcriptCache = createModuleCache<string, ChatMessage[]>({
  maxSize: MAX_TRACKED_CREDENTIALS,
});

/** Drop every database's transcript. Tests only -- this cache is process-scoped. */
export function __resetChatTranscriptsForTests(): void {
  transcriptCache.clear();
}
