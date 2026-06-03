import { useMemo, useState } from 'react';
import { Wand2, ArrowUpRight, Check } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { aggregateMatrixResults } from '../../libs/labAggregation';
import type { LabMatrixResult } from '@/lib/bindings/LabMatrixResult';
import { useTranslation } from '@/i18n/useTranslation';

interface ImproveReadyCalloutProps {
  /** Open the originating run's full diff (the History modal) for review. */
  onReview: (runId: string) => void;
}

/**
 * Surfaces the latest completed Improve run whose generated draft hasn't been
 * adopted yet — so a ready improvement is visible on the panel instead of buried
 * in history. Shows the draft-vs-current score delta when results are loaded and
 * reuses the existing acceptDraft action for one-click adoption.
 */
export function ImproveReadyCallout({ onReview }: ImproveReadyCalloutProps) {
  const { t } = useTranslation();
  const matrixRuns = useAgentStore((s) => s.matrixRuns);
  const matrixResultsMap = useAgentStore((s) => s.matrixResultsMap);
  const acceptDraft = useAgentStore((s) => s.acceptDraft);
  const [accepting, setAccepting] = useState(false);

  const pending = useMemo(() => {
    const candidates = matrixRuns.filter(
      (r) => r.status === 'completed' && r.draftPromptJson && !r.draftAccepted,
    );
    if (candidates.length === 0) return null;
    return candidates.reduce((latest, r) =>
      new Date(r.createdAt).getTime() > new Date(latest.createdAt).getTime() ? r : latest,
    );
  }, [matrixRuns]);

  const delta = useMemo(() => {
    if (!pending) return null;
    const results = matrixResultsMap[pending.id] as LabMatrixResult[] | undefined;
    if (!results?.length) return null;
    const { variantAggs } = aggregateMatrixResults(results);
    const cur = variantAggs.find((a) => a.variant === 'current')?.compositeScore;
    const draft = variantAggs.find((a) => a.variant === 'draft')?.compositeScore;
    if (cur == null || draft == null) return null;
    return draft - cur;
  }, [pending, matrixResultsMap]);

  if (!pending) return null;

  const handleAdopt = async () => {
    setAccepting(true);
    try { await acceptDraft(pending.id); } finally { setAccepting(false); }
  };

  return (
    <div
      data-testid="improve-ready-callout"
      className="flex flex-wrap items-center gap-3 rounded-modal border border-accent/25 bg-gradient-to-r from-accent/10 to-primary/[0.06] px-4 py-3"
    >
      <div className="w-8 h-8 rounded-card bg-accent/20 flex items-center justify-center flex-shrink-0">
        <Wand2 className="w-4 h-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="typo-body font-medium text-foreground">{t.agents.lab.improve_ready_title}</p>
          {delta != null && (
            <span className={`px-1.5 py-0.5 rounded-input typo-caption font-semibold tabular-nums ${delta >= 0 ? 'bg-status-success/15 text-status-success' : 'bg-status-error/15 text-status-error'}`}>
              {delta >= 0 ? `+${delta}` : delta}
            </span>
          )}
        </div>
        {pending.draftChangeSummary && (
          <p className="typo-caption text-foreground truncate">{pending.draftChangeSummary}</p>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={() => onReview(pending.id)}
          data-testid="improve-ready-review"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-card typo-caption font-medium text-foreground border border-primary/15 hover:bg-secondary/40 transition-colors"
        >
          <ArrowUpRight className="w-3.5 h-3.5" />{t.agents.lab.improve_ready_review}
        </button>
        <AsyncButton
          size="sm"
          variant="primary"
          isLoading={accepting}
          icon={<Check className="w-3.5 h-3.5" />}
          onClick={() => void handleAdopt()}
          data-testid="improve-ready-adopt"
        >
          {t.agents.lab.accept_draft}
        </AsyncButton>
      </div>
    </div>
  );
}
