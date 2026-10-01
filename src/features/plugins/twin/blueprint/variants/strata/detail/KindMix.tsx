/**
 * The question-kind mix: answered steps by kind as one share-of-total bar and a
 * legend of counts. Nothing answered yet: the hatched band.
 */
import type { CSSProperties } from 'react';

import { useTranslation } from '@/i18n/useTranslation';

import type { StepKind, TwinBlueprintModel } from '../../../blueprintContract';
import { StrataFigure } from '../StrataFigure';

const KINDS: readonly StepKind[] = ['scene', 'opinion', 'reply_drill', 'fact', 'rule', 'preference'];

export function KindMix({ model }: { model: TwinBlueprintModel }) {
  const { t } = useTranslation();
  const tb = t.twin.blueprint;
  const mix = model.training.kindMix;
  const present = KINDS.filter((k) => (mix[k] ?? 0) > 0);
  const total = present.reduce((s, k) => s + (mix[k] ?? 0), 0);

  return (
    <div className="flex flex-col gap-1.5">
      <span className="typo-label text-primary">{tb.metrics.kinds}</span>
      {total === 0 ? (
        <span className="strata-meter strata-meter--lg is-unmeasured" data-measured="false" aria-hidden />
      ) : (
        <>
          <span className="strata-share" aria-hidden>
            {present.map((k) => (
              <i key={k} data-kind={k} style={{ '--part': (mix[k] ?? 0) / total } as CSSProperties} />
            ))}
          </span>
          <span className="flex flex-wrap gap-x-4 gap-y-1">
            {present.map((k) => (
              <span key={k} className="inline-flex items-baseline gap-1.5">
                <i className="strata-swatch" data-kind={k} aria-hidden />
                <span className="typo-caption">{tb.kinds[k]}</span>
                <StrataFigure value={mix[k] ?? 0} className="typo-data text-foreground" />
              </span>
            ))}
          </span>
        </>
      )}
    </div>
  );
}
