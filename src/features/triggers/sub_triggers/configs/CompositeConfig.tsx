import { Plus, X } from 'lucide-react';
import type { CompositeCondition } from '@/lib/utils/platform/triggerConstants';
import { TriggerFieldGroup } from './TriggerFieldGroup';
import { useTranslation } from '@/i18n/useTranslation';
import { NumberStepper } from '@/features/shared/components/forms/NumberStepper';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

/** The catalog carries this label as an inline "Operator:" prefix; a field
 *  label takes it without the trailing colon (ASCII, full-width, or the
 *  French spaced form). */
function fieldLabel(prefix: string): string {
  return prefix.replace(/s*[:：]s*$/, '');
}

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
      <TriggerFieldGroup label={fieldLabel(t.triggers.operator_colon)}>
        <div className="flex gap-1.5">
          {([
            { value: 'all', label: t.triggers.op_all_label, desc: t.triggers.op_all_desc },
            { value: 'any', label: t.triggers.op_any_label, desc: t.triggers.op_any_desc },
            { value: 'sequence', label: t.triggers.op_sequence_label, desc: t.triggers.op_sequence_desc },
          ] as const).map((op) => (
            <Tooltip key={op.value} content={op.desc}>
              <button
                type="button"
                aria-pressed={compositeOperator === op.value}
                onClick={() => setCompositeOperator(op.value)}
                className={`px-3 py-1.5 rounded-modal typo-body transition-all border ${
                  compositeOperator === op.value
                    ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                    : 'bg-secondary/30 text-foreground border-border/30 hover:bg-secondary/50'
                }`}
              >
                {op.label}
              </button>
            </Tooltip>
          ))}
        </div>
      </TriggerFieldGroup>
      <TriggerFieldGroup
        label={t.triggers.composite.window_label}
        helpText={t.triggers.time_window_help}
      >
        <NumberStepper
          value={windowSeconds.trim() === '' ? null : Number(windowSeconds)}
          onChange={(v) => { setWindowSeconds(v == null ? '' : String(v)); if (validationError) setValidationError(null); }}
          min={5}
          allowEmpty
          placeholder={t.triggers.composite_debounce_placeholder}
          ariaLabel={t.triggers.composite.window_label}
          className="w-32"
        />
      </TriggerFieldGroup>
    </div>
  );
}
