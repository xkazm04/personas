import { useCallback } from 'react';
import { X, Plug, ExternalLink, Check } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { ThemedConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import { CredentialEditForm } from '@/features/vault/sub_forms/CredentialEditForm';
import { useCredentialHealth } from '@/features/vault/hooks/health/useCredentialHealth';
import type { SuggestedConnector } from '@/lib/types/designTypes';
import type { ConnectorDefinition, CredentialMetadata, CredentialTemplateField } from '@/lib/types/types';

interface ConnectorCredentialModalProps {
  connector: SuggestedConnector;
  connectorDefinition?: ConnectorDefinition;
  existingCredential?: CredentialMetadata;
  onSave: (values: Record<string, string>) => void;
  onClose: () => void;
}

export function ConnectorCredentialModal({
  connector,
  connectorDefinition,
  existingCredential,
  onSave,
  onClose,
}: ConnectorCredentialModalProps) {
  const health = useCredentialHealth(`connector:${connector.name}`);

  // Merge field definitions: DB connector fields take priority, then CLI-generated ones
  const fields: CredentialTemplateField[] = connectorDefinition?.fields?.length
    ? connectorDefinition.fields
    : (connector.credential_fields ?? []).map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type as CredentialTemplateField['type'],
        placeholder: f.placeholder,
        helpText: f.helpText,
        required: f.required,
      }));

  const label = connectorDefinition?.label || connector.name;
  const category = connectorDefinition?.category;

  // Connectors without a healthcheck endpoint should not block save.
  const hasHealthcheck = connectorDefinition ? connectorDefinition.healthcheck_config != null : true;

  const handleHealthcheck = useCallback(async (values: Record<string, string>) => {
    await health.checkDesign(
      `Test connection for ${label} connector`,
      { name: connector.name, label, fields },
      values,
    );
  }, [connector.name, label, fields, health.checkDesign]);

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      titleId="connector-credential-title"
      maxWidthClass="max-w-2xl"
      panelClassName="bg-secondary/95 backdrop-blur-xl border border-primary/15 rounded-2xl shadow-2xl p-6 max-h-[85vh] overflow-y-auto"
    >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            {connectorDefinition?.icon_url ? (
              <ThemedConnectorIcon url={connectorDefinition.icon_url} label={label} color={connectorDefinition.color} size="w-7 h-7" />
            ) : (
              <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                <Plug className="w-4 h-4 text-primary/60" />
              </div>
            )}
            <div>
              <h3 id="connector-credential-title" className="text-sm font-semibold text-foreground">{label}</h3>
              {category && (
                <span className="text-sm text-muted-foreground/80 px-1.5 py-0.5 bg-muted/30 rounded mt-0.5 inline-block">
                  {category}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-primary/10 transition-colors text-muted-foreground/90 hover:text-foreground/95"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Existing credential badge */}
        {existingCredential && (
          <div className="flex items-center gap-2 px-3 py-2 mb-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-sm text-emerald-400">
            <Check className="w-3.5 h-3.5" />
            Credential already configured -- update below to replace
          </div>
        )}

        {/* Setup URL -- prominent for first-time, subtle for updates */}
        {connector.setup_url && !existingCredential && (
          <a
            href={connector.setup_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 px-4 py-3 mb-4 bg-amber-500/10 border-2 border-amber-500/30 rounded-xl text-sm text-foreground/80 hover:bg-amber-500/15 hover:border-amber-500/40 transition-colors group"
          >
            <span className="w-6 h-6 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-sm font-bold text-amber-400 flex-shrink-0">
              1
            </span>
            <div className="flex-1 min-w-0">
              <span className="font-semibold text-foreground/90">Get your credentials</span>
              <span className="text-sm text-muted-foreground/90 block truncate mt-0.5">
                Open {label} to generate an API key or token
              </span>
            </div>
            <ExternalLink className="w-4 h-4 text-amber-400/70 flex-shrink-0 group-hover:scale-110 transition-transform" />
          </a>
        )}
        {connector.setup_url && existingCredential && (
          <a
            href={connector.setup_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 px-3.5 py-2.5 mb-4 bg-primary/5 border border-primary/15 rounded-xl text-sm text-primary/80 hover:bg-primary/10 hover:text-primary transition-colors group"
          >
            <ExternalLink className="w-4 h-4 flex-shrink-0 group-hover:scale-105 transition-transform" />
            <div className="flex-1 min-w-0">
              <span className="font-medium">How to get credentials</span>
              <span className="text-sm text-muted-foreground/80 block truncate mt-0.5">
                {connector.setup_url}
              </span>
            </div>
          </a>
        )}

        {/* Setup instructions */}
        {connector.setup_instructions && (
          <div className="mb-4 px-3.5 py-2.5 bg-secondary/60 border border-primary/10 rounded-xl">
            <p className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider mb-1.5">
              Setup Instructions
            </p>
            <p className="text-sm text-foreground/80 whitespace-pre-line leading-relaxed">
              {connector.setup_instructions}
            </p>
          </div>
        )}

        {/* Credential form */}
        {fields.length > 0 ? (
          <CredentialEditForm
            fields={fields}
            onSave={onSave}
            onCancel={onClose}
            onHealthcheck={handleHealthcheck}
            isHealthchecking={health.isHealthchecking}
            healthcheckResult={health.result}
            onValuesChanged={() => health.invalidate()}
            saveDisabled={hasHealthcheck ? !health.result?.success : false}
            saveDisabledReason={hasHealthcheck ? "Run a successful connection test before saving." : undefined}
          />
        ) : (
          <div className="text-center py-6">
            <p className="text-sm text-muted-foreground/90">
              No credential fields defined for this connector.
            </p>
            <button
              onClick={onClose}
              className="mt-3 px-4 py-2 bg-secondary/60 hover:bg-secondary text-foreground/90 rounded-xl text-sm transition-colors"
            >
              Close
            </button>
          </div>
        )}
    </BaseModal>
  );
}
