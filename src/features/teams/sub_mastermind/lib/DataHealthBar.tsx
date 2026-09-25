// Honest data-health banner for Mastermind. The page fetches several
// independent data families (relations / idea scans / KPI / fleet /
// monitoring); when one FAILS the chart would otherwise render a silent partial
// truth — currents vanish, Ideas readings lie "never scanned", KPI readings
// look honestly "absent". This compact page-level chrome names exactly which
// families failed and offers a retry; it renders NOTHING when every family is
// clean. The page places it under the chart's top bar.
import { AlertTriangle } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';

export function DataHealthBar({ failed, onRetry }: {
  /** Localized labels of the data families currently failed/stale. */
  failed: string[];
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  if (failed.length === 0) return null;
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 rounded-interactive bg-secondary border border-status-warning/40 shadow-elevation-2"
      role="status"
      data-testid="mm-data-health"
    >
      <AlertTriangle className="size-4 text-status-warning shrink-0" aria-hidden />
      <span className="typo-caption text-foreground">
        {t.mastermind.data_health_title}
      </span>
      <span className="typo-caption text-status-warning">{failed.join(' · ')}</span>
      <Button size="xs" variant="secondary" onClick={onRetry}>
        {t.common.retry}
      </Button>
    </div>
  );
}
