/**
 * Dossier (WP9): the bio drawn against its readiness target - kit units of a
 * 1-2-5 quantum of characters, filled to the bio's length and running at
 * least to the target, which a tick marks. No bio stored draws the hatched
 * "not measured" strip in the same geometry.
 */
import type { CSSProperties } from 'react';

import { UnitStrip } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';

import { BIO_UNITS, bioStrip } from './dossierModel';
import { NotMeasured } from './Figure';

interface BioStripProps {
  bioChars: number | null;
  target: number;
  /** Where it is drawn: sets the unit size and how many units fit. */
  at: keyof typeof BIO_UNITS;
}

export function BioStrip({ bioChars, target, at }: BioStripProps) {
  const size = at === 'compact' ? 'm' : 'l';
  const { t, tx } = useTranslation();
  const copy = t.twin.blueprint.variantCopy.dossier;
  const strip = bioStrip(bioChars, target, BIO_UNITS[at]);
  if (!strip || bioChars === null) {
    return <NotMeasured width="var(--dz-bio-w)" height="var(--dz-bio-h)" testId="dossier-bio-none" />;
  }
  return (
    <span className="dossier-bio" data-size={size} data-testid="dossier-bio" style={{ '--target-at': strip.targetAt } as CSSProperties}>
      <UnitStrip
        size={size}
        label={tx(copy.bioAria, { count: bioChars, target })}
        legend={strip.quantum > 1 ? tx(copy.charUnit, { count: strip.quantum }) : undefined}
        segments={[
          { n: strip.filled, tone: 'primary' },
          { n: strip.empty, glyph: 'empty' },
        ]}
      />
      <span className="dossier-bio__target" aria-hidden="true" />
    </span>
  );
}
