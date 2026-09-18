/**
 * The inline notice for a failed roll, materialize or apply. Calm, beside
 * the content it concerns, and the content it concerns stays on screen.
 */

import { TriangleAlert, X } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import type { StyleStudioError } from './styleContract';

export function StyleNotice({ error, onDismiss }: { error: StyleStudioError; onDismiss: () => void }) {
  const { t } = useTranslation();
  const ts = t.twin.style.panel;
  const lead =
    error.step === 'roll' ? ts.errorRoll : error.step === 'apply' ? ts.errorApply : ts.errorMaterialize;

  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-input border border-status-warning/25 bg-status-warning/8 px-3 py-2"
      data-testid="style-error"
    >
      <TriangleAlert className="w-4 h-4 mt-0.5 text-status-warning flex-shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="typo-body text-foreground">{lead}</p>
        <p className="typo-caption break-words">{error.message}</p>
      </div>
      <Button variant="ghost" size="icon-sm" onClick={onDismiss} aria-label={ts.dismiss}>
        <X className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}

export default StyleNotice;
