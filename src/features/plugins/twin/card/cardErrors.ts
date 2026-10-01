import { resolveError } from '@/lib/errors/errorRegistry';
import { extractMessage } from '@/lib/silentCatch';

/**
 * The text a user should read for a rejected twin command, shown inline where
 * they acted (the import dialog, the export dialog, a proposal card).
 *
 * The registry rewrites the errors it knows. Everything else it answers with
 * the generic fallback, which would hide the backend's own hint ("wrong
 * passphrase", "not built yet"), so an unclassified error keeps its raw text;
 * the same rule as the Browser lanes' `messageOf`. A value that only survived
 * as "[object Object]" is not text and takes the fallback.
 */
export function describeTwinError(err: unknown): string {
  const raw = extractMessage(err);
  const friendly = resolveError(raw);
  if (friendly.category === 'unclassified' && raw.length > 0 && !raw.includes('[object Object]')) return raw;
  return friendly.message;
}
