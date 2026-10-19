/**
 * inlineErrorCopy - the sentence an inline error slot shows for a caught
 * rejection.
 *
 * An IPC rejection is a serialized AppError object ({ error, kind, ... }),
 * never an `Error`, so `e instanceof Error ? e.message : String(e)` printed
 * "[object Object]" or dropped the backend's reason. Resolve at render: the
 * registry's translated sentence when it recognises the error, otherwise the
 * backend's own message on purpose (a validation reason such as a name
 * collision is only actionable when the user can read it), and the caller's
 * fallback (or the registry's generic sentence) when the rejection carries no
 * text at all.
 */
import type { Translations } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import { extractMessage } from '@/lib/silentCatch';

export function inlineErrorCopy(t: Translations, raw: unknown, fallback?: string): string {
  const text = extractMessage(raw).trim();
  // extractMessage's last resort for an object with no text field.
  const message = text === '[object Object]' ? '' : text;
  const resolved = resolveErrorTranslated(t, message);
  if (!message) return fallback ?? resolved.message;
  return resolved.category === 'unclassified' ? message : resolved.message;
}
