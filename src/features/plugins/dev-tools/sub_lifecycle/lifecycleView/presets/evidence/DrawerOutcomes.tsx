/**
 * What else one change did: its outcome on every OTHER step of the practice,
 * in journey order, each with its note and a way to that step's screen. The
 * change carries every step's outcome (the step detail ships them whole since
 * wave 10), so this reads the same for all 200 changes; a change no other step
 * recorded says so instead of drawing an empty list.
 */
import { ArrowRight } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import type { LifecycleEvidenceItem } from '@/lib/bindings/LifecycleEvidenceItem';

import { stepGlyph, stepLabel } from '../../../journey/journeyLabels';
import { useLifecycleViewModel } from '../../context';
import { LC_RULE } from '../../system/lcSurface';
import { LT } from '../../system/lcType';
import { OutcomePill } from '../../system/Pill';
import { GLYPH } from '../../system/scales';

export function DrawerOutcomes({ whole, stepId, onOpenStep }: { whole: LifecycleEvidenceItem; stepId: string; onOpenStep: (id: string) => void }) {
  const { dl, tx, order } = useLifecycleViewModel();
  const rank = (id: string) => { const i = order.findIndex((n) => n.id === id); return i < 0 ? order.length : i; };
  const others = whole.outcomes.filter((o) => o.stepId !== stepId).sort((a, b) => rank(a.stepId) - rank(b.stepId));
  if (others.length === 0) return <p className={LT.row} data-testid="lc8-drawer-others-none">{dl.lcx10_drawer_others_none}</p>;
  return (
    <ul className={`divide-y ${LC_RULE}`} data-testid="lc8-drawer-others">
      {others.map((o) => {
        const node = order.find((n) => n.id === o.stepId);
        const name = stepLabel(dl, o.stepId, node?.label ?? null);
        const Glyph = stepGlyph(o.stepId);
        return (
          <li key={o.stepId} className="flex flex-col gap-1 py-2.5" data-testid={`lc8-drawer-other-${o.stepId}`}>
            <div className="flex items-center gap-3">
              <Glyph className={`${GLYPH.md} shrink-0 text-primary`} aria-hidden />
              <span className={`min-w-0 flex-1 ${LT.title}`}>{name}</span>
              <OutcomePill outcome={o.outcome} />
              {node && (
                <Button variant="ghost" size="icon-sm" aria-label={tx(dl.lcx8_drawer_open_step, { step: name })} onClick={() => onOpenStep(o.stepId)}>
                  <ArrowRight className={GLYPH.sm} />
                </Button>
              )}
            </div>
            {o.detail && <p className={`pl-8 break-words ${LT.row}`}>{o.detail}</p>}
          </li>
        );
      })}
    </ul>
  );
}
