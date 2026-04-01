import { useCallback } from 'react';
import type { CredentialTemplateField } from '@/lib/types/types';
import { FieldCaptureRow } from './FieldCaptureRow';

interface EditFormFieldsProps {
  fields: CredentialTemplateField[];
  values: Record<string, string>;
  errors: Record<string, string>;
  touched: Record<string, boolean>;
  onValueChange: (key: string, value: string) => void;
  onBlur: (key: string) => void;
}

export function EditFormFields({
  fields,
  values,
  errors,
  touched,
  onValueChange,
  onBlur,
}: EditFormFieldsProps) {
  return (
    <div>
      <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground/50 mb-3">
        Credential Fields
      </h4>
      <div className="space-y-3">
        {fields.map((field) => (
          <FieldCaptureRow
            key={field.key}
            source="schema"
            mode="editable"
            testIdBase={`vault-field-${field.key}`}
            label={field.label}
            value={values[field.key] || ''}
            onChange={(nextValue) => onValueChange(field.key, nextValue)}
            onBlur={() => onBlur(field.key)}
            placeholder={field.placeholder}
            required={field.required}
            helpText={field.helpText}
            error={touched[field.key] ? errors[field.key] : undefined}
            inputType={field.type === 'select' ? 'select' : field.type === 'password' ? 'password' : field.type === 'url' ? 'url' : 'text'}
            options={field.options}
            allowCopy
          />
        ))}
      </div>
    </div>
  );
}

export function useFieldValidation(fields: CredentialTemplateField[]) {
  const validateField = useCallback((field: CredentialTemplateField, value: string): string | null => {
    const trimmed = value.trim();
    if (field.required && !trimmed) {
      return `${field.label} is required`;
    }
    if (trimmed && field.type === 'url') {
      try {
        const parsed = new URL(trimmed);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          return `${field.label} must use http or https`;
        }
      } catch {
        return `${field.label} must be a valid URL`;
      }
    }
    return null;
  }, []);

  const validateAll = useCallback((values: Record<string, string>): Record<string, string> => {
    const newErrors: Record<string, string> = {};
    for (const field of fields) {
      const maybeError = validateField(field, values[field.key] ?? '');
      if (maybeError) newErrors[field.key] = maybeError;
    }
    return newErrors;
  }, [fields, validateField]);

  return { validateField, validateAll };
}
