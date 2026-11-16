import { useTranslation } from '@/i18n/useTranslation';
import { Wifi, Stethoscope, CheckCircle2, XCircle, Clock } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { DEPLOYMENT_TOKENS } from '../deploymentTokens';
import { FormField } from '@/features/shared/components/forms/FormField';
import { PasswordToggleField } from '@/features/shared/components/forms/PasswordToggleField';
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
          <Wifi className="w-5 h-5 text-status-success" />
          <div>
            <p className="typo-body text-status-success">{dt.connected}</p>
            {/* The backend stores the validated URL WITH its scheme
                (cloud_connect -> store_cloud_config(normalized)); a prefix
                here doubled it and claimed https for an http orchestrator. */}
            <p className="typo-body text-ink-2 mt-0.5">{config?.url}</p>
          </div>
        </div>

        <Button type="button" onClick={onDisconnect} variant="danger" size="md">{dt.disconnect}</Button>
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
            placeholder={dt.orchestrator_url_placeholder}
            className={`${INPUT_FIELD} ${isConnecting ? 'border-role-agent/35 bg-role-agent/5' : ''}`}
          />
        )}
      </FormField>

      <FormField label={t.deployment.api_key}>
        {(inputProps) => (
          <PasswordToggleField
            {...inputProps}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={dt.enter_api_key}
            inputClassName={`${INPUT_FIELD} ${isConnecting ? 'border-role-agent/35 bg-role-agent/5' : ''}`}
          />
        )}
      </FormField>

      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          size="md"
          onClick={onConnect}
          disabled={!url.trim() || !apiKey.trim()}
          loading={isConnecting}
          loadingLabel={t.deployment.connecting}
        >
          {dt.connect}
        </Button>

        <Button
          variant="secondary"
          size="md"
          onClick={onDiagnose}
          disabled={!url.trim() || !apiKey.trim()}
          loading={isDiagnosing}
          loadingLabel={dt.diagnosing}
          icon={<Stethoscope className="w-4 h-4" />}
        >
          {dt.diagnose}
        </Button>
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
      className={`p-4 rounded-modal border ${
        allPassed
          ? 'bg-status-success/5 border-status-success/20'
          : 'bg-status-error/5 border-status-error/20'
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <p className={`typo-body ${allPassed ? 'text-status-success' : 'text-status-error'}`}>
          {dt.diagnostics_title}
        </p>
        <div className="flex items-center gap-1 typo-caption text-ink-2">
          <Clock className="w-3 h-3" />
          {diagnostics.totalDurationMs}ms
        </div>
      </div>

      <ul className="space-y-2" role="list" aria-label={dt.diagnostics_title}>
        {diagnostics.steps.map((step, i) => (
          <li key={i} className="flex items-start gap-2.5">
            {step.passed ? (
              <CheckCircle2 className="w-4 h-4 text-status-success mt-0.5 shrink-0" />
            ) : (
              <XCircle className="w-4 h-4 text-status-error mt-0.5 shrink-0" />
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="typo-body text-ink-1">{step.label}</span>
                <span className="typo-caption text-ink-2">{step.durationMs}ms</span>
              </div>
              <p className={`typo-caption mt-0.5 ${step.passed ? 'text-ink-1' : 'text-status-error'}`}>
                {step.detail}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
