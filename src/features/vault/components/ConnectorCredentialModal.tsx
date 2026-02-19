import { useEffect, useRef } from 'react';
import { X, Plug, ExternalLink, Check } from 'lucide-react';
import { CredentialEditForm } from '@/features/vault/components/CredentialEditForm';
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
  const overlayRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Click outside to close
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

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

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center"
    >
      <div className="bg-secondary/95 backdrop-blur-xl border border-primary/15 rounded-2xl shadow-2xl max-w-lg w-full mx-4 p-6 max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            {connectorDefinition?.icon_url ? (
              <img src={connectorDefinition.icon_url} alt={label} className="w-7 h-7" />
            ) : (
              <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                <Plug className="w-4 h-4 text-primary/60" />
              </div>
            )}
            <div>
              <h3 className="text-sm font-semibold text-foreground">{label}</h3>
              {category && (
                <span className="text-[10px] text-muted-foreground/40 px-1.5 py-0.5 bg-muted/30 rounded mt-0.5 inline-block">
                  {category}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-primary/10 transition-colors text-muted-foreground/50 hover:text-foreground/70"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Existing credential badge */}
        {existingCredential && (
          <div className="flex items-center gap-2 px-3 py-2 mb-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-400">
            <Check className="w-3.5 h-3.5" />
            Credential already configured -- update below to replace
          </div>
        )}

        {/* Setup URL */}
        {connector.setup_url && (
          <a
            href={connector.setup_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 px-3.5 py-2.5 mb-4 bg-primary/5 border border-primary/15 rounded-xl text-sm text-primary/80 hover:bg-primary/10 hover:text-primary transition-colors group"
          >
            <ExternalLink className="w-4 h-4 flex-shrink-0 group-hover:scale-105 transition-transform" />
            <div className="flex-1 min-w-0">
              <span className="font-medium">How to get credentials</span>
              <span className="text-xs text-muted-foreground/40 block truncate mt-0.5">
                {connector.setup_url}
              </span>
            </div>
          </a>
        )}

        {/* Setup instructions */}
        {connector.setup_instructions && (
          <div className="mb-4 px-3.5 py-2.5 bg-secondary/60 border border-primary/10 rounded-xl">
            <p className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wider mb-1.5">
              Setup Instructions
            </p>
            <p className="text-xs text-foreground/60 whitespace-pre-line leading-relaxed">
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
          />
        ) : (
          <div className="text-center py-6">
            <p className="text-sm text-muted-foreground/50">
              No credential fields defined for this connector.
            </p>
            <button
              onClick={onClose}
              className="mt-3 px-4 py-2 bg-secondary/60 hover:bg-secondary text-foreground/70 rounded-xl text-sm transition-colors"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
