import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { copyText } from '@/hooks/utility/interaction/useCopyToClipboard';
import { Terminal, CheckCircle2, AlertCircle, Loader2, Copy, ExternalLink, RefreshCw } from 'lucide-react';
import {
  cliCheckInstalled,
  cliVerifyAuth,
  cliCaptureSave,
  type CliInstallStatus,
  type CliVerifyResult,
  type CliSpecInfo,
} from '@/api/auth/cliCapture';
import { extractMessage, toastCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import type { ConnectorDefinition } from '@/lib/types/types';
import Button from '@/features/shared/components/buttons/Button';

type PanelState =
  | { kind: 'checking' }
  | { kind: 'not_installed'; status: CliInstallStatus }
  | { kind: 'installed_unverified'; status: CliInstallStatus }
  | { kind: 'verifying' }
  | { kind: 'unauthenticated'; verify: CliVerifyResult }
  | { kind: 'authenticated'; verify: CliVerifyResult }
  | { kind: 'error'; raw: unknown };

interface CliConnectionPanelProps {
  connector: ConnectorDefinition;
  spec: CliSpecInfo;
  credentialName: string;
  onCredentialNameChange: (name: string) => void;
  onSaved: () => void | Promise<void>;
  onCancel: () => void;
}

export function CliConnectionPanel({
  connector,
  spec,
  credentialName,
  onCredentialNameChange,
  onSaved,
  onCancel,
}: CliConnectionPanelProps) {
  const { t, tx } = useTranslation();
  const l = t.vault.cli_panel;
  const nameId = useId();
  const [state, setState] = useState<PanelState>({ kind: 'checking' });
  const [saving, setSaving] = useState(false);


  const runInstallCheck = useCallback(async () => {
    setState({ kind: 'checking' });
    try {
      const status = await cliCheckInstalled(spec.service_type);
      if (!status.installed) {
        setState({ kind: 'not_installed', status });
      } else {
        setState({ kind: 'installed_unverified', status });
      }
    } catch (err) {
      setState({ kind: 'error', raw: err });
    }
  }, [spec.service_type]);

  const runVerify = useCallback(async () => {
    setState({ kind: 'verifying' });
    try {
      const verify = await cliVerifyAuth(spec.service_type);
      setState({ kind: verify.authenticated ? 'authenticated' : 'unauthenticated', verify });
    } catch (err) {
      setState({ kind: 'error', raw: err });
    }
  }, [spec.service_type]);

  useEffect(() => {
    void runInstallCheck();
  }, [runInstallCheck]);

  // Default credential name for CLI flow: once per connector. Re-applying it
  // whenever the field is empty made the field impossible to clear.
  const defaultedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (defaultedForRef.current === connector.label) return;
    defaultedForRef.current = connector.label;
    if (!credentialName || credentialName === connector.label) {
      onCredentialNameChange(`${connector.label} CLI`);
    }
  }, [connector.label, credentialName, onCredentialNameChange]);

  const handleSave = async () => {
    setSaving(true);
    try {
      // `cli_capture_save` runs the capture spec and persists the credential
      // with metadata.source = "cli" so healthcheck + rotation recognize it
      // as CLI-owned. Parent is notified via onSaved to refresh its list.
      await cliCaptureSave(spec.service_type, credentialName.trim() || `${connector.label} CLI`);
      await onSaved();
    } catch (err) {
      toastCatch('CliConnectionPanel:save', l.save_failed)(err);
    } finally {
      setSaving(false);
    }
  };

  const copyInstallHint = () => {
    // Strip markdown bold/headers for a cleaner clipboard copy.
    const plain = spec.install_hint.replace(/\*\*/g, '').trim();
    void copyText(plain);
  };

  return (
    <div className="space-y-4">
      {/* Credential name input */}
      <div>
        <label htmlFor={nameId} className="block typo-caption text-foreground mb-1">
          {l.credential_name}
        </label>
        <input
          id={nameId}
          type="text"
          value={credentialName}
          onChange={(e) => onCredentialNameChange(e.target.value)}
          className="w-full px-3 py-2 bg-surface-2 border border-hair rounded-card typo-body focus:outline-none focus:border-primary/40"
          placeholder={`${connector.label} CLI`}
        />
      </div>

      {/* Header: binary + docs link */}
      <div className="flex items-center gap-2 px-3 py-2 bg-status-warning/5 border border-status-warning/15 rounded-card">
        <Terminal className="w-4 h-4 text-status-warning shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="typo-body text-foreground">{spec.display_label}</div>
          <div className="typo-caption text-foreground">{l.binary_label}: <code className="font-mono">{spec.binary}</code></div>
        </div>
        <a
          href={spec.docs_url}
          target="_blank"
          rel="noreferrer"
          className="typo-caption text-status-warning hover:text-status-warning inline-flex items-center gap-1"
        >
          {l.docs_link} <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {/* State-specific body */}
      {state.kind === 'checking' && (
        <StateBlock icon={<Loader2 className="w-4 h-4 animate-spin text-foreground" />}
          title={l.checking_install} />
      )}

      {state.kind === 'error' && (
        <StateBlock
          icon={<AlertCircle className="w-4 h-4 text-status-error" />}
          title={l.error}
          description={resolveErrorTranslated(t, extractMessage(state.raw)).message}
          action={<Button type="button" onClick={runInstallCheck} variant="secondary" size="xs">{l.retry}</Button>}
        />
      )}

      {state.kind === 'not_installed' && (
        <div className="space-y-2 p-3 bg-surface-1 border border-hair rounded-card">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-status-warning shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="typo-body text-foreground">{l.not_installed_title}</div>
              <div className="typo-caption text-foreground">{tx(l.not_installed_desc, { label: spec.display_label })}</div>
            </div>
          </div>
          <pre className="typo-caption font-mono whitespace-pre-wrap bg-background/50 p-2 rounded-interactive border border-hair text-foreground">
            {spec.install_hint.replace(/\*\*/g, '')}
          </pre>
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={copyInstallHint}
              variant="secondary"
              size="xs"
              icon={<Copy className="w-3 h-3" />}
            >
               {l.copy}
            </Button>
            <Button
              type="button"
              onClick={runInstallCheck}
              variant="secondary"
              size="xs"
              icon={<RefreshCw className="w-3 h-3" />}
            >
               {l.recheck}
            </Button>
          </div>
        </div>
      )}

      {state.kind === 'installed_unverified' && (
        <div className="space-y-2 p-3 bg-surface-1 border border-hair rounded-card">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-status-success shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="typo-body text-foreground">{l.installed_title}</div>
              <div className="typo-caption text-foreground">
                {state.status.version ?? state.status.binary_path}
              </div>
            </div>
          </div>
          <div className="typo-caption text-foreground">
            {spec.auth_instruction}
          </div>
          <Button
            type="button"
            onClick={runVerify}
            variant="accent"
            tone="warning"
            size="sm"
            icon={<CheckCircle2 className="w-3 h-3" />}
          >
             {l.verify_auth}
          </Button>
        </div>
      )}

      {state.kind === 'verifying' && (
        <StateBlock icon={<Loader2 className="w-4 h-4 animate-spin text-foreground" />}
          title={l.verifying_auth} />
      )}

      {state.kind === 'unauthenticated' && (
        <div className="space-y-2 p-3 bg-status-error/5 border border-status-error/20 rounded-card">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-status-error shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="typo-body text-foreground">{l.not_authenticated_title}</div>
              <div className="typo-caption text-foreground">{state.verify.message}</div>
            </div>
          </div>
          <Button
            type="button"
            onClick={runVerify}
            variant="secondary"
            size="sm"
            icon={<RefreshCw className="w-3 h-3" />}
          >
             {l.recheck}
          </Button>
        </div>
      )}

      {state.kind === 'authenticated' && (
        <div className="space-y-2 p-3 bg-surface-1 border border-hair rounded-card">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-status-success shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="typo-body text-foreground">{l.authenticated_title}</div>
              <div className="typo-caption text-foreground break-all">{state.verify.message}</div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={runVerify}
              variant="secondary"
              size="sm"
              icon={<RefreshCw className="w-3 h-3" />}
            >
               {l.test_connection}
            </Button>
          </div>
        </div>
      )}

      {/* Footer buttons */}
      <div className="flex justify-end gap-2 pt-2 border-t border-hair">
        <Button
          type="button"
          onClick={onCancel}
          variant="secondary"
          size="sm"
        >
          {l.cancel}
        </Button>
        <Button
          type="button"
          onClick={handleSave}
          disabled={state.kind !== 'authenticated' || saving || !credentialName.trim()}
          variant="accent"
          tone="success"
          size="sm"
          icon={saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
        >
          {l.save_connection}
        </Button>
      </div>
    </div>
  );
}

function StateBlock({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2 p-3 bg-surface-1 border border-hair rounded-card">
      <div className="shrink-0 mt-0.5">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="typo-body text-foreground">{title}</div>
        {description && <div className="typo-caption text-foreground break-words">{description}</div>}
      </div>
      {action}
    </div>
  );
}
