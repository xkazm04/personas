import { useMemo } from 'react';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import {
  type FieldInputType,
  type ValidationGlow,
  computeValidationGlow,
  GLOW_CLASSES,
  FieldActionButtons,
} from './FieldCaptureHelpers';

type FieldCaptureSource = 'schema' | 'negotiator' | 'auto';
type FieldCaptureMode = 'readonly' | 'editable' | 'confirming';

interface FieldCaptureRowProps {
  source: FieldCaptureSource;
  mode: FieldCaptureMode;
  label: string;
  value: string;
  onChange?: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  required?: boolean;
  hint?: string;
  helpText?: string;
  error?: string;
  inputType?: FieldInputType;
  options?: string[];
  allowPaste?: boolean;
  allowCopy?: boolean;
  testIdBase?: string;
}

const SOURCE_ACCENT: Record<FieldCaptureSource, string> = {
  schema: 'focus-visible:ring-primary/40',
  negotiator: 'focus-visible:ring-violet-500/40',
  auto: 'focus-visible:ring-emerald-500/35',
};

export function FieldCaptureRow({
  source,
  mode,
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  required,
  hint,
  helpText,
  error,
  inputType = 'text',
  options,
  allowPaste = false,
  allowCopy = true,
  testIdBase,
}: FieldCaptureRowProps) {
  const isEditable = mode !== 'readonly' && !!onChange;
  const isSecret = inputType === 'password';
  const fieldId = testIdBase ?? label.toLowerCase().replace(/\s+/g, '-');
  const errorId = `${fieldId}-error`;

  const { isVisible, buttons } = FieldActionButtons({
    mode,
    value,
    isSecret,
    isEditable,
    allowCopy,
    allowPaste,
    testIdBase,
    onChange,
  });

  const glow: ValidationGlow = useMemo(
    () => (isEditable && inputType !== 'select') ? computeValidationGlow(value, inputType) : 'none',
    [value, inputType, isEditable],
  );

  const valueClass = mode === 'confirming'
    ? (value ? 'border-emerald-500/25 bg-emerald-500/5 text-foreground' : 'border-primary/15 bg-secondary/25 text-foreground')
    : 'border-border/50 bg-background/50 text-foreground';

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="typo-body font-medium text-foreground">
          {label}
          {required && <span className="text-red-400 ml-1">*</span>}
        </label>
        {buttons}
      </div>

      {hint && <p className="typo-body text-foreground">{hint}</p>}

      {inputType === 'select' && options ? (
        <ThemedSelect
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          onBlur={onBlur}
          disabled={!isEditable}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          className={`rounded-modal ${error ? 'border-red-500/50' : ''}`}
        >
          <option value="">{placeholder || 'Select...'}</option>
          {options.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </ThemedSelect>
      ) : (
        <input
          type={isSecret && !isVisible ? 'password' : inputType === 'url' ? 'url' : 'text'}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          onBlur={onBlur}
          disabled={!isEditable}
          placeholder={placeholder}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          className={`w-full px-3 py-2 border rounded-modal typo-body focus-visible:outline-none focus-visible:ring-2 transition-all duration-300 placeholder-muted-foreground/30 disabled:opacity-70 disabled:cursor-not-allowed ${SOURCE_ACCENT[source]} ${error ? 'border-red-500/50' : glow !== 'none' ? GLOW_CLASSES[glow] : valueClass}`}
          data-testid={testIdBase ? `${testIdBase}-input` : undefined}
        />
      )}

      {error ? (
        <p id={errorId} className="typo-body text-red-400">{error}</p>
      ) : (
        (helpText ? <p className="typo-body text-foreground">{helpText}</p> : null)
      )}
    </div>
  );
}
