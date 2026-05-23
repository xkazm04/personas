import { DollarSign } from 'lucide-react';
import { FieldHint } from '@/features/shared/components/display/FieldHint';
import { NumberStepper } from '@/features/shared/components/forms/NumberStepper';
import { useTranslation } from '@/i18n/useTranslation';

interface BudgetControlsProps {
  maxBudget: number | null | '' | undefined;
  maxTurns: number | null | '' | undefined;
  onMaxBudgetChange: (v: number | null | '') => void;
  onMaxTurnsChange: (v: number | null | '') => void;
}

export function BudgetControls({
  maxBudget,
  maxTurns,
  onMaxBudgetChange,
  onMaxTurnsChange,
}: BudgetControlsProps) {
  const { t } = useTranslation();
  const mc = t.agents.model_config;
  return (
    <div className="flex gap-3">
      <div className="flex-1">
        <label className="block typo-body font-medium text-foreground mb-1">
          <span className="flex items-center gap-1">
            <DollarSign className="w-3 h-3" /> {mc.max_budget_label}
            <FieldHint
              text={mc.max_budget_hint}
              range={mc.max_budget_range}
              example={mc.max_budget_example}
            />
          </span>
        </label>
        <NumberStepper
          value={typeof maxBudget === 'number' ? maxBudget : null}
          onChange={(v) => onMaxBudgetChange(v ?? '')}
          min={0}
          step={0.01}
          allowEmpty
          prefix="$"
          placeholder={mc.max_budget_placeholder}
          ariaLabel={mc.max_budget_label}
          className="w-full"
        />
      </div>
      <div className="flex-1">
        <label className="block typo-body font-medium text-foreground mb-1">
          {mc.max_turns_label}
          <FieldHint
            text={mc.max_turns_hint}
            range={mc.max_turns_range}
            example={mc.max_turns_example}
          />
        </label>
        <NumberStepper
          value={typeof maxTurns === 'number' ? maxTurns : null}
          onChange={(v) => onMaxTurnsChange(v ?? '')}
          min={1}
          step={1}
          allowEmpty
          placeholder={mc.max_turns_placeholder}
          ariaLabel={mc.max_turns_label}
          className="w-full"
        />
      </div>
    </div>
  );
}
