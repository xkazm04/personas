// Honest data-health banner for the Mastermind canvas. The canvas fetches
// several independent data families (relations / idea scans / KPI / fleet /
// monitoring); when one FAILS the canvas used to render a silent partial truth
// — edges vanished, Ideas cells lied "never scanned", KPI cells looked
// honestly "absent". This compact page-level chrome (NOT inside the SVG) names
// exactly which families failed and offers a retry; it renders NOTHING when
// every family is clean, so a healthy canvas carries zero added chrome.
// POSITIONING IS NOT ITS OWN (changed 2026-08-20). It used to place itself at
// `bottom-14` with a comment saying it must never overlap the mode toolbar —
// a rule held up by a coordinated constant, which is exactly the kind of rule
// that breaks the moment a third piece of bottom chrome appears. It did:
// `MilestoneStatusBar` wanted the same slot. Both now render inside one
// bottom-anchored column in `MastermindPage`, so "they cannot overlap" is a
// property of the layout instead of an agreement between two files.
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
