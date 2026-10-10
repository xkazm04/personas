// What the practice says about this step (the agent-facing rule, on the
// sentence plate) and what makes it happen or can refuse it (each binding as a
// card with its state pill and what was found).
import { Section } from '@/features/shared/components/kit';

import { bindingKindLabel } from '../../journey/journeyLabels';
import type { JourneyNode } from '../../journey/journeyModel';
import { useLifecycleViewModel } from '../context';
import { RHYTHM, lcSurface } from '../system/lcSurface';
import { LT } from '../system/lcType';
import { BindingPill } from '../system/Pill';
import { MiniKey } from '../TactileKeys';

export function StepRule({ node }: { node: JourneyNode }) {
  const { dl } = useLifecycleViewModel();
  const bindings = node.view.bindingViews;
  return (
    <Section title={dl.lc2_rule_title} level={2}>
      <div className="grid grid-cols-1 items-start gap-x-6 gap-y-4 xl:grid-cols-[1.4fr_1fr]" data-testid="lc2-rule">
        <p className={`${lcSurface('plate')} ${LT.lead}`}>{node.rule}</p>
        <div className={RHYTHM.tight}>
          <h4 className={LT.eyebrow}>{dl.lc_detail_bindings}</h4>
          {bindings.length === 0 && <p className={LT.row}>{dl.lc_state_phrase_advisory}</p>}
          <ul className={`${RHYTHM.tight} empty:hidden`}>
            {bindings.map((b) => (
              <li key={b.kind} className={`flex items-center gap-3 ${lcSurface('card')}`}>
                <MiniKey state={b.state} />
                <div className="min-w-0 flex-1">
                  <p className={LT.row}>{bindingKindLabel(dl, b.kind)}</p>
                  {b.detail && <p className={`break-all ${LT.code}`}>{b.detail}</p>}
                </div>
                <BindingPill state={b.state} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}
