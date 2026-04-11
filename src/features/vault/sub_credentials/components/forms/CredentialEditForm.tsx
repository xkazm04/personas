import { useState, useCallback, useEffect } from 'react';
import type { CredentialTemplateField } from '@/lib/types/types';
import { vaultStatus, type VaultStatus } from "@/api/vault/credentials";
import { toastCatch } from "@/lib/silentCatch";

import { OAuthSection } from './OAuthSection';
import { ConnectionTestSection } from './ConnectionTestSection';
import { FormActions } from './FormActions';
import { EditFormFields, useFieldValidation } from './EditFormFields';

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
  isAuthorizingOAuth?: boolean;
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
  const { validateField, validateAll } = useFieldValidation(fields);

  useEffect(() => {
    vaultStatus().then(setVault).catch(toastCatch("CredentialEditForm:fetchVaultStatus", "Failed to check vault status"));
  }, []);

  useEffect(() => {
    if (!initialValues) return;
    setValues((prev) => ({ ...prev, ...initialValues }));
  }, [initialValues]);

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
    const newErrors = validateAll(values);
    setTouched(Object.fromEntries(fields.map((f) => [f.key, true])));
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = () => { if (validate()) onSave(values); };
  const handleHealthcheck = () => { if (validate()) onHealthcheck?.(values); };
  const handleOAuthConsent = () => { if (validate()) onOAuthConsent?.(values); };

  return (
    <div className="space-y-4">
      <EditFormFields
        fields={fields}
        values={values}
        errors={errors}
        touched={touched}
        onValueChange={handleChange}
        onBlur={handleBlur}
      />

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
