/**
 * The wizard's step rail. It renders the path's steps and marks where the
 * derived step is; it owns no state and cannot be clicked, because a step is
 * reached by what happened, never by navigation.
 */
import { Check } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { WIZARD_RAIL, type WizardPath, type WizardStepId } from '../../lib/wizardStep';

export function StepRail({ path, current }: { path: WizardPath; current: WizardStepId }) {
  const { t } = useTranslation();
  const st = t.sharing;
  const LABEL: Record<WizardStepId, string> = {
    find: st.wizard_step_find,
    code: st.wizard_step_code,
    approve: st.wizard_step_approve,
    done: st.wizard_step_done,
  };
  const steps = WIZARD_RAIL[path];
  const at = steps.indexOf(current);

  return (
    <ol aria-label={st.wizard_rail_label} data-testid="wizard-rail" className="flex items-center gap-2">
      {steps.map((step, i) => {
        const state = i < at ? 'past' : i === at ? 'current' : 'next';
        return (
          <li
            key={step}
            data-step={step}
            data-state={state}
            aria-current={state === 'current' ? 'step' : undefined}
            className="flex items-center gap-2"
          >
            <span
              className={`w-6 h-6 rounded-full flex items-center justify-center typo-caption border ${
                state === 'current'
                  ? 'border-primary bg-primary/15 text-primary'
                  : state === 'past'
                    ? 'border-primary/40 text-primary'
                    : 'border-border text-foreground'
              }`}
              aria-hidden
            >
              {state === 'past' ? <Check className="w-3.5 h-3.5" /> : i + 1}
            </span>
            <span className={`typo-body ${state === 'current' ? 'text-primary' : 'text-foreground'}`}>
              {LABEL[step]}
            </span>
            {i < steps.length - 1 && <span className="w-6 h-px bg-border" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}
