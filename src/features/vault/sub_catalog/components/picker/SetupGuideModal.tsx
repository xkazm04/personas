import { useEffect, useState } from 'react';
import { X, ExternalLink, Plug, Terminal, Loader2 } from 'lucide-react';
import { ThemedConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import { openExternalUrl } from "@/api/system/system";

import { BaseModal } from '@/lib/ui/BaseModal';
import type { ConnectorDefinition } from '@/lib/types/types';
import { useTranslation } from '@/i18n/useTranslation';
import {
  cliCaptureRun,
  listCliCapturableServices,
  type CliCaptureResult,
} from '@/api/auth/cliCapture';

interface SetupGuideModalProps {
  connector: ConnectorDefinition | null;
  onClose: () => void;
  onCliCaptured?: (connector: ConnectorDefinition, result: CliCaptureResult) => void;
}

export function SetupGuideModal({ connector, onClose, onCliCaptured }: SetupGuideModalProps) {
  const { t } = useTranslation();
  const [cliAvailable, setCliAvailable] = useState<boolean>(false);
  const [cliBusy, setCliBusy] = useState<boolean>(false);
  const [cliError, setCliError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!connector) {
      setCliAvailable(false);
      return;
    }
    setCliError(null);
    listCliCapturableServices()
      .then((services) => {
        if (!cancelled) setCliAvailable(services.includes(connector.name));
      })
      .catch(() => {
        if (!cancelled) setCliAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connector]);

  if (!connector) return null;

  const runCliCapture = async () => {
    if (!connector || cliBusy) return;
    setCliBusy(true);
    setCliError(null);
    try {
      const result = await cliCaptureRun(connector.name);
      onCliCaptured?.(connector, result);
      onClose();
    } catch (err) {
      setCliError(err instanceof Error ? err.message : String(err));
    } finally {
      setCliBusy(false);
    }
  };

  const metadata = (connector.metadata ?? {}) as Record<string, unknown>;
  const guide = typeof metadata.setup_guide === 'string' ? metadata.setup_guide : null;
  const docsUrl = typeof metadata.docs_url === 'string' ? metadata.docs_url : null;
  const authLabel = typeof metadata.auth_type_label === 'string' ? metadata.auth_type_label : 'Credential';
  const summary = typeof metadata.summary === 'string' ? metadata.summary : null;

  const handleOpenDocs = async () => {
    if (!docsUrl) return;
    try {
      await openExternalUrl(docsUrl);
    } catch {
      // intentional: non-critical -- Tauri shell open failed, fall back to window.open
      window.open(docsUrl, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <BaseModal isOpen={!!connector} onClose={onClose} titleId="setup-guide-title" size="md" panelClassName="bg-background border border-primary/15 rounded-2xl shadow-elevation-4 overflow-hidden">
      <div data-testid="setup-guide-modal" data-connector-name={connector.name} data-cli-available={cliAvailable ? 'true' : 'false'}>
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-primary/10 bg-secondary/20">
        <div
          className="w-10 h-10 rounded-modal flex items-center justify-center border"
          style={{
            backgroundColor: `${connector.color}15`,
            borderColor: `${connector.color}30`,
          }}
        >
          {connector.icon_url ? (
            <ThemedConnectorIcon url={connector.icon_url} label={connector.label} color={connector.color} size="w-5 h-5" />
          ) : (
            <Plug className="w-5 h-5" style={{ color: connector.color }} />
          )}
        </div>
        <div className="flex-1">
          <h3 id="setup-guide-title" className="font-semibold text-foreground">How to get {connector.label} {authLabel}</h3>
          {summary && (
            <p className="text-sm text-muted-foreground/70 mt-0.5">{summary}</p>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-card hover:bg-secondary/50 transition-colors"
        >
          <X className="w-4 h-4 text-muted-foreground/60" />
        </button>
      </div>

      {/* Body */}
      <div className="px-6 py-6 space-y-4">
        {guide ? (
          <div className="space-y-2.5">
            {guide.split('\n').filter(Boolean).map((line, i) => {
              const stripped = line.replace(/^\d+\.\s*/, '');
              const stepNum = i + 1;
              return (
                <div key={i} className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-sm font-bold text-primary/80">
                    {stepNum}
                  </span>
                  <p className="text-sm text-foreground/85 pt-0.5 leading-relaxed">{stripped}</p>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground/70">
            No setup guide available for this connector. Visit the documentation link below for instructions.
          </p>
        )}

        {/* Required fields hint */}
        {connector.fields.length > 0 && (
          <div className="pt-2 border-t border-primary/8">
            <p className="text-sm text-muted-foreground/50 mb-2">{t.vault.picker_section.required_fields}</p>
            <div className="flex flex-wrap gap-1.5">
              {connector.fields.filter((f) => f.required).map((f) => (
                <span key={f.key} className="text-sm px-2 py-0.5 rounded-card bg-secondary/40 border border-primary/10 text-foreground/70 font-mono">
                  {f.label}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      {(docsUrl || cliAvailable) && (
        <div className="px-6 py-3 border-t border-primary/10 bg-secondary/10 flex flex-wrap items-center gap-2">
          {cliAvailable && (
            <div className="flex flex-col gap-1" data-testid="cli-capture-panel">
              <button
                data-testid="cli-capture-cta"
                data-cli-busy={cliBusy ? 'true' : 'false'}
                onClick={runCliCapture}
                disabled={cliBusy}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-modal bg-primary/20 hover:bg-primary/30 border border-primary/30 text-primary text-sm font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {cliBusy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" data-testid="cli-capture-busy" />
                ) : (
                  <Terminal className="w-3.5 h-3.5" />
                )}
                {cliBusy ? t.vault.cli_capture.running : t.vault.cli_capture.cta}
              </button>
              {cliError && (
                <p data-testid="cli-capture-error" className="text-xs text-destructive/90 max-w-xs">{cliError}</p>
              )}
              {!cliError && !cliBusy && (
                <p data-testid="cli-capture-hint" className="text-xs text-muted-foreground/60 max-w-xs">
                  {t.vault.cli_capture.hint}
                </p>
              )}
            </div>
          )}
          {docsUrl && (
            <button
              onClick={handleOpenDocs}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-modal bg-primary/10 hover:bg-primary/20 border border-primary/20 text-primary text-sm font-medium transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open {connector.label} setup page
            </button>
          )}
        </div>
      )}
      </div>
    </BaseModal>
  );
}
