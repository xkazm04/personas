// What the live region says as a Measure moves, from one session view to the
// next: that it started (and how many commands), each command as it finishes
// (concise: "tsc: Passed, 1m 14s."), that a cancel is on its way, and the
// summary once it ended. Null when nothing new happened, so the region keeps
// its last sentence. Pure: the words come in from the caller.
import type { LifecycleCommandProgress } from '@/lib/bindings/LifecycleCommandProgress';
import type { LifecycleMeasureProgress } from '@/lib/bindings/LifecycleMeasureProgress';

import type { MeasurePhase } from './measureSession';

export interface AnnounceView {
  phase: MeasurePhase;
  progress: LifecycleMeasureProgress | null;
}

export interface AnnounceWords {
  preparing: string;
  started: (count: number) => string;
  done: (cmd: LifecycleCommandProgress) => string;
  cancelling: string;
  /** The ended sentence (finished or cancelled, with what changed and the failures). */
  ended: string;
}

function newlyDone(prev: AnnounceView, next: AnnounceView): LifecycleCommandProgress[] {
  const was = new Set((prev.progress?.commands ?? []).filter((c) => c.state === 'done').map((c) => c.commandId));
  return (next.progress?.commands ?? []).filter((c) => c.state === 'done' && !was.has(c.commandId));
}

export function announce(prev: AnnounceView, next: AnnounceView, words: AnnounceWords): string | null {
  if (prev.phase === next.phase && prev.progress === next.progress) return null;
  if (next.phase === 'idle') return null;
  if (next.phase === 'ended') return prev.phase === 'ended' ? null : words.ended;
  const fresh = prev.phase === 'idle' || prev.phase === 'ended';
  if (next.phase === 'preparing') return fresh ? words.preparing : null;
  const parts: string[] = [];
  if (fresh || prev.phase === 'preparing') parts.push(words.started(next.progress?.commands.length ?? 0));
  else parts.push(...newlyDone(prev, next).map(words.done));
  if (next.phase === 'cancelling' && prev.phase !== 'cancelling') parts.push(words.cancelling);
  return parts.length > 0 ? parts.join(' ') : null;
}
