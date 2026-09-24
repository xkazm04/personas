// The top of the photo finish side panel: which variant this is, the seat
// that made it, and the builder's facts as one compact definition list —
// concept (said once), size, the notes flag.
import { FileText } from 'lucide-react';

import { Numeric } from '@/features/shared/components/display/Numeric';
import { useTranslation } from '@/i18n/useTranslation';
import type { ContestVariant } from '@/lib/bindings/ContestVariant';

import { variantName } from './arenaModel';
import { SeatLabel } from './SeatLabel';

export function PhotoFacts({ variant, maker }: { variant: ContestVariant; maker: string | null }) {
  const { t, tx } = useTranslation();
  const s = t.plugins.contest;
  const a = s.arena;
  return (
    <section className="space-y-2" aria-label={tx(a.variant_key, { key: variant.key })} data-testid="arena-photo-facts">
      <h3 className="typo-title">{tx(a.variant_key, { key: variant.key })}</h3>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-0.5 typo-caption">
        {maker && (
          <>
            <dt>{a.made_by}</dt>
            <dd className="min-w-0">
              <SeatLabel spec={maker} />
            </dd>
          </>
        )}
        <dt>{s.variant_concept}</dt>
        <dd className="min-w-0 break-words text-foreground">{variantName(variant)}</dd>
        <dt>{s.variant_size}</dt>
        <dd className="text-foreground">
          <Numeric value={variant.bytes} unit="compact" />
        </dd>
        {variant.hasNotes && (
          <dd className="col-span-2 flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 shrink-0" aria-hidden /> {s.variant_has_notes}
          </dd>
        )}
        {!variant.present && <dd className="col-span-2 text-status-warning">{s.variant_missing}</dd>}
      </dl>
    </section>
  );
}
