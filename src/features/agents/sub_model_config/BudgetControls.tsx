import { DollarSign } from 'lucide-react';
import { FieldHint } from '@/features/shared/components/display/FieldHint';
import { INPUT_FIELD } from '@/lib/utils/designTokens';

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
  return (
    <div className="flex gap-3">
      <div className="flex-1">
        <label className="block text-sm font-medium text-foreground/80 mb-1">
          <span className="flex items-center gap-1">
            <DollarSign className="w-3 h-3" /> Max Budget (USD)
            <FieldHint
              text="Maximum total spend for a single execution. The run will stop if this limit is reached."
              range="$0.01 and up, or leave blank for no limit"
              example="0.50"
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
          placeholder="No limit"
          min={0}
          step={0.01}
          className={INPUT_FIELD}
        />
      </div>
      <div className="flex-1">
        <label className="block text-sm font-medium text-foreground/80 mb-1">
          Max Turns
          <FieldHint
            text="Maximum number of LLM round-trips per execution. Each turn is one prompt-response cycle with tool use."
            range="1 and up, or leave blank for no limit"
            example="5"
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
          placeholder="No limit"
          min={1}
          step={1}
          className={INPUT_FIELD}
        />
      </div>
    </div>
  );
}
