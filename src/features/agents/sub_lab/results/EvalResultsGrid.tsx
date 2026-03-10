import { useMemo, useEffect, useState } from 'react';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import type { LabEvalResult } from '@/lib/bindings/LabEvalResult';
import { aggregateResults } from './evalAggregation';
import { EvalVersionCards } from './EvalVersionCards';
import { EvalRadarSection } from './EvalRadarSection';
import { EvalMatrixTable } from './EvalMatrixTable';

interface Props {
  results: LabEvalResult[];
}

export function EvalResultsGrid({ results }: Props) {
  const [celebrateWinnerId, setCelebrateWinnerId] = useState<string | null>(null);
  const { shouldAnimate } = useMotion();

  const { versionAggs, versions, models, grid, winnerId } = useMemo(
    () => aggregateResults(results),
    [results],
  );

  useEffect(() => {
    if (!shouldAnimate) {
      setCelebrateWinnerId(null);
      return;
    }
    if (!winnerId) return;
    setCelebrateWinnerId(winnerId);
    const timer = window.setTimeout(() => {
      setCelebrateWinnerId((prev) => (prev === winnerId ? null : prev));
    }, 900);
    return () => window.clearTimeout(timer);
  }, [winnerId, shouldAnimate]);

  if (results.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground/80 text-sm" data-testid="eval-results-empty">
        No results to display
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="eval-results-grid">
      {/* Version summary cards */}
      <EvalVersionCards
        versionAggs={versionAggs}
        winnerId={winnerId}
        celebrateWinnerId={celebrateWinnerId}
      />

      {/* Multi-dimension comparison radar */}
      <EvalRadarSection versionAggs={versionAggs} />

      {/* Version x Model matrix grid */}
      <EvalMatrixTable
        versions={versions}
        models={models}
        grid={grid}
        versionAggs={versionAggs}
        winnerId={winnerId}
      />
    </div>
  );
}
