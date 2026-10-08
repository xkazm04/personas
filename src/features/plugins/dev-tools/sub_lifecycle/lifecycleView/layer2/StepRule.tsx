// What the practice says about this step (the agent-facing rule) and what
// makes it happen or can refuse it (each binding with its state and what was
// found). Moved here from the retired Layer-1 state panel (`TactileState`).
import { Section } from '@/features/shared/components/kit';
import type { LifecycleBindingState } from '@/lib/bindings/LifecycleBindingState';

import { bindingKindLabel, bindingStateLabel } from '../../journey/journeyLabels';
import type { JourneyNode } from '../../journey/journeyModel';
import { useLifecycleViewModel } from '../context';
import { MiniKey } from '../TactileKeys';

const PILL: Record<LifecycleBindingState, string> = {
  live: 'border-status-success/30 bg-status-success/10 text-status-success',
  detected: 'border-status-info/30 bg-status-info/10 text-status-info',
  pending: 'border-status-warning/30 bg-status-warning/10 text-status-warning',
  missing: 'border-status-error/30 bg-status-error/10 text-status-error',
  advisory: 'border-primary/20 bg-secondary/40 text-foreground',
};

export function StepRule({ node }: { node: JourneyNode }) {
  const { dl } = useLifecycleViewModel();
  const bindings = node.view.bindingViews;
  return (
    <Section title={dl.lc2_rule_title} level={2}>
      <div className="grid grid-cols-1 items-start gap-x-6 gap-y-4 xl:grid-cols-[1.4fr_1fr]" data-testid="lc2-rule">
        <p className="rounded-card bg-secondary/30 px-4 py-3 shadow-inner typo-body-lg text-foreground">{node.rule}</p>
        <div className="space-y-1.5">
          <h4 className="typo-eyebrow text-foreground">{dl.lc_detail_bindings}</h4>
          {bindings.length === 0 && <p className="typo-body text-foreground">{dl.lc_state_phrase_advisory}</p>}
          <ul className="space-y-1.5 empty:hidden">
            {bindings.map((b) => (
              <li key={b.kind} className="flex items-center gap-3 rounded-card border border-primary/10 bg-background px-3 py-2 shadow-elevation-1">
                <MiniKey state={b.state} />
                <div className="min-w-0 flex-1">
                  <p className="typo-body text-foreground">{bindingKindLabel(dl, b.kind)}</p>
                  {b.detail && <p className="typo-code break-all text-foreground">{b.detail}</p>}
                </div>
                <span className={`shrink-0 rounded-full border px-2 typo-label ${PILL[b.state]}`}>{bindingStateLabel(dl, b.state)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}
