import { resolveError } from '@/lib/errors/errorRegistry';
import { extractMessage } from '@/lib/silentCatch';

/**
 * The sentence a Lifecycle surface shows for a failed call. An IPC rejection is
 * a serialized AppError OBJECT (`{ error, kind }`), never an `Error`, so the old
 * `err instanceof Error ? err.message : String(err)` handed the registry
 * "[object Object]" and every classified failure (a timeout, a missing
 * project) read as the generic fallback. `extractMessage` reads the envelope.
 */
export function errorText(err: unknown): string {
  return resolveError(extractMessage(err)).message;
}
