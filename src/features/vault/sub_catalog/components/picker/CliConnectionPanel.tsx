import { useCallback, useEffect, useState } from 'react';
import { Terminal, CheckCircle2, AlertCircle, Loader2, Copy, ExternalLink, RefreshCw } from 'lucide-react';
import {
  cliCheckInstalled,
  cliVerifyAuth,
  cliCaptureSave,
  type CliInstallStatus,
  type CliVerifyResult,
  type CliSpecInfo,
} from '@/api/auth/cliCapture';
import { toastCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';
import type { ConnectorDefinition } from '@/lib/types/types';

type PanelState =
  | { kind: 'checking' }
  | { kind: 'not_installed'; status: CliInstallStatus }
  | { kind: 'installed_unverified'; status: CliInstallStatus }
  | { kind: 'verifying' }
  | { kind: 'unauthenticated'; verify: CliVerifyResult }
  | { kind: 'authenticated'; verify: CliVerifyResult }
  | { kind: 'error'; message: string };

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
      setState({ kind: 'error', message: String(err) });
    }
  }, [spec.service_type]);

  const runVerify = useCallback(async () => {
    setState({ kind: 'verifying' });
    try {
      const verify = await cliVerifyAuth(spec.service_type);
      setState({ kind: verify.authenticated ? 'authenticated' : 'unauthenticated', verify });
    } catch (err) {
      setState({ kind: 'error', message: String(err) });
    }
  }, [spec.service_type]);

  useEffect(() => {
    void runInstallCheck();
  }, [runInstallCheck]);

  // Default credential name for CLI flow
  useEffect(() => {
    if (!credentialName || credentialName === connector.label) {
      onCredentialNameChange(`${connector.label} CLI`);
    }
  }, []);

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
    void navigator.clipboard.writeText(plain);
  };

  return (
    <div className="space-y-4">
      {/* Credential name input */}
      <div>
        <label className="block typo-caption font-medium text-foreground mb-1">
          {l.credential_name}
        </label>
        <input
          type="text"
          value={credentialName}
          onChange={(e) => onCredentialNameChange(e.target.value)}
          className="w-full px-3 py-2 bg-secondary/40 border border-primary/15 rounded-card typo-body focus:outline-none focus:border-primary/40"
          placeholder={`${connector.label} CLI`}
        />
      </div>

      {/* Header: binary + docs link */}
      <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/5 border border-amber-500/15 rounded-card">
        <Terminal className="w-4 h-4 text-amber-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="typo-body font-medium text-foreground">{spec.display_label}</div>
          <div className="typo-caption text-foreground">{l.binary_label}: <code className="font-mono">{spec.binary}</code></div>
        </div>
        <a
          href={spec.docs_url}
          target="_blank"
          rel="noreferrer"
          className="typo-caption text-amber-400 hover:text-amber-300 inline-flex items-center gap-1"
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
          icon={<AlertCircle className="w-4 h-4 text-red-400" />}
          title={l.error}
          description={state.message}
          action={<button onClick={runInstallCheck} className="typo-caption px-2 py-1 rounded border border-primary/15 hover:bg-secondary/40">{l.retry}</button>}
        />
      )}

      {state.kind === 'not_installed' && (
        <div className="space-y-2 p-3 bg-secondary/25 border border-primary/15 rounded-card">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="typo-body font-medium text-foreground">{l.not_installed_title}</div>
              <div className="typo-caption text-foreground">{tx(l.not_installed_desc, { label: spec.display_label })}</div>
            </div>
          </div>
          <pre className="text-[11px] font-mono whitespace-pre-wrap bg-background/50 p-2 rounded border border-primary/10 text-foreground">
            {spec.install_hint.replace(/\*\*/g, '')}
          </pre>
          <div className="flex gap-2">
            <button
              onClick={copyInstallHint}
              className="typo-caption px-2 py-1 rounded border border-primary/15 hover:bg-secondary/40 inline-flex items-center gap-1"
            >
              <Copy className="w-3 h-3" /> {l.copy}
            </button>
            <button
              onClick={runInstallCheck}
              className="typo-caption px-2 py-1 rounded border border-primary/15 hover:bg-secondary/40 inline-flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" /> {l.recheck}
            </button>
          </div>
        </div>
      )}

      {state.kind === 'installed_unverified' && (
        <div className="space-y-2 p-3 bg-secondary/25 border border-primary/15 rounded-card">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="typo-body font-medium text-foreground">{l.installed_title}</div>
              <div className="typo-caption text-foreground">
                {state.status.version ?? state.status.binary_path}
              </div>
            </div>
          </div>
          <div className="typo-caption text-foreground">
            {spec.auth_instruction}
          </div>
          <button
            onClick={runVerify}
            className="typo-caption px-3 py-1.5 rounded bg-amber-500/20 border border-amber-500/30 text-amber-200 hover:bg-amber-500/30 inline-flex items-center gap-1"
          >
            <CheckCircle2 className="w-3 h-3" /> {l.verify_auth}
          </button>
        </div>
      )}

      {state.kind === 'verifying' && (
        <StateBlock icon={<Loader2 className="w-4 h-4 animate-spin text-foreground" />}
          title={l.verifying_auth} />
      )}

      {state.kind === 'unauthenticated' && (
        <div className="space-y-2 p-3 bg-red-500/5 border border-red-500/20 rounded-card">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="typo-body font-medium text-foreground">{l.not_authenticated_title}</div>
              <div className="typo-caption text-foreground">{state.verify.message}</div>
            </div>
          </div>
          <button
            onClick={runVerify}
            className="typo-caption px-3 py-1.5 rounded border border-primary/15 hover:bg-secondary/40 inline-flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" /> {l.recheck}
          </button>
        </div>
      )}

      {state.kind === 'authenticated' && (
        <div className="space-y-2 p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-card">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="typo-body font-medium text-foreground">{l.authenticated_title}</div>
              <div className="typo-caption text-foreground break-all">{state.verify.message}</div>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={runVerify}
              className="typo-caption px-3 py-1.5 rounded border border-primary/15 hover:bg-secondary/40 inline-flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" /> {l.test_connection}
            </button>
          </div>
        </div>
      )}

      {/* Footer buttons */}
      <div className="flex justify-end gap-2 pt-2 border-t border-primary/10">
        <button
          onClick={onCancel}
          className="typo-body px-3 py-1.5 rounded border border-primary/15 hover:bg-secondary/40"
        >
          {l.cancel}
        </button>
        <button
          onClick={handleSave}
          disabled={state.kind !== 'authenticated' || saving || !credentialName.trim()}
          className="typo-body px-3 py-1.5 rounded bg-emerald-500/20 border border-emerald-500/30 text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
          {l.save_connection}
        </button>
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
    <div className="flex items-start gap-2 p-3 bg-secondary/25 border border-primary/15 rounded-card">
      <div className="shrink-0 mt-0.5">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="typo-body font-medium text-foreground">{title}</div>
        {description && <div className="typo-caption text-foreground break-words">{description}</div>}
      </div>
      {action}
    </div>
  );
}
