import { useMemo } from 'react';

interface LabQualityBadgeProps {
  testMetadata?: {
    avgCompositeScore: number;
    testCoverage: number;
    lastTestedAt: string;
  };
  compact?: boolean;
}

function scoreColor(score: number): { dot: string; bg: string; text: string; border: string } {
  if (score >= 75) return { dot: 'bg-emerald-400', bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20' };
  if (score >= 50) return { dot: 'bg-amber-400', bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' };
  return { dot: 'bg-red-400', bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/20' };
}

export function LabQualityBadge({ testMetadata, compact }: LabQualityBadgeProps) {
  const colors = useMemo(
    () => (testMetadata ? scoreColor(testMetadata.avgCompositeScore) : null),
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
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${colors.bg} ${colors.text} ${colors.border}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
      Score: {testMetadata.avgCompositeScore} | {testMetadata.testCoverage} scenarios
    </span>
  );
}
