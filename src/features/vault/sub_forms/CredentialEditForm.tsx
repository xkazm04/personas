import { useState, useCallback, useEffect } from 'react';
import { Activity, CheckCircle, Loader2, Info, Lock, Save, Shield } from 'lucide-react';
import type { CredentialTemplateField } from '@/lib/types/types';
import { vaultStatus, type VaultStatus } from '@/api/tauriApi';
import { FieldCaptureRow } from './FieldCaptureRow';
import { HealthcheckResultDisplay } from './HealthcheckResultDisplay';

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
  const [showTestHint, setShowTestHint] = useState(false);
  const [vault, setVault] = useState<VaultStatus | null>(null);

  useEffect(() => {
    vaultStatus().then(setVault).catch(() => {});
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
    if (validate()) {
      onSave(values);
    }
  };

  const handleHealthcheck = () => {
    if (validate()) {
      onHealthcheck?.(values);
    }
  };

  const handleOAuthConsent = () => {
    if (validate()) {
      onOAuthConsent?.(values);
    }
  };

  return (
    <div className="space-y-4">
      {/* ── Credential Fields ── */}
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

      {/* ── Authentication ── */}
      {onOAuthConsent && (
        <>
          <div className="border-t border-primary/8" />
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground/50 mb-3">
              Authentication
            </h4>
            <button
              onClick={handleOAuthConsent}
              type="button"
              disabled={oauthConsentDisabled}
              className="flex items-center gap-2 px-4 py-2 border rounded-xl text-sm font-medium transition-all bg-blue-500/10 hover:bg-blue-500/20 border-blue-500/25 text-blue-300 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Shield className="w-4 h-4" />
              {oauthConsentLabel || 'Authorize with Google'}
            </button>
            {oauthConsentHint && (
              <p className="mt-1.5 text-sm text-muted-foreground/60">{oauthConsentHint}</p>
            )}
            {oauthConsentSuccessBadge && (
              <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/25 text-emerald-300 text-sm">
                <CheckCircle className="w-3.5 h-3.5" />
                {oauthConsentSuccessBadge}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Connection Test ── */}
      {onHealthcheck && (
        <>
          <div className="border-t border-primary/8" />
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground/50 mb-3">
              Connection Test
            </h4>
            <div className="flex items-center gap-2">
              <button
                onClick={handleHealthcheck}
                disabled={isHealthchecking}
                className={`flex items-center gap-2 px-4 py-2 border rounded-xl text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                  healthcheckResult?.success
                    ? 'bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/20 text-emerald-400'
                    : 'bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/25 text-amber-300'
                }`}
              >
                {isHealthchecking ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Activity className="w-4 h-4" />
                )}
                Test Connection
              </button>

              {testHint && (
                <div
                  className="relative"
                  onMouseEnter={() => setShowTestHint(true)}
                  onMouseLeave={() => setShowTestHint(false)}
                >
                  <button
                    type="button"
                    className="p-1.5 rounded-full border border-primary/15 text-muted-foreground/80 hover:text-foreground hover:bg-secondary/40 transition-colors"
                  >
                    <Info className="w-3.5 h-3.5" />
                  </button>
                  {showTestHint && (
                    <div className="absolute left-8 top-1/2 -translate-y-1/2 w-72 px-3 py-2 rounded-lg bg-background border border-primary/20 shadow-xl text-sm text-foreground/85 z-20">
                      {testHint}
                    </div>
                  )}
                </div>
              )}
            </div>

            {healthcheckResult && (
              <HealthcheckResultDisplay
                success={healthcheckResult.success}
                message={healthcheckResult.message}
              />
            )}
          </div>
        </>
      )}

      {/* ── Actions ── */}
      <div className="border-t border-primary/8" />
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {vault && fields.some((f) => f.type === 'password') && (
            <div className="flex items-center gap-1.5 text-sm text-emerald-400/70">
              <Lock className="w-3 h-3" />
              <span>
                {vault.key_source === 'keychain'
                  ? 'Encrypted with OS Keychain'
                  : 'Encrypted at rest'}
              </span>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-secondary/60 hover:bg-secondary text-foreground/90 rounded-xl text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saveDisabled}
            className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-foreground rounded-xl text-sm font-medium transition-all shadow-lg shadow-primary/20 disabled:opacity-45 disabled:cursor-not-allowed"
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {isSaving ? 'Saving...' : 'Save Credential'}
          </button>
        </div>
      </div>

      {saveDisabled && saveDisabledReason && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-sm text-amber-300">
          <Info className="w-3.5 h-3.5 shrink-0" />
          <span>{saveDisabledReason}</span>
        </div>
      )}
    </div>
  );
}
