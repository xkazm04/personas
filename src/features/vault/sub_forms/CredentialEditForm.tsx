import { useState, useCallback, useEffect } from 'react';
import type { CredentialTemplateField } from '@/lib/types/types';
import { vaultStatus, type VaultStatus } from "@/api/vault/credentials";
import { silentCatch } from "@/lib/silentCatch";

import { FieldCaptureRow } from './FieldCaptureRow';
import { OAuthSection } from './OAuthSection';
import { ConnectionTestSection } from './ConnectionTestSection';
import { FormActions } from './FormActions';

interface CredentialEditFormProps {
  fields: CredentialTemplateField[];
  initialValues?: Record<string, string>;
  onSave: (values: Record<string, string>) => void;
  onCancel: () => void;
  onHealthcheck?: (values: Record<string, string>) => void;
  onOAuthConsent?: (values: Record<string, string>) => void;
  oauthConsentLabel?: string;
  oauthConsentHint?: string;
  oauthConsentDisabled?: boolean;
  oauthConsentSuccessBadge?: string;
  /** Whether an OAuth authorization is currently in progress */
  isAuthorizingOAuth?: boolean;
  /** Current status message from the OAuth polling hook */
  oauthPollingMessage?: { success: boolean; message: string } | null;
  testHint?: string;
  onValuesChanged?: (key: string, value: string) => void;
  isHealthchecking?: boolean;
  healthcheckResult?: { success: boolean; message: string } | null;
  isSaving?: boolean;
  saveDisabled?: boolean;
  saveDisabledReason?: string;
}

export function CredentialEditForm({
  fields,
  initialValues,
  onSave,
  onCancel,
  onHealthcheck,
  onOAuthConsent,
  oauthConsentLabel,
  oauthConsentHint,
  oauthConsentDisabled,
  oauthConsentSuccessBadge,
  isAuthorizingOAuth,
  oauthPollingMessage,
  testHint,
  onValuesChanged,
  isHealthchecking,
  healthcheckResult,
  isSaving,
  saveDisabled,
  saveDisabledReason,
}: CredentialEditFormProps) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const defaults: Record<string, string> = {};
    for (const field of fields) {
      defaults[field.key] = initialValues?.[field.key] ?? '';
    }
    return defaults;
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [vault, setVault] = useState<VaultStatus | null>(null);

  useEffect(() => {
    vaultStatus().then(setVault).catch(silentCatch("CredentialEditForm:fetchVaultStatus"));
  }, []);

  useEffect(() => {
    if (!initialValues) return;
    setValues((prev) => ({ ...prev, ...initialValues }));
  }, [initialValues]);

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

  const handleChange = useCallback((key: string, value: string) => {
    setValues(prev => ({ ...prev, [key]: value }));
    onValuesChanged?.(key, value);
    if (touched[key]) {
      const field = fields.find((f) => f.key === key);
      if (!field) return;
      const nextError = validateField(field, value);
      setErrors((prev) => {
        const next = { ...prev };
        if (nextError) next[key] = nextError;
        else delete next[key];
        return next;
      });
    }
  }, [onValuesChanged, touched, fields, validateField]);

  const handleBlur = useCallback((key: string) => {
    const field = fields.find((f) => f.key === key);
    if (!field) return;
    setTouched((prev) => ({ ...prev, [key]: true }));
    const nextError = validateField(field, values[key] ?? '');
    setErrors((prev) => {
      const next = { ...prev };
      if (nextError) next[key] = nextError;
      else delete next[key];
      return next;
    });
  }, [fields, values, validateField]);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    for (const field of fields) {
      const maybeError = validateField(field, values[field.key] ?? '');
      if (maybeError) newErrors[field.key] = maybeError;
    }
    setTouched(Object.fromEntries(fields.map((f) => [f.key, true])));
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = () => {
    if (validate()) onSave(values);
  };

  const handleHealthcheck = () => {
    if (validate()) onHealthcheck?.(values);
  };

  const handleOAuthConsent = () => {
    if (validate()) onOAuthConsent?.(values);
  };

  return (
    <div className="space-y-4">
      {/* Credential Fields */}
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
              onChange={(nextValue) => handleChange(field.key, nextValue)}
              onBlur={() => handleBlur(field.key)}
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

      {onOAuthConsent && (
        <OAuthSection
          onConsent={handleOAuthConsent}
          consentLabel={oauthConsentLabel}
          consentHint={oauthConsentHint}
          consentDisabled={oauthConsentDisabled}
          consentSuccessBadge={oauthConsentSuccessBadge}
          isAuthorizing={isAuthorizingOAuth}
          pollingMessage={oauthPollingMessage}
        />
      )}

      {onHealthcheck && (
        <ConnectionTestSection
          onTest={handleHealthcheck}
          isTesting={isHealthchecking}
          result={healthcheckResult}
          testHint={testHint}
        />
      )}

      <FormActions
        vault={vault}
        fields={fields}
        onSave={handleSave}
        onCancel={onCancel}
        isSaving={isSaving}
        saveDisabled={saveDisabled}
        saveDisabledReason={saveDisabledReason}
      />
    </div>
  );
}
