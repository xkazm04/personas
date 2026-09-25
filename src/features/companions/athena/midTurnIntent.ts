/**
 * Async-UX phase 4 — classify a message the user sent while a turn was
 * still streaming (the composer is never disabled, so this can happen).
 *
 * - `interrupt` — a redirect / stop signal: the in-flight turn should be
 *   cancelled and this message run next.
 * - `queue` — additive or ambiguous: let the current turn finish, then run
 *   this message.
 *
 * The default is `queue`. We only interrupt on a clear redirect opener —
 * destroying running work on an ambiguous message would be the worse
 * failure mode (the user can always hit Stop explicitly).
 */
export function classifyMidTurnIntent(text: string): 'interrupt' | 'queue' {
  const t = text.trim().toLowerCase();
  if (!t) return 'queue';

  // Strong redirect / stop openers → interrupt the current turn.
  const REDIRECT =
    /^(stop\b|wait\b|hold on\b|hold up\b|cancel\b|abort\b|nvm\b|never ?mind\b|actually[,!.\s]|instead[,!.\s]|forget (it|that|this)\b|scratch that\b|no[,.\s!]|don'?t\b)/;
  if (REDIRECT.test(t)) return 'interrupt';

  // Everything else (including explicit additive openers like "and also…",
  // "when you're done…") queues.
  return 'queue';
}
