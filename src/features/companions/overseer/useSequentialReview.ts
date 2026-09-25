import { useState } from 'react';

/**
 * Drives a sequential batch of Director reviews (each is a real, minutes-long
 * LLM run) with inline progress. Shared by the "Review these N" filtered action
 * and the stale-sweep button. `run` snapshots the ids it's given, so a portfolio
 * refresh between reviews can't reshuffle the set mid-flight.
 */
export function useSequentialReview(onReview: (personaId: string) => Promise<void>) {
  const [progress, setProgress] = useState<number | null>(null);
  const running = progress !== null;

  const run = async (ids: string[]) => {
    if (ids.length === 0 || running) return;
    setProgress(0);
    try {
      for (let i = 0; i < ids.length; i++) {
        await onReview(ids[i]!);
        setProgress(i + 1);
      }
    } finally {
      setProgress(null);
    }
  };

  return { run, progress, running };
}
