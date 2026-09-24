import type { ReleaseItemStatus } from '@/data/releases';
import type { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';

/** Guard against `useRevealTracker`'s per-id "already entered" tracking so the
 * one-shot entrance cascade never replays on live-refresh or unrelated
 * re-renders (law 4): only a genuinely new item id fades in on its own. */
export type RevealTracker = ReturnType<typeof useRevealTracker>;

export const statusDot: Record<ReleaseItemStatus, string> = {
  in_progress: 'bg-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.6)]',
  planned: 'bg-foreground/30',
  completed: 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.6)]',
};
