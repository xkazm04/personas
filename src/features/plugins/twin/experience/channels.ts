/**
 * A tone channel as a person reads it. `generic` is the register used
 * everywhere without a channel of its own, so it shows as the caller's
 * translated "everywhere"; any other id is a channel type ("slack", "email")
 * shown with a capital, the way its own product writes it.
 */
export function channelName(channel: string, everywhere: string): string {
  if (channel === 'generic') return everywhere;
  return channel.charAt(0).toUpperCase() + channel.slice(1);
}

/** Count the items in a stored JSON-array column, forgiving anything else. */
export function countItems(raw: string | undefined): number {
  if (!raw) return 0;
  try {
    const parsed: unknown = JSON.parse(raw);
    // The column holds a JSON array of strings; anything else is legacy free
    // text, which counts as one item rather than as a parse failure.
    return Array.isArray(parsed) ? parsed.length : 1;
  } catch {
    return raw.trim() ? 1 : 0;
  }
}
