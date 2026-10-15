/**
 * Two one-line notes a shape carries above its body: the valve walk's step
 * ("Valve 3 of 48", one at a time, armed twice) and the council's standing
 * rule (its verdict is evidence; only the operator admits work).
 */
import { Landmark, Lock } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

export function ValveStep({ index, total }: { index: number; total: number }) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  return (
    <p className="au-armed au-l-danger flex max-w-[68ch] items-center gap-3 rounded-input px-3 py-2" data-testid="valve-step">
      <Lock className="au-ink-lamp h-4 w-4 flex-shrink-0" aria-hidden />
      <span className="au-ink-lamp typo-heading tabular-nums">{tx(m.ml_valve_step, { index, total })}</span>
      <span className="typo-body text-foreground">{m.ml_valve_hint}</span>
    </p>
  );
}

export function CouncilNote() {
  const { t } = useTranslation();
  return (
    <p className="au-no flex items-center gap-2 rounded-r-input py-1.5 pl-3 pr-3" data-testid="council-never-admits">
      <Landmark className="h-4 w-4 flex-shrink-0 au-quiet" aria-hidden />
      <span className="typo-body text-foreground">{t.monitor.ml_council_never_admits}</span>
    </p>
  );
}
