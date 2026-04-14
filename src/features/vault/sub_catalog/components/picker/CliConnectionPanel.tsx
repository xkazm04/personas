import { useCallback, useEffect, useState } from 'react';
import { Terminal, CheckCircle2, AlertCircle, Loader2, Copy, ExternalLink, RefreshCw } from 'lucide-react';
import {
  cliCheckInstalled,
  cliVerifyAuth,
  cliCaptureRun,
  type CliInstallStatus,
  type CliVerifyResult,
  type CliSpecInfo,
} from '@/api/auth/cliCapture';
import { toastCatch } from '@/lib/silentCatch';
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
  onCreateCredential: (values: Record<string, string>) => void;
  onCancel: () => void;
}

export function CliConnectionPanel({
  connector,
  spec,
  credentialName,
  onCredentialNameChange,
  onCreateCredential,
  onCancel,
}: CliConnectionPanelProps) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await cliCaptureRun(spec.service_type);
      // Hand the captured fields back to the parent's create handler so
      // persistence goes through the normal credential creation path.
      onCreateCredential(result.fields);
    } catch (err) {
      toastCatch('CliConnectionPanel:save', 'Failed to capture credential from CLI')(err);
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
        <label className="block text-xs font-medium text-muted-foreground mb-1">
          Credential Name
        </label>
        <input
          type="text"
          value={credentialName}
          onChange={(e) => onCredentialNameChange(e.target.value)}
          className="w-full px-3 py-2 bg-secondary/40 border border-primary/15 rounded-lg text-sm focus:outline-none focus:border-primary/40"
          placeholder={`${connector.label} CLI`}
        />
      </div>

      {/* Header: binary + docs link */}
      <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/5 border border-amber-500/15 rounded-lg">
        <Terminal className="w-4 h-4 text-amber-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground">{spec.display_label}</div>
          <div className="text-xs text-muted-foreground">Binary: <code className="font-mono">{spec.binary}</code></div>
        </div>
        <a
          href={spec.docs_url}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-amber-400 hover:text-amber-300 inline-flex items-center gap-1"
        >
          Docs <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {/* State-specific body */}
      {state.kind === 'checking' && (
        <StateBlock icon={<Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          title="Checking installation..." />
      )}

      {state.kind === 'error' && (
        <StateBlock
          icon={<AlertCircle className="w-4 h-4 text-red-400" />}
          title="Error"
          description={state.message}
          action={<button onClick={runInstallCheck} className="text-xs px-2 py-1 rounded border border-primary/15 hover:bg-secondary/40">Retry</button>}
        />
      )}

      {state.kind === 'not_installed' && (
        <div className="space-y-2 p-3 bg-secondary/25 border border-primary/15 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-sm font-medium text-foreground">Not installed</div>
              <div className="text-xs text-muted-foreground">{spec.display_label} is not detected on this machine.</div>
            </div>
          </div>
          <pre className="text-[11px] font-mono whitespace-pre-wrap bg-background/50 p-2 rounded border border-primary/10 text-foreground/80">
            {spec.install_hint.replace(/\*\*/g, '')}
          </pre>
          <div className="flex gap-2">
            <button
              onClick={copyInstallHint}
              className="text-xs px-2 py-1 rounded border border-primary/15 hover:bg-secondary/40 inline-flex items-center gap-1"
            >
              <Copy className="w-3 h-3" /> Copy
            </button>
            <button
              onClick={runInstallCheck}
              className="text-xs px-2 py-1 rounded border border-primary/15 hover:bg-secondary/40 inline-flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" /> Re-check
            </button>
          </div>
        </div>
      )}

      {state.kind === 'installed_unverified' && (
        <div className="space-y-2 p-3 bg-secondary/25 border border-primary/15 rounded-lg">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-sm font-medium text-foreground">Installed</div>
              <div className="text-xs text-muted-foreground">
                {state.status.version ?? state.status.binary_path}
              </div>
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            {spec.auth_instruction}
          </div>
          <button
            onClick={runVerify}
            className="text-xs px-3 py-1.5 rounded bg-amber-500/20 border border-amber-500/30 text-amber-200 hover:bg-amber-500/30 inline-flex items-center gap-1"
          >
            <CheckCircle2 className="w-3 h-3" /> Verify Auth
          </button>
        </div>
      )}

      {state.kind === 'verifying' && (
        <StateBlock icon={<Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          title="Verifying authentication..." />
      )}

      {state.kind === 'unauthenticated' && (
        <div className="space-y-2 p-3 bg-red-500/5 border border-red-500/20 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-sm font-medium text-foreground">Not authenticated</div>
              <div className="text-xs text-muted-foreground">{state.verify.message}</div>
            </div>
          </div>
          <button
            onClick={runVerify}
            className="text-xs px-3 py-1.5 rounded border border-primary/15 hover:bg-secondary/40 inline-flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" /> Re-check
          </button>
        </div>
      )}

      {state.kind === 'authenticated' && (
        <div className="space-y-2 p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-lg">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-sm font-medium text-foreground">Authenticated</div>
              <div className="text-xs text-muted-foreground break-all">{state.verify.message}</div>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={runVerify}
              className="text-xs px-3 py-1.5 rounded border border-primary/15 hover:bg-secondary/40 inline-flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" /> Test Connection
            </button>
          </div>
        </div>
      )}

      {/* Footer buttons */}
      <div className="flex justify-end gap-2 pt-2 border-t border-primary/10">
        <button
          onClick={onCancel}
          className="text-sm px-3 py-1.5 rounded border border-primary/15 hover:bg-secondary/40"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={state.kind !== 'authenticated' || saving || !credentialName.trim()}
          className="text-sm px-3 py-1.5 rounded bg-emerald-500/20 border border-emerald-500/30 text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
          Save Connection
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
    <div className="flex items-start gap-2 p-3 bg-secondary/25 border border-primary/15 rounded-lg">
      <div className="shrink-0 mt-0.5">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground">{title}</div>
        {description && <div className="text-xs text-muted-foreground break-words">{description}</div>}
      </div>
      {action}
    </div>
  );
}
