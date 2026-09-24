// A seat spec as its parts: engine · model · effort [· #label]. Extractable:
// every shell names seats, and a spec string read as one token hides which
// part differs between two seats.
import { useTranslation } from '@/i18n/useTranslation';

import { effortLabel, engineLabel } from '../../model/labels';
import { parseSeatSpec } from '../../model/seatCatalog';

export interface SeatSpecChipsProps {
  spec: string;
  className?: string;
}

const CHIP = 'inline-flex items-center rounded-interactive border px-1.5 py-0.5 typo-code text-foreground';

export function SeatSpecChips({ spec, className = '' }: SeatSpecChipsProps) {
  const { t } = useTranslation();
  const s = t.plugins.contest;
  const parsed = parseSeatSpec(spec);
  if (!parsed) {
    // A spec this build cannot parse (a newer grammar): show it verbatim.
    return <span className={`typo-code text-foreground break-all ${className}`}>{spec}</span>;
  }
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className}`} aria-label={spec}>
      <span className={`${CHIP} border-primary/25 bg-primary/10`}>{engineLabel(s, parsed.engine)}</span>
      <span className={`${CHIP} border-primary/15 bg-secondary/40`}>{parsed.model}</span>
      <span className={`${CHIP} border-primary/15 bg-secondary/20`}>{effortLabel(s, parsed.effort)}</span>
      {parsed.label && <span className={`${CHIP} border-dashed border-primary/20`}>#{parsed.label}</span>}
    </span>
  );
}
