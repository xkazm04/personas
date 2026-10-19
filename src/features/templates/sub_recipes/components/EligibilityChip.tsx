import { Check, AlertTriangle, Lock } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { Eligibility } from '../types';

/** Compact eligibility verdict badge — Ready / Setup / Locked. Used by
 *  the recipe table row, the recipe detail header, and the adoption
 *  modal. State color tones match the project status palette. */
export function EligibilityChip({ eligibility }: { eligibility: Eligibility }) {
  const { t, tx } = useTranslation();
  if (eligibility.state === 'eligible') {
    return (
      <Tooltip content={t.recipes_catalog.chip_eligible_tooltip}>
        <span className="shrink-0 typo-label px-1.5 py-0.5 rounded border inline-flex items-center gap-1 bg-status-success/12 border-status-success/35 text-status-success/95">
          <Check className="w-2.5 h-2.5" />
          {t.recipes_catalog.chip_eligible_label}
        </span>
      </Tooltip>
    );
  }
  if (eligibility.state === 'adoptable-with-setup') {
    const n = eligibility.missingConnectors.length;
    return (
      <Tooltip
        content={tx(
          n === 1 ? t.recipes_catalog.adopt_tooltip_needs_setup_one : t.recipes_catalog.adopt_tooltip_needs_setup_other,
          { count: n },
        )}
      >
        <span className="shrink-0 typo-label px-1.5 py-0.5 rounded border inline-flex items-center gap-1 bg-status-warning/12 border-status-warning/35 text-status-warning/95">
          <AlertTriangle className="w-2.5 h-2.5" />
          {t.recipes_catalog.chip_setup_label}
          {n > 1 && <span className="font-mono">×{n}</span>}
        </span>
      </Tooltip>
    );
  }
  // incompatible
  return (
    <Tooltip content={eligibility.reason}>
      <span className="shrink-0 typo-label px-1.5 py-0.5 rounded border inline-flex items-center gap-1 bg-secondary/60 border-card-border text-foreground">
        <Lock className="w-2.5 h-2.5" />
        {t.recipes_catalog.chip_locked_label}
      </span>
    </Tooltip>
  );
}
