import { useState, useCallback, useEffect, useMemo } from 'react';
import { Eye, EyeOff, Activity, CheckCircle, XCircle, Loader2, Info, Lock, Shield, ChevronDown } from 'lucide-react';
import type { CredentialTemplateField } from '@/lib/types/types';
import { vaultStatus, type VaultStatus } from '@/api/tauriApi';
import { translateHealthcheckMessage } from '@/features/vault/components/credential-design/CredentialDesignHelpers';

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

function HealthcheckResultDisplay({ success, message }: { success: boolean; message: string }) {
  const [showDetails, setShowDetails] = useState(false);
  const translated = useMemo(() => translateHealthcheckMessage(message), [message]);
  const hasDifferentRaw = translated.raw !== translated.friendly;
  const hasSuggestion = translated.suggestion.length > 0;

  if (success) {
    return (
      <div className="mt-2 flex items-start gap-2 px-3 py-2 rounded-xl text-sm bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
        <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <span>{message}</span>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-xl bg-red-500/10 border border-red-500/20 overflow-hidden">
      <div className="flex items-start gap-2 px-3 py-2">
        <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-400" />
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-sm text-red-300">{translated.friendly}</p>
          {hasSuggestion && (
            <p className="text-sm text-red-300/60">{translated.suggestion}</p>
          )}
        </div>
      </div>

      {hasDifferentRaw && (
        <div className="border-t border-red-500/10">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="w-full flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-400/40 hover:text-red-400/60 transition-colors"
          >
            <ChevronDown className={`w-3 h-3 transition-transform ${showDetails ? 'rotate-180' : ''}`} />
            Technical details
          </button>
          {showDetails && (
            <p className="px-3 pb-2 text-sm text-red-400/30 font-mono break-all">
              {translated.raw}
            </p>
          )}
        </div>
      )}
    </div>
  );
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
    if (validate()) {
      onOAuthConsent?.(values);
    }
  };

  return (
    <div className="space-y-5">
      {/* ── Credential Fields ── */}
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/50 mb-3">
          Credential Fields
        </h4>
        <div className="space-y-3">
          {fields.map((field) => (
            <div key={field.key}>
              <label className="block text-sm font-medium text-foreground/80 mb-1.5">
                {field.label}
                {field.required && <span className="text-red-400 ml-1">*</span>}
              </label>

              <div className="relative">
                {field.type === 'select' && field.options ? (
                  <select
                    value={values[field.key] || ''}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                    className={`w-full px-3 py-2 bg-background/50 border rounded-xl text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all ${
                      errors[field.key] ? 'border-red-500/50' : 'border-border/50'
                    }`}
                  >
                    <option value="">{field.placeholder || 'Select...'}</option>
                    {field.options.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                ) : (
                  <>
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
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-muted-foreground/90 hover:text-foreground/95 transition-colors"
                      >
                        {showPasswords[field.key] ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    )}
                  </>
                )}
              </div>

              {errors[field.key] && (
                <p className="mt-1 text-xs text-red-400">{errors[field.key]}</p>
              )}
              {field.helpText && !errors[field.key] && (
                <p className="mt-1 text-xs text-muted-foreground/60">{field.helpText}</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Authentication ── */}
      {onOAuthConsent && (
        <>
          <div className="border-t border-primary/8" />
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/50 mb-3">
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
              <p className="mt-1.5 text-xs text-muted-foreground/60">{oauthConsentHint}</p>
            )}
            {oauthConsentSuccessBadge && (
              <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/25 text-emerald-300 text-xs">
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
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/50 mb-3">
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
                    <div className="absolute left-8 top-1/2 -translate-y-1/2 w-72 px-3 py-2 rounded-lg bg-background border border-primary/20 shadow-xl text-xs text-foreground/85 z-20">
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
            <div className="flex items-center gap-1.5 text-xs text-emerald-400/70">
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
            className="px-4 py-2 bg-primary hover:bg-primary/90 text-foreground rounded-xl text-sm font-medium transition-all shadow-lg shadow-primary/20 disabled:opacity-45 disabled:cursor-not-allowed"
          >
            Save Credential
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
