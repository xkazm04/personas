import { useEffect, useRef, useCallback } from 'react';
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
  const dialogRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Auto-focus first input on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      const firstInput = dialogRef.current?.querySelector<HTMLElement>('input, textarea, select');
      firstInput?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  // Focus trap: keep Tab within the modal
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !dialogRef.current) return;

    const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;

    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, []);

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
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="connector-credential-title"
        onKeyDown={handleKeyDown}
        className="bg-secondary/95 backdrop-blur-xl border border-primary/15 rounded-2xl shadow-2xl max-w-lg w-full mx-4 p-6 max-h-[85vh] overflow-y-auto"
      >
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

        {/* Setup URL — prominent for first-time, subtle for updates */}
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
      </div>
    </div>
  );
}
