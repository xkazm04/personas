/**
 * PulseDot — the heartbeat glyph.
 *
 *   • <5 min  → green dot with an animate-ping halo (this is "live")
 *   • <1 h    → solid amber dot
 *   • older   → dim grey dot
 *   • never   → hollow ring
 *
 * Intentionally the one place the "live" visual vocabulary lives. The top
 * ticker / toolbar counter were both removed because this dot alone carries
 * enough signal at row level.
 */
import { formatAgo } from './activity';
import type { ActivityEntry } from './types';

export function PulseDot({ activity }: { activity: ActivityEntry | undefined }) {
  const last = activity?.lastTs ?? null;
  const deltaMs = last ? Date.now() - last : Infinity;

  if (deltaMs < 5 * 60 * 1000) {
    return (
      <span className="relative inline-flex w-2.5 h-2.5" aria-label="Active within 5 minutes">
        <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400/60 animate-ping" />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400 shadow shadow-emerald-400/50" />
      </span>
    );
  }
  if (deltaMs < 60 * 60 * 1000) {
    return (
      <span
        className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400 shadow shadow-amber-400/40"
        aria-label="Active within 1 hour"
      />
    );
  }
  if (last !== null) {
    return (
      <span
        className="inline-block w-2.5 h-2.5 rounded-full bg-foreground/30"
        aria-label={`Last fired ${formatAgo(last)} ago`}
      />
    );
  }
  return (
    <span
      className="inline-block w-2.5 h-2.5 rounded-full border border-foreground/25"
      aria-label="Never fired"
    />
  );
}
