import { Link, CheckCircle2, XCircle, AlertCircle, Activity, Plus, ChevronDown, Wrench } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { PersonaCredential } from '@/lib/types/types';
import { translateHealthcheckMessage } from '@/features/vault/sub_catalog/components/design/CredentialDesignHelpers';
import { rankCredentialsForConnector } from './connectorMatching';
import {
  getStatusKey,
  STATUS_CONFIG,
  type ConnectorStatus,
} from './useConnectorStatuses';
import { CredentialPicker } from './CredentialPicker';

// ============================================================================
// Types
// ============================================================================

export interface ConnectorRowProps {
  status: ConnectorStatus;
  tools: { name: string; description?: string | null }[];
  credentials: PersonaCredential[];
  isLinking: boolean;
  onToggleLink: () => void;
  onTest: () => void;
  onAddCredential: () => void;
  onLinkCredential: (credentialId: string, credentialName: string) => void;
}

// ============================================================================
// Component
// ============================================================================

export function ConnectorRow({
  status,
  tools,
  credentials,
  isLinking,
  onToggleLink,
  onTest,
  onAddCredential,
  onLinkCredential,
}: ConnectorRowProps) {
  const { t, tx } = useTranslation();
  const statusKey = getStatusKey(status);
  const config = STATUS_CONFIG[statusKey];
  const translated = status.result && !status.result.success
    ? translateHealthcheckMessage(status.result.message)
    : null;

  const { matching: matchingCreds, others: otherCreds } = rankCredentialsForConnector(credentials, status.name);

  return (
    <div className="bg-secondary/20 border border-primary/10 rounded-modal p-3.5">
      {/* Connector header row */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-card bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center flex-shrink-0">
          <Link className="w-3.5 h-3.5 text-emerald-400/60" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-foreground truncate">{status.name}</p>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-sm font-medium rounded-full border ${config.bg} ${config.color}`}>
              {statusKey === 'testing' && <LoadingSpinner size="xs" className="!w-2.5 !h-2.5" />}
              {statusKey === 'ready' && <CheckCircle2 className="w-2.5 h-2.5" />}
              {statusKey === 'failed' && <XCircle className="w-2.5 h-2.5" />}
              {statusKey === 'missing' && <AlertCircle className="w-2.5 h-2.5" />}
              {config.label}
            </span>
          </div>
          <p className="text-sm text-foreground mt-0.5">
            {status.credentialName
              ? tx(t.templates.n8n.credential_label, { name: status.credentialName })
              : tx(t.templates.n8n.n8n_type_label, { type: status.n8nType })}
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {status.credentialId ? (
            <button
              onClick={onTest}
              disabled={status.testing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-modal border border-primary/15 text-foreground hover:bg-secondary/50 hover:text-foreground/95 transition-colors disabled:opacity-40"
            >
              {status.testing ? <LoadingSpinner size="xs" /> : <Activity className="w-3 h-3" />}
              {t.templates.n8n.test}
            </button>
          ) : (
            <>
              {credentials.length > 0 && (
                <button
                  onClick={onToggleLink}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-modal border transition-colors ${
                    isLinking
                      ? 'border-violet-500/30 text-violet-300 bg-violet-500/15'
                      : 'border-primary/15 text-foreground hover:bg-secondary/50 hover:text-foreground/95'
                  }`}
                >
                  <ChevronDown className={`w-3 h-3 transition-transform ${isLinking ? 'rotate-180' : ''}`} />
                  {t.templates.n8n.link_existing}
                </button>
              )}
              <button
                onClick={onAddCredential}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-modal border border-violet-500/25 text-violet-300 bg-violet-500/10 hover:bg-violet-500/20 transition-colors"
              >
                <Plus className="w-3 h-3" />
                {t.templates.n8n.add_new}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Tools belonging to this connector */}
      {tools.length > 0 && (
        <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
          <Wrench className="w-3 h-3 text-foreground flex-shrink-0" />
          {tools.map((tool) => (
            <span
              key={tool.name}
              className="px-2 py-0.5 text-sm font-mono rounded-card bg-blue-500/10 text-blue-400 border border-blue-500/20"
              title={tool.description ?? undefined}
            >
              {tool.name}
            </span>
          ))}
        </div>
      )}

      {/* Credential picker */}
      <CredentialPicker
        isOpen={isLinking}
        matchingCreds={matchingCreds}
        otherCreds={otherCreds}
        totalCredentials={credentials.length}
        onLinkCredential={onLinkCredential}
      />

      {/* Test result detail */}
      {status.result && !status.testing && (
        <div className={`mt-2.5 px-3 py-2 rounded-modal text-sm ${
          status.result.success
            ? 'bg-emerald-500/5 border border-emerald-500/15 text-emerald-400'
            : 'bg-red-500/5 border border-red-500/15 text-red-400'
        }`}>
          {status.result.success ? (
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3 h-3 flex-shrink-0" />
              <span>{status.result.message}</span>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <XCircle className="w-3 h-3 flex-shrink-0" />
                <span>{translated?.friendly ?? status.result.message}</span>
              </div>
              {translated?.suggestion && (
                <p className="text-sm text-red-400/60 pl-4.5">{translated.suggestion}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
