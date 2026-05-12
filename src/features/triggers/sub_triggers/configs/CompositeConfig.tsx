import { Plus, X } from 'lucide-react';
import type { CompositeCondition } from '@/lib/utils/platform/triggerConstants';
import { TriggerFieldGroup } from './TriggerFieldGroup';
import { useTranslation } from '@/i18n/useTranslation';

export interface CompositeConfigProps {
  compositeConditions: CompositeCondition[];
  setCompositeConditions: (v: CompositeCondition[]) => void;
  compositeOperator: string;
  setCompositeOperator: (v: string) => void;
  windowSeconds: string;
  setWindowSeconds: (v: string) => void;
  validationError: string | null;
  setValidationError: (v: string | null) => void;
}

export function CompositeConfig({
  compositeConditions, setCompositeConditions,
  compositeOperator, setCompositeOperator,
  windowSeconds, setWindowSeconds,
  validationError, setValidationError,
}: CompositeConfigProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <TriggerFieldGroup label={t.triggers.composite.conditions_label} error={validationError} errorId="composite-conditions-error">
        {compositeConditions.map((cond, i) => (
          <div key={i} className="flex items-center gap-1.5 mb-1.5">
            <input
              type="text"
              value={cond.event_type}
              onChange={(e) => {
                const updated = [...compositeConditions];
                updated[i] = { ...updated[i], event_type: e.target.value };
                setCompositeConditions(updated);
                if (validationError) setValidationError(null);
              }}
              placeholder={t.triggers.composite_event_type_placeholder}
              aria-invalid={!!validationError}
              aria-describedby={validationError ? 'composite-conditions-error' : undefined}
              className={`flex-1 px-3 py-2 bg-background/50 border rounded-modal text-foreground typo-body placeholder-muted-foreground/30 focus-ring transition-all ${
                validationError ? 'border-red-500/30' : 'border-primary/15'
              }`}
            />
            <input
              type="text"
              value={cond.source_filter || ''}
              onChange={(e) => {
                const updated = [...compositeConditions];
                const existing = updated[i]!;
                updated[i] = { event_type: existing.event_type, source_filter: e.target.value || undefined };
                setCompositeConditions(updated);
              }}
              placeholder={t.triggers.source_filter_optional}
              className="w-40 px-3 py-2 bg-background/50 border border-primary/15 rounded-modal text-foreground typo-body placeholder-muted-foreground/30 focus-ring transition-all"
            />
            {compositeConditions.length > 1 && (
              <button type="button" onClick={() => setCompositeConditions(compositeConditions.filter((_, j) => j !== i))} className="p-1.5 text-foreground hover:text-red-400 transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
        <button type="button" onClick={() => setCompositeConditions([...compositeConditions, { event_type: '' }])} className="flex items-center gap-1 typo-body text-rose-400/80 hover:text-rose-400 transition-colors">
          <Plus className="w-3.5 h-3.5" /> {t.triggers.composite.add_condition}
        </button>
      </TriggerFieldGroup>
      <TriggerFieldGroup label={t.triggers.op_all_label ? 'Operator' : 'Operator'}>
        <div className="flex gap-1.5">
          {([
            { value: 'all', label: 'ALL (AND)', desc: 'All conditions must match' },
            { value: 'any', label: 'ANY (OR)', desc: 'At least one condition' },
            { value: 'sequence', label: 'Sequence', desc: 'Conditions in order' },
          ] as const).map((op) => (
            <button
              key={op.value}
              type="button"
              onClick={() => setCompositeOperator(op.value)}
              className={`px-3 py-1.5 rounded-modal typo-body font-medium transition-all border ${
                compositeOperator === op.value
                  ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                  : 'bg-secondary/30 text-foreground border-border/30 hover:bg-secondary/50'
              }`}
              title={op.desc}
            >
              {op.label}
            </button>
          ))}
        </div>
      </TriggerFieldGroup>
      <TriggerFieldGroup
        label={t.triggers.composite.window_label}
        helpText={t.triggers.time_window_help}
      >
        <input
          type="number"
          value={windowSeconds}
          onChange={(e) => { setWindowSeconds(e.target.value); if (validationError) setValidationError(null); }}
          min="5"
          placeholder={t.triggers.composite_debounce_placeholder}
          className="w-32 px-3 py-2 bg-background/50 border border-primary/15 rounded-modal text-foreground font-mono typo-code focus-ring transition-all"
        />
      </TriggerFieldGroup>
    </div>
  );
}
