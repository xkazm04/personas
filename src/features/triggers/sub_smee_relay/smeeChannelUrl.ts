/** Prefix every Smee channel URL starts with. */
export const SMEE_CHANNEL_PREFIX = 'https://smee.io/';

/**
 * True for a full Smee channel URL (`https://smee.io/<channel>`), judged on the
 * trimmed value because that is what is submitted. The bare root and a root
 * with only slashes are rejected: such a relay is created but never receives
 * the user's webhooks. One predicate for the inline error, the Create button
 * and the submit guard.
 */
export function isValidSmeeChannelUrl(raw: string): boolean {
  const url = raw.trim();
  if (!url.startsWith(SMEE_CHANNEL_PREFIX)) return false;
  return url.slice(SMEE_CHANNEL_PREFIX.length).replace(/\/+$/, '').length > 0;
}
