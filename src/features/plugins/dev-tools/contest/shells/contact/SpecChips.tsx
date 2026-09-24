// A seat spec as its parts: engine, model, effort (+ #label) chips.
// Extractable: any surface that shows who raced (a lane, a keeper, a tray).
import { Badge } from '@/features/shared/components/display/Badge';
import { useTranslation } from '@/i18n/useTranslation';

import { effortLabel, engineLabel } from '../../model/labels';
import { isContestEffort, isContestEngine } from '../../model/seatCatalog';
import { specParts } from './contactModel';

export interface SpecChipsProps {
  spec: string;
  className?: string;
}

export function SpecChips({ spec, className = '' }: SpecChipsProps) {
  const { t } = useTranslation();
  const s = t.plugins.contest;
  const p = specParts(spec);
  if (!p.model) {
    return <span className={`typo-code text-foreground break-all ${className}`}>{spec}</span>;
  }
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className}`} aria-label={spec}>
      <Badge variant="cyan" size="sm">
        {isContestEngine(p.engine) ? engineLabel(s, p.engine) : p.engine}
      </Badge>
      <Badge variant="neutral" size="sm">
        <span className="font-code">{p.model}</span>
      </Badge>
      <Badge variant="violet" size="sm">
        {isContestEffort(p.effort) ? effortLabel(s, p.effort) : p.effort}
      </Badge>
      {p.label && (
        <Badge variant="neutral" size="sm">
          #{p.label}
        </Badge>
      )}
    </span>
  );
}
