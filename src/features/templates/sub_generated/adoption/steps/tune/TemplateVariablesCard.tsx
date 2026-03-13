import { Sliders, AlertCircle } from 'lucide-react';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { validateVariable } from '@/lib/utils/sanitizers/variableSanitizer';
import type { AdoptionRequirement } from '@/lib/types/designTypes';
import { DebouncedVariableInput } from '../data/DebouncedVariableInput';
import { cardClass, descClass, fieldClass, inputClass, labelClass } from './tuneStepConstants';

export function TemplateVariablesCard({
  adoptionRequirements,
  variableValues,
  onUpdateVariable,
}: {
  adoptionRequirements: AdoptionRequirement[];
  variableValues: Record<string, string>;
  onUpdateVariable: (key: string, value: string) => void;
}) {
  return (
    <div className={cardClass}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-muted-foreground/60"><Sliders className="w-4 h-4" /></span>
        <span className="text-sm font-medium text-foreground/70">Template Configuration</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 3xl:grid-cols-3 gap-3">
        {adoptionRequirements.map((variable) => {
          const value = variableValues[variable.key] ?? variable.default_value ?? '';
          const validation = value.trim() ? validateVariable(value, variable) : null;
          const hasError = validation && !validation.valid;
          const isEmpty = variable.required && !value.trim();
          const showError = hasError || isEmpty;

          return (
            <div key={variable.key} className={fieldClass}>
              <label className={labelClass}>
                {variable.label}
                {variable.required && <span className="text-red-400 ml-0.5">*</span>}
                {variable.type !== 'text' && variable.type !== 'select' && (
                  <span className="ml-1.5 text-sm text-muted-foreground/60 font-normal">{variable.type}</span>
                )}
              </label>
              {variable.description && <p className={descClass}>{variable.description}</p>}

              {variable.type === 'select' && variable.options ? (
                <ThemedSelect
                  value={value}
                  onChange={(e) => onUpdateVariable(variable.key, e.target.value)}
                  aria-invalid={showError}
                  aria-describedby={hasError ? `var-${variable.key}-error` : undefined}
                  className={`py-1.5 px-2.5 ${showError ? '!border-red-500/30' : ''}`}
                >
                  <option value="">Select...</option>
                  {variable.options.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </ThemedSelect>
              ) : (
                <DebouncedVariableInput
                  variable={variable}
                  value={value}
                  onUpdate={onUpdateVariable}
                  inputClass={inputClass}
                  showError={showError}
                  errorId={hasError ? `var-${variable.key}-error` : undefined}
                />
              )}

              {hasError && (
                <p id={`var-${variable.key}-error`} className="flex items-center gap-1 text-sm text-red-400/80 mt-0.5">
                  <AlertCircle className="w-3 h-3 flex-shrink-0" />
                  {validation.error}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
