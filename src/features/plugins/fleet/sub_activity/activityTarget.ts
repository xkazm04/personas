// activityTarget — where an Activity feed row goes when you click it.
//
// The Activity tab's own stated question is "which sessions touched auth.rs?",
// and it answered it with inert cards: the search found the row and then the
// operator had to go and find the session by hand. A search hit is a door.
//
// A transcript row carries its `claudeSessionId` — the JSONL filename stem —
// which is exactly the key the live registry binds its sessions by, so the join
// needs no path parsing and no cwd guessing. Two destinations, decided by
// whether that key is still in the registry:
//
//   • bound   → the live session, focused in the Sessions tab;
//   • unbound → the transcript rollup, which outlives the PTY, so a finished
//               run is still readable rather than being a dead row.

import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { FleetTranscriptSummary } from '@/lib/bindings/FleetTranscriptSummary';

export type ActivityTarget =
  /** A session in the registry: focus it on the Sessions tab. */
  | { kind: 'session'; sessionId: string }
  /** No registry row: read the transcript's own rollup. */
  | { kind: 'insights'; claudeSessionId: string };

export function resolveActivityTarget(
  row: Pick<FleetTranscriptSummary, 'claudeSessionId'>,
  sessions: readonly FleetSession[],
): ActivityTarget {
  const live = sessions.find((s) => s.claudeSessionId === row.claudeSessionId);
  // A hibernated or exited row is STILL a registry row: it can be woken, or at
  // least inspected where the operator expects to find it. "Bound" is about the
  // registry knowing the session, not about a process being alive.
  if (live) return { kind: 'session', sessionId: live.id };
  return { kind: 'insights', claudeSessionId: row.claudeSessionId };
}
