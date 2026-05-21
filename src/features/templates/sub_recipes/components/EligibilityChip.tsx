import { Check, AlertTriangle, Lock } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { Eligibility } from '../types';

/** Compact eligibility verdict badge — Ready / Setup / Locked. Used by
 *  the recipe table row, the recipe detail header, and the adoption
 *  modal. State color tones match the project status palette. */
export function EligibilityChip({ eligibility }: { eligibility: Eligibility }) {
  const { t } = useTranslation();
  if (eligibility.state === 'eligible') {
    return (
      <span
        className="shrink-0 typo-label uppercase tracking-wider px-1.5 py-0.5 rounded border inline-flex items-center gap-1 bg-status-success/12 border-status-success/35 text-status-success/95"
        title={t.recipes_catalog.chip_eligible_tooltip}
      >
        <Check className="w-2.5 h-2.5" />
        {t.recipes_catalog.chip_eligible_label}
      </span>
    );
  }
  if (eligibility.state === 'adoptable-with-setup') {
    const n = eligibility.missingConnectors.length;
    return (
      <span
        className="shrink-0 typo-label uppercase tracking-wider px-1.5 py-0.5 rounded border inline-flex items-center gap-1 bg-status-warning/12 border-status-warning/35 text-status-warning/95"
        title={`Needs wiring: ${eligibility.missingConnectors.join(', ')}`}
      >
        <AlertTriangle className="w-2.5 h-2.5" />
        {t.recipes_catalog.chip_setup_label}
        {n > 1 && <span className="font-mono">×{n}</span>}
      </span>
    );
  }
  // incompatible
  return (
    <span
      className="shrink-0 typo-label uppercase tracking-wider px-1.5 py-0.5 rounded border inline-flex items-center gap-1 bg-secondary/60 border-card-border text-foreground"
      title={eligibility.reason}
    >
      <Lock className="w-2.5 h-2.5" />
      {t.recipes_catalog.chip_locked_label}
    </span>
  );
}
