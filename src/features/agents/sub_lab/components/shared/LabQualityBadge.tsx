import { useMemo } from 'react';
import { StatusBadge, type StatusVariant } from '@/features/shared/components/display/StatusBadge';

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
  const colors = useMemo(
    () => (testMetadata ? scoreVariant(testMetadata.avgCompositeScore) : null),
    [testMetadata?.avgCompositeScore],
  );

  if (!testMetadata || !colors) return null;

  if (compact) {
    return (
      <span
        className={`inline-block w-2 h-2 rounded-full ${colors.dot} flex-shrink-0`}
        title={`Score: ${testMetadata.avgCompositeScore} | ${testMetadata.testCoverage} scenarios tested | ${new Date(testMetadata.lastTestedAt).toLocaleDateString()}`}
      />
    );
  }

  return (
    <StatusBadge variant={colors.variant} pill icon={<span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />}>
      Score: {testMetadata.avgCompositeScore} | {testMetadata.testCoverage} scenarios
    </StatusBadge>
  );
}
