import { History } from 'lucide-react';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { useTranslation } from '@/i18n/useTranslation';
import { useSequentialReview } from '../useSequentialReview';
import type { DirectorRosterEntry } from '@/api/director';

/**
 * One-click stale sweep — re-reviews every agent whose last verdict is older
 * than the staleness window (>14d). A standing maintenance action in the header
 * that doesn't require the user to first apply the stale filter. Renders nothing
 * when no agent is stale.
 */
export function StaleSweepButton({
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
      variant="secondary"
      size="sm"
      isLoading={running}
      loadingText={tx(t.director.review_filtered_progress, { done: progress ?? 0, total: agents.length })}
      icon={<History className="w-3.5 h-3.5" />}
      title={t.director.stale_sweep_hint}
      onClick={() => run(agents.map((a) => a.personaId))}
      data-testid="director-stale-sweep"
    >
      {tx(t.director.stale_sweep, { count: agents.length })}
    </AsyncButton>
  );
}
