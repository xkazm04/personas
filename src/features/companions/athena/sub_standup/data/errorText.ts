import { resolveError } from '@/lib/errors/errorRegistry';
import { extractMessage, silentCatch } from '@/lib/silentCatch';

/**
 * One inline error line for a failed standup call: the registry's friendly
 * message with the raw cause beside it (a stub's "not implemented: WP1" is the
 * honest answer while the backend lands). Logged once through silentCatch;
 * the page shows it inline, never as a toast (Athena's two-surface doctrine).
 */
export function errorText(context: string, err: unknown): string {
  silentCatch(`StandupPanel.${context}`)(err);
  const raw = extractMessage(err);
  const friendly = resolveError(raw).message;
  return raw && friendly !== raw ? `${friendly} (${raw})` : friendly || raw;
}
