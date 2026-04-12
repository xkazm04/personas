import { useTranslation } from '@/i18n/useTranslation';
import { Wifi, Stethoscope, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { DEPLOYMENT_TOKENS } from '../deploymentTokens';
import { FormField } from '@/features/shared/components/forms/FormField';
import { useFieldValidation } from '@/features/shared/components/forms/useFieldValidation';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import type { CloudDiagnostics } from '@/api/system/cloud';

export interface CloudConnectionFormProps {
  isConnected: boolean;
  config: { url: string; is_connected: boolean } | null;
  url: string;
  setUrl: (v: string) => void;
  apiKey: string;
  setApiKey: (v: string) => void;
  isConnecting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  diagnostics: CloudDiagnostics | null;
  isDiagnosing: boolean;
  onDiagnose: () => void;
}

export function CloudConnectionForm({
  isConnected,
  config,
  url,
  setUrl,
  apiKey,
  setApiKey,
  isConnecting,
  onConnect,
  onDisconnect,
  diagnostics,
  isDiagnosing,
  onDiagnose,
}: CloudConnectionFormProps) {
  const { t } = useTranslation();
  const dt = t.deployment.connection;
  const urlValidation = useFieldValidation({
    validate: (value) => {
      try {
        const u = new URL(value);
        if (!['http:', 'https:'].includes(u.protocol)) return dt.url_protocol_error;
        if (!u.hostname) return dt.url_hostname_error;
        return null;
      } catch {
        return dt.url_invalid;
      }
    },
    debounceMs: 300,
    minLength: 8,
  });

  if (isConnected) {
    return (
      <div className={DEPLOYMENT_TOKENS.panelSpacing}>
        <div className={`flex items-center gap-3 p-4 ${DEPLOYMENT_TOKENS.cardRadius} ${DEPLOYMENT_TOKENS.connectedBg} border ${DEPLOYMENT_TOKENS.connectedBorder}`}>
          <Wifi className="w-5 h-5 text-emerald-400" />
          <div>
            <p className="text-sm font-medium text-emerald-400">{dt.connected}</p>
            <p className="text-sm text-muted-foreground/80 mt-0.5">
              {dt.orchestrator_prefix} {config?.url}
            </p>
          </div>
        </div>

        <button
          onClick={onDisconnect}
          className="px-4 py-2 text-sm font-medium rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors cursor-pointer"
        >
          {dt.disconnect}
        </button>
      </div>
    );
  }

  return (
    <div className={`max-w-md ${DEPLOYMENT_TOKENS.panelSpacing}`}>
      <FormField
        label={dt.orchestrator_url_label}
        validationState={urlValidation.validationState}
        error={urlValidation.error}
      >
        {(inputProps) => (
          <input
            {...inputProps}
            type="text"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              urlValidation.onChange(e.target.value);
            }}
            placeholder="https://your-orchestrator.example.com"
            className={`${INPUT_FIELD} ${isConnecting ? 'border-indigo-500/35 bg-indigo-500/5' : ''}`}
          />
        )}
      </FormField>

      <FormField label={t.deployment.api_key}>
        {(inputProps) => (
          <input
            {...inputProps}
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={dt.enter_api_key}
            className={`${INPUT_FIELD} ${isConnecting ? 'border-indigo-500/35 bg-indigo-500/5' : ''}`}
          />
        )}
      </FormField>

      <div className="flex items-center gap-2">
        <button
          onClick={onConnect}
          disabled={isConnecting || !url.trim() || !apiKey.trim()}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl bg-indigo-500 text-foreground hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          {isConnecting ? (
            <span role="status" aria-live="polite" className="inline-flex items-center gap-2">
              <LoadingSpinner />
              <span>{t.deployment.connecting}</span>
              <span className="sr-only">{t.deployment.sr_connecting}</span>
            </span>
          ) : (
            dt.connect
          )}
        </button>

        <button
          onClick={onDiagnose}
          disabled={isDiagnosing || !url.trim() || !apiKey.trim()}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl bg-secondary/40 border border-primary/15 text-muted-foreground/80 hover:text-foreground/95 hover:border-primary/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          {isDiagnosing ? (
            <span className="inline-flex items-center gap-2">
              <LoadingSpinner />
              <span>{dt.diagnosing}</span>
            </span>
          ) : (
            <>
              <Stethoscope className="w-4 h-4" />
              {dt.diagnose}
            </>
          )}
        </button>
      </div>

      {diagnostics && <DiagnosticsPanel diagnostics={diagnostics} />}
    </div>
  );
}

function DiagnosticsPanel({ diagnostics }: { diagnostics: CloudDiagnostics }) {
  const { t } = useTranslation();
  const dt = t.deployment.connection;
  const allPassed = diagnostics.steps.every((s) => s.passed);

  return (
    <div
      className={`p-4 rounded-xl border ${
        allPassed
          ? 'bg-emerald-500/5 border-emerald-500/20'
          : 'bg-red-500/5 border-red-500/20'
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <p className={`text-sm font-medium ${allPassed ? 'text-emerald-400' : 'text-red-400'}`}>
          {dt.diagnostics_title}
        </p>
        <div className="flex items-center gap-1 text-xs text-muted-foreground/60">
          <Clock className="w-3 h-3" />
          {diagnostics.totalDurationMs}ms
        </div>
      </div>

      <ul className="space-y-2" role="list" aria-label={dt.diagnostics_title}>
        {diagnostics.steps.map((step, i) => (
          <li key={i} className="flex items-start gap-2.5">
            {step.passed ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
            ) : (
              <XCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground/90">{step.label}</span>
                <span className="text-xs text-muted-foreground/50">{step.durationMs}ms</span>
              </div>
              <p className={`text-xs mt-0.5 ${step.passed ? 'text-muted-foreground/60' : 'text-red-400/80'}`}>
                {step.detail}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
