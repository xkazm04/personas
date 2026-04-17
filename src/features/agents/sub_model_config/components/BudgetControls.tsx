import { DollarSign } from 'lucide-react';
import { FieldHint } from '@/features/shared/components/display/FieldHint';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
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
        <input
          type="number"
          value={maxBudget ?? ''}
          onChange={(e) => {
            if (e.target.value === '') { onMaxBudgetChange(''); return; }
            const n = parseFloat(e.target.value);
            onMaxBudgetChange(Number.isNaN(n) ? '' : n);
          }}
          placeholder={mc.max_budget_placeholder}
          min={0}
          step={0.01}
          className={INPUT_FIELD}
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
        <input
          type="number"
          value={maxTurns ?? ''}
          onChange={(e) => {
            if (e.target.value === '') { onMaxTurnsChange(''); return; }
            const n = parseInt(e.target.value, 10);
            onMaxTurnsChange(Number.isNaN(n) ? '' : n);
          }}
          placeholder={mc.max_turns_placeholder}
          min={1}
          step={1}
          className={INPUT_FIELD}
        />
      </div>
    </div>
  );
}
