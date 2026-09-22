import { Play } from 'lucide-react';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { useTranslation } from '@/i18n/useTranslation';
import { useSequentialReview } from '../useSequentialReview';
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
  const { run, progress, running } = useSequentialReview(onReview);

  if (agents.length === 0) return null;

  return (
    <AsyncButton
      variant="accent"
      accentColor="violet"
      size="sm"
      isLoading={running}
      loadingText={tx(t.director.review_filtered_progress, { done: progress ?? 0, total: agents.length })}
      icon={<Play className="w-3.5 h-3.5" />}
      onClick={() => run(agents.map((a) => a.personaId))}
      data-testid="director-review-filtered"
    >
      {tx(t.director.review_filtered, { count: agents.length })}
    </AsyncButton>
  );
}
