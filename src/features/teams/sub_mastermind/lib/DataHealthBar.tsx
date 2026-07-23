// Honest data-health banner for the Mastermind canvas. The canvas fetches
// several independent data families (relations / idea scans / KPI / fleet /
// monitoring); when one FAILS the canvas used to render a silent partial truth
// — edges vanished, Ideas cells lied "never scanned", KPI cells looked
// honestly "absent". This compact page-level chrome (NOT inside the SVG) names
// exactly which families failed and offers a retry; it renders NOTHING when
// every family is clean, so a healthy canvas carries zero added chrome.
// Anchored ABOVE the mode toolbar (both are bottom-center) — the two must
// never overlap: losing mode switching the moment data degrades is a trap.
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
      className="absolute bottom-14 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-3 py-1.5 rounded-interactive bg-secondary border border-status-warning/40 shadow-elevation-2"
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
