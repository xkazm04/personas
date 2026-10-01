/**
 * Dossier (WP9): a tile's headline gauge, the section's `sectionCoverage` on
 * its declared 0..1 domain - a bar and the percent beside it. `null` (nothing
 * to measure yet) draws the hatched "not drawn" bar and "-", never an empty
 * bar. On a working stage the bar carries the kit's ghost shimmer.
 */
import type { CSSProperties } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import { formatNumeric } from '@/lib/utils/formatters';

import type { SectionId } from '../../blueprintContract';
import { Figure } from './Figure';

interface CoverageMeterProps {
  section: SectionId;
  value: number | null;
  spring?: boolean;
  working?: boolean;
  reduced: boolean;
}

export function CoverageMeter({ section, value, spring, working, reduced }: CoverageMeterProps) {
  const { t, tx, language } = useTranslation();
  const tb = t.twin.blueprint;
  const measured = value !== null;
  const pct = measured ? formatNumeric(value, 'ratio', { precision: 0, language }) : tb.states.notDrawn;
  const style = { '--fill': measured ? value : 0 } as CSSProperties;
  return (
    <span
      className="dossier-gauge"
      data-measured={measured ? 'true' : 'false'}
      data-testid={`dossier-gauge-${section}`}
    >
      <span
        className="dossier-gauge__bar"
        role="img"
        aria-label={tx(tb.variantCopy.dossier.coverageAria, { section: tb.sections[section], pct })}
        data-working={working ? 'true' : undefined}
        style={style}
      >
        {measured && <span className="dossier-gauge__fill" />}
      </span>
      <Figure value={value} unit="ratio" spring={spring} reduced={reduced} className="typo-data dossier-gauge__figure" />
    </span>
  );
}
