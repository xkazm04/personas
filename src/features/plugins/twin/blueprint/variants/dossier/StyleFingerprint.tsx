/**
 * Dossier (WP9): a channel's voice as eight bars, one per style dimension, in
 * the studio's display order, each on the declared 1..5 range over a faint
 * full-height track. Unlabelled on purpose (layer one draws, it does not
 * spell): the names live in the accessible label and on the L2 matrix. A
 * channel with no stored style draws the hatched "not measured" box.
 */
import type { CSSProperties } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import type { TwinStyleDims } from '@/lib/bindings/TwinStyleDims';

import { STYLE_DIMENSIONS } from '../../../setup/style/styleContract';
import { DIM_MAX, clamp01 } from './dossierModel';
import { NotMeasured } from './Figure';

interface StyleFingerprintProps {
  dims: TwinStyleDims | null;
  /** The channel as the reader sees it, for the accessible label. */
  channel: string;
  testId?: string;
}

export function StyleFingerprint({ dims, channel, testId }: StyleFingerprintProps) {
  const { t, tx } = useTranslation();
  const copy = t.twin.blueprint.variantCopy.dossier;
  if (!dims) return <NotMeasured width="var(--dz-print-w)" height="var(--dz-print-h)" testId={testId} />;
  const spoken = STYLE_DIMENSIONS.map((d) =>
    tx(copy.dimValue, { label: t.twin.style.dims[d].label, value: dims[d], max: DIM_MAX }),
  ).join(', ');
  return (
    <span
      className="dossier-print"
      role="img"
      aria-label={tx(copy.styleAria, { channel, dims: spoken })}
      data-measured="true"
      data-testid={testId}
    >
      {STYLE_DIMENSIONS.map((d) => (
        <span key={d} className="dossier-print__bar" style={{ '--v': clamp01(dims[d] / DIM_MAX) } as CSSProperties} />
      ))}
    </span>
  );
}
