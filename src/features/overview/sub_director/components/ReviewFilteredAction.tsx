import { useState } from 'react';
import { Play } from 'lucide-react';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { useTranslation } from '@/i18n/useTranslation';
import type { DirectorRosterEntry } from '@/api/director';

/**
 * "Review these N" — runs the Director over exactly the agents the active facet
 * filter narrowed the table to, sequentially (each run is a real LLM pass), with
 * inline progress. Closes the triage → act loop: filter to declining / stale /
 * low agents, then coach the whole set in one click. Renders nothing when the
 * filtered set is empty.
 */
export function ReviewFilteredAction({
  agents,
  onReview,
}: {
  agents: DirectorRosterEntry[];
  onReview: (personaId: string) => Promise<void>;
}) {
  const { t, tx } = useTranslation();
  const [progress, setProgress] = useState<number | null>(null);

  if (agents.length === 0) return null;
  const running = progress !== null;

  const run = async () => {
    // Snapshot the ids up-front: each review refreshes the portfolio (which can
    // reshuffle the live roster), but we always coach the originally-filtered set.
    const ids = agents.map((a) => a.personaId);
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

  return (
    <AsyncButton
      variant="accent"
      accentColor="violet"
      size="sm"
      isLoading={running}
      loadingText={tx(t.director.review_filtered_progress, { done: progress ?? 0, total: agents.length })}
      icon={<Play className="w-3.5 h-3.5" />}
      onClick={run}
      data-testid="director-review-filtered"
    >
      {tx(t.director.review_filtered, { count: agents.length })}
    </AsyncButton>
  );
}
