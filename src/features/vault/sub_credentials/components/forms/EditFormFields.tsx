import { useCallback } from 'react';
import type { CredentialTemplateField } from '@/lib/types/types';
import { FieldCaptureRow } from './FieldCaptureRow';
import { useTranslation } from '@/i18n/useTranslation';

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
  const { t } = useTranslation();
  return (
    <div>
      <h4 className="typo-heading uppercase text-foreground mb-3">
        {t.vault.forms.credential_fields_heading}
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
  const { t, tx } = useTranslation();
  const requiredMsg = t.vault.credential_forms.name_required;
  const invalidUrlMsg = t.vault.auto_cred_extra.invalid_url;
  const validateField = useCallback((field: CredentialTemplateField, value: string): string | null => {
    const trimmed = value.trim();
    if (field.required && !trimmed) {
      return tx(requiredMsg, { label: field.label });
    }
    if (trimmed && field.type === 'url') {
      // One message for both failures: it already says "starting with http:// or https://".
      try {
        const parsed = new URL(trimmed);
        if (!['http:', 'https:'].includes(parsed.protocol)) return invalidUrlMsg;
      } catch {
        return invalidUrlMsg;
      }
    }
    return null;
  }, [tx, requiredMsg, invalidUrlMsg]);

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
