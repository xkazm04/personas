import { useMemo } from 'react';
import { StatusBadge, type StatusVariant } from '@/features/shared/components/display/StatusBadge';
import { useTranslation } from '@/i18n/useTranslation';

interface LabQualityBadgeProps {
  testMetadata?: {
    avgCompositeScore: number;
    testCoverage: number;
    lastTestedAt: string;
  };
  compact?: boolean;
}

function scoreVariant(score: number): { variant: StatusVariant; dot: string } {
  if (score >= 75) return { variant: 'success', dot: 'bg-emerald-400' };
  if (score >= 50) return { variant: 'warning', dot: 'bg-amber-400' };
  return { variant: 'error', dot: 'bg-red-400' };
}

export function LabQualityBadge({ testMetadata, compact }: LabQualityBadgeProps) {
  const { t, tx } = useTranslation();
  const colors = useMemo(
    () => (testMetadata ? scoreVariant(testMetadata.avgCompositeScore) : null),
    [testMetadata?.avgCompositeScore],
  );

  if (!testMetadata || !colors) return null;

  if (compact) {
    return (
      <span
        className={`inline-block w-2 h-2 rounded-full ${colors.dot} flex-shrink-0`}
        title={tx(t.agents.lab.quality_score_title, { score: testMetadata.avgCompositeScore, coverage: testMetadata.testCoverage, date: new Date(testMetadata.lastTestedAt).toLocaleDateString() })}
      />
    );
  }

  return (
    <StatusBadge variant={colors.variant} pill icon={<span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />}>
      {tx(t.agents.lab.quality_score_inline, { score: testMetadata.avgCompositeScore, coverage: testMetadata.testCoverage })}
    </StatusBadge>
  );
}
