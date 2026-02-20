import { useState, useCallback, useEffect } from 'react';
import { Eye, EyeOff, Activity, CheckCircle, XCircle, Loader2, Info, Lock, Shield } from 'lucide-react';
import type { CredentialTemplateField } from '@/lib/types/types';
import { vaultStatus, type VaultStatus } from '@/api/tauriApi';

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

  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showTestHint, setShowTestHint] = useState(false);
  const [vault, setVault] = useState<VaultStatus | null>(null);

  useEffect(() => {
    vaultStatus().then(setVault).catch(() => {});
  }, []);

  useEffect(() => {
    if (!initialValues) return;
    setValues((prev) => ({ ...prev, ...initialValues }));
  }, [initialValues]);

  const handleChange = useCallback((key: string, value: string) => {
    setValues(prev => ({ ...prev, [key]: value }));
    onValuesChanged?.(key, value);
    if (errors[key]) {
      setErrors(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }, [errors, onValuesChanged]);

  const togglePassword = useCallback((key: string) => {
    setShowPasswords(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    for (const field of fields) {
      if (field.required && !values[field.key]?.trim()) {
        newErrors[field.key] = `${field.label} is required`;
      }
    }
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
    onOAuthConsent?.(values);
  };

  return (
    <div className="space-y-4">
      {fields.map((field) => (
        <div key={field.key}>
          <label className="block text-sm font-medium text-foreground/80 mb-1.5">
            {field.label}
            {field.required && <span className="text-red-400 ml-1">*</span>}
          </label>

          <div className="relative">
            <input
              type={field.type === 'password' && !showPasswords[field.key] ? 'password' : 'text'}
              value={values[field.key] || ''}
              onChange={(e) => handleChange(field.key, e.target.value)}
              placeholder={field.placeholder}
              className={`w-full px-3 py-2 bg-background/50 border rounded-xl text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all placeholder-muted-foreground/30 ${
                field.type === 'password' ? 'pr-10' : ''
              } ${errors[field.key] ? 'border-red-500/50' : 'border-border/50'}`}
            />
            {field.type === 'password' && (
              <button
                type="button"
                onClick={() => togglePassword(field.key)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-muted-foreground/50 hover:text-foreground/70 transition-colors"
              >
                {showPasswords[field.key] ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            )}
          </div>

          {errors[field.key] && (
            <p className="mt-1 text-xs text-red-400">{errors[field.key]}</p>
          )}
          {field.helpText && !errors[field.key] && (
            <p className="mt-1 text-xs text-muted-foreground/70">{field.helpText}</p>
          )}
        </div>
      ))}

      {/* Encryption reassurance */}
      {vault && fields.some((f) => f.type === 'password') && (
        <div className="flex items-center gap-1.5 text-[11px] text-emerald-400/70">
          <Lock className="w-3 h-3" />
          <span>
            {vault.key_source === 'keychain'
              ? 'Encrypted with OS Keychain'
              : 'Encrypted at rest'}
          </span>
        </div>
      )}

      {/* OAuth Consent */}
      {onOAuthConsent && (
        <div className="pt-1">
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
            <p className="mt-1.5 text-xs text-muted-foreground/75">{oauthConsentHint}</p>
          )}
          {oauthConsentSuccessBadge && (
            <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/25 text-emerald-300 text-xs">
              <CheckCircle className="w-3.5 h-3.5" />
              {oauthConsentSuccessBadge}
            </div>
          )}
        </div>
      )}

      {/* Healthcheck */}
      {onHealthcheck && (
        <div className="pt-2">
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
                  <div className="absolute left-8 top-1/2 -translate-y-1/2 w-72 px-3 py-2 rounded-lg bg-background border border-primary/20 shadow-xl text-xs text-foreground/85 z-20">
                    {testHint}
                  </div>
                )}
              </div>
            )}
          </div>

          {healthcheckResult && (
            <div className={`mt-2 flex items-start gap-2 px-3 py-2 rounded-xl text-sm ${
              healthcheckResult.success
                ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                : 'bg-red-500/10 border border-red-500/20 text-red-400'
            }`}>
              {healthcheckResult.success ? (
                <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              )}
              <span>{healthcheckResult.message}</span>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2">
        <button
          onClick={onCancel}
          className="px-4 py-2 bg-secondary/60 hover:bg-secondary text-foreground/70 rounded-xl text-sm transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saveDisabled}
          title={saveDisabled ? saveDisabledReason : undefined}
          className="px-4 py-2 bg-primary hover:bg-primary/90 text-foreground rounded-xl text-sm font-medium transition-all shadow-lg shadow-primary/20 disabled:opacity-45 disabled:cursor-not-allowed"
        >
          Save Credential
        </button>
      </div>

      {saveDisabled && saveDisabledReason && (
        <p className="text-xs text-amber-300 text-right">{saveDisabledReason}</p>
      )}
    </div>
  );
}
