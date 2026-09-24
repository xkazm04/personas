// A seat's real spec as three chips — engine, model, effort — plus its label.
// Falls back to the raw spec string when it does not parse (a newer skill).
// Extractable: nothing here is race-specific.
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { useTranslation } from '@/i18n/useTranslation';

import { effortLabel, engineLabel } from '../../model/labels';
import { parseSeatSpec } from '../../model/seatCatalog';

export function SeatSpecChips({ spec, className = '' }: { spec: string; className?: string }) {
  const { t } = useTranslation();
  const s = t.plugins.contest;
  const parsed = parseSeatSpec(spec);
  if (!parsed) return <span className={`typo-caption font-mono text-foreground break-all ${className}`}>{spec}</span>;
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className}`} aria-label={spec}>
      <StatusBadge accent="cyan" size="sm" pill>
        {engineLabel(s, parsed.engine)}
      </StatusBadge>
      <span className="typo-caption font-mono text-foreground break-all">{parsed.model}</span>
      <StatusBadge accent="violet" size="sm" pill>
        {effortLabel(s, parsed.effort)}
      </StatusBadge>
      {parsed.label && <span className="typo-caption font-mono text-foreground">#{parsed.label}</span>}
    </span>
  );
}
