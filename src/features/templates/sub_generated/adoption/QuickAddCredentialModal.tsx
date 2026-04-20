import { useState, useMemo } from 'react';
import { X, ArrowLeft, Loader2, CheckCircle2, XCircle, ExternalLink } from 'lucide-react';
import { useVaultStore } from '@/stores/vaultStore';
import { useSystemStore } from '@/stores/systemStore';
import { connectorsInCategory, type BuiltinConnectorDef } from '@/lib/credentials/builtinConnectors';
import { ConnectorCard } from '@/features/vault/sub_catalog/components/picker/ConnectorCard';
import { isDesktopBridge, isUniversalOAuthConnector, isGoogleOAuthConnector } from '@/lib/utils/platform/connectors';
import type { ConnectorDefinition, CredentialTemplateField } from '@/lib/types/types';
import { toastCatch } from '@/lib/silentCatch';
import { createLogger } from '@/lib/log';

const logger = createLogger('quick-add-credential');

/**
 * Credential that needs neither OAuth nor a desktop bridge — we can complete
 * the full add+healthcheck flow inside the modal using plain field values.
 * Everything else (Google OAuth, universal OAuth provider, desktop bridge,
 * CLI capture) is handed off to the Vault catalog via a deep-link so the
 * user completes it in the established surface.
 */
function supportsInlineCreation(connector: ConnectorDefinition): boolean {
  if (isDesktopBridge(connector)) return false;
  if (isGoogleOAuthConnector(connector)) return false;
  if (isUniversalOAuthConnector(connector)) return false;
  const metadata = (connector.metadata ?? {}) as Record<string, unknown>;
  if (metadata.auth_type === 'oauth') return false;
  if (metadata.auth_type === 'cli') return false;
  return true;
}

interface QuickAddCredentialModalProps {
  /** Category tag the questionnaire asked for (e.g. "advertising", "storage"). */
  category: string;
  /** Friendly label shown in the header (e.g. "advertising provider"). */
  categoryLabel?: string;
  /**
   * Called after a credential is created + healthchecked successfully.
   * Passes the new credential's service_type so the questionnaire can
   * auto-pick it.
   */
  onCredentialAdded: (serviceType: string) => void;
  onClose: () => void;
}

type Phase = 'pick' | 'form';

export function QuickAddCredentialModal({
  category,
  categoryLabel,
  onCredentialAdded,
  onClose,
}: QuickAddCredentialModalProps) {
  const [phase, setPhase] = useState<Phase>('pick');
  const [picked, setPicked] = useState<ConnectorDefinition | null>(null);
  const [credentialName, setCredentialName] = useState('');
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [healthState, setHealthState] = useState<{ success: boolean; message: string } | null>(null);

  const createCredential = useVaultStore((s) => s.createCredential);
  const healthcheckCredentialPreview = useVaultStore((s) => s.healthcheckCredentialPreview);
  const credentials = useVaultStore((s) => s.credentials);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);

  /**
   * Candidate connectors — the builtin catalog filtered by the requested
   * category tag. The catalog already de-duplicates by name, so the user
   * sees one card per provider. We render every connector in the category
   * (including ones they already own) so the picker is discoverable; the
   * ConnectorCard highlights the owned ones.
   */
  const candidates = useMemo(() => {
    return connectorsInCategory(category) as unknown as ConnectorDefinition[];
  }, [category]);

  const ownedServiceTypes = useMemo(
    () => new Set(credentials.map((c) => c.service_type)),
    [credentials],
  );

  const handlePick = (connector: ConnectorDefinition) => {
    setPicked(connector);
    setCredentialName(`My ${connector.label}`);
    setFieldValues({});
    setHealthState(null);
    setPhase('form');
  };

  const handleBackToPicker = () => {
    setPhase('pick');
    setPicked(null);
    setHealthState(null);
  };

  const handleOpenVaultCatalog = () => {
    setSidebarSection('credentials');
    onClose();
  };

  const handleSave = async () => {
    if (!picked) return;
    const missing = picked.fields.filter((f) => f.required && !fieldValues[f.key]?.trim());
    if (missing.length > 0) {
      setHealthState({ success: false, message: `Missing: ${missing.map((f) => f.label).join(', ')}` });
      return;
    }
    setSaving(true);
    setHealthState(null);
    try {
      // Healthcheck first so we can surface the failure without creating an
      // unhealthy credential. If the connector declares no healthcheck the
      // call returns {success: true} and we move on.
      const healthResult = await healthcheckCredentialPreview(picked.name, fieldValues);
      setHealthState(healthResult);
      if (!healthResult.success) {
        setSaving(false);
        return;
      }
      await createCredential({
        name: credentialName.trim() || picked.label,
        service_type: picked.name,
        data: fieldValues,
        healthcheck_passed: true,
      });
      onCredentialAdded(picked.name);
    } catch (err) {
      logger.warn('Failed to create credential from quick-add', { service: picked.name, err });
      toastCatch('QuickAddCredentialModal:createCredential', 'Failed to create credential')(err);
      setSaving(false);
    }
  };

  const humanCategory = categoryLabel ?? category.replace(/_/g, ' ');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl max-h-[90vh] flex flex-col bg-background border border-primary/15 rounded-modal shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-primary/10">
          <div className="flex items-center gap-3 min-w-0">
            {phase === 'form' && (
              <button
                onClick={handleBackToPicker}
                className="p-1 rounded-card hover:bg-secondary/60 transition-colors"
                aria-label="Back to picker"
              >
                <ArrowLeft className="w-4 h-4 text-foreground" />
              </button>
            )}
            <div className="min-w-0">
              <h2 className="typo-body-lg font-semibold text-foreground truncate">
                {phase === 'pick'
                  ? `Connect a ${humanCategory} provider`
                  : `Set up ${picked?.label}`}
              </h2>
              <p className="typo-body text-foreground/60 truncate">
                {phase === 'pick'
                  ? 'Pick a provider to connect. The persona will use it once a healthy credential is saved.'
                  : 'Fields are stored encrypted; the healthcheck runs before the credential is saved.'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-card hover:bg-secondary/60 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4 text-foreground" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5">
          {phase === 'pick' && (
            candidates.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
                {candidates.map((conn) => (
                  <ConnectorCard
                    key={conn.name}
                    connector={conn}
                    isOwned={ownedServiceTypes.has(conn.name)}
                    onPickType={handlePick}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-10 space-y-3">
                <p className="typo-body text-foreground/70">
                  No connectors declare the <code className="px-1 py-0.5 rounded bg-secondary/40 text-foreground">{category}</code> category yet.
                </p>
                <p className="typo-body text-foreground/60">
                  You can still add one from the Vault catalog — it will be picked up automatically here when tagged.
                </p>
                <button
                  onClick={handleOpenVaultCatalog}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-card border border-primary/20 hover:bg-primary/10 transition-colors typo-body text-foreground"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open Vault Catalog
                </button>
              </div>
            )
          )}

          {phase === 'form' && picked && (
            supportsInlineCreation(picked) ? (
              <InlineCredentialForm
                connector={picked}
                credentialName={credentialName}
                onCredentialNameChange={setCredentialName}
                fieldValues={fieldValues}
                onFieldChange={(key, value) =>
                  setFieldValues((prev) => ({ ...prev, [key]: value }))
                }
                healthState={healthState}
                saving={saving}
                onSubmit={handleSave}
              />
            ) : (
              <div className="space-y-3">
                <p className="typo-body text-foreground/80">
                  {picked.label} requires browser-based authentication, a local-app bridge, or CLI capture.
                  Finish the connection in the Vault catalog — it only takes a moment.
                </p>
                <p className="typo-body text-foreground/60">
                  Once the credential is healthy, close this questionnaire and re-open it. Your new
                  provider will appear in the list automatically.
                </p>
                <button
                  onClick={handleOpenVaultCatalog}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-card bg-primary/15 hover:bg-primary/25 border border-primary/30 transition-colors typo-body text-foreground"
                >
                  <ExternalLink className="w-4 h-4" />
                  Open Vault → Catalog
                </button>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

interface InlineCredentialFormProps {
  connector: ConnectorDefinition;
  credentialName: string;
  onCredentialNameChange: (v: string) => void;
  fieldValues: Record<string, string>;
  onFieldChange: (key: string, value: string) => void;
  healthState: { success: boolean; message: string } | null;
  saving: boolean;
  onSubmit: () => void;
}

function InlineCredentialForm({
  connector,
  credentialName,
  onCredentialNameChange,
  fieldValues,
  onFieldChange,
  healthState,
  saving,
  onSubmit,
}: InlineCredentialFormProps) {
  const metadata = (connector.metadata ?? {}) as Record<string, unknown>;
  const summary = typeof metadata.summary === 'string' ? metadata.summary : null;
  const setupGuide = typeof metadata.setup_guide === 'string' ? metadata.setup_guide : null;

  return (
    <div className="space-y-4">
      {summary && (
        <p className="typo-body text-foreground/70 leading-relaxed">{summary}</p>
      )}

      <div className="space-y-1.5">
        <label className="typo-body text-foreground/80 font-medium">Name</label>
        <input
          type="text"
          value={credentialName}
          onChange={(e) => onCredentialNameChange(e.target.value)}
          className="w-full px-3 py-2 typo-body rounded-card border border-white/[0.08] bg-white/[0.03] text-foreground focus:outline-none focus:border-primary/30 focus:bg-white/[0.05] transition-all"
        />
      </div>

      {connector.fields.map((field) => (
        <CredentialField
          key={field.key}
          field={field}
          value={fieldValues[field.key] ?? ''}
          onChange={(v) => onFieldChange(field.key, v)}
        />
      ))}

      {setupGuide && (
        <details className="rounded-card border border-primary/10 bg-secondary/20">
          <summary className="cursor-pointer px-3 py-2 typo-body text-foreground/70 hover:text-foreground">
            Setup guide
          </summary>
          <pre className="whitespace-pre-wrap px-3 py-2 typo-body text-foreground/70 font-sans border-t border-primary/10">
            {setupGuide}
          </pre>
        </details>
      )}

      {healthState && (
        <div
          className={`flex items-start gap-2 p-3 rounded-card border ${
            healthState.success
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
              : 'bg-red-500/10 border-red-500/20 text-red-300'
          }`}
        >
          {healthState.success ? (
            <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
          ) : (
            <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          )}
          <span className="typo-body">{healthState.message}</span>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button
          disabled={saving}
          onClick={onSubmit}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-card bg-primary/20 hover:bg-primary/30 border border-primary/30 disabled:opacity-50 disabled:cursor-not-allowed typo-body text-foreground transition-colors"
        >
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {saving ? 'Testing & saving…' : 'Healthcheck & save'}
        </button>
      </div>
    </div>
  );
}

interface CredentialFieldProps {
  field: CredentialTemplateField;
  value: string;
  onChange: (v: string) => void;
}

function CredentialField({ field, value, onChange }: CredentialFieldProps) {
  const isPassword = field.type === 'password';
  const isSelect = field.type === 'select' && Array.isArray(field.options) && field.options.length > 0;

  return (
    <div className="space-y-1.5">
      <label className="typo-body text-foreground/80 font-medium">
        {field.label}
        {field.required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {isSelect ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 typo-body rounded-card border border-white/[0.08] bg-white/[0.03] text-foreground focus:outline-none focus:border-primary/30 transition-all"
        >
          <option value="">— Select —</option>
          {(field.options ?? []).map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      ) : (
        <input
          type={isPassword ? 'password' : 'text'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder ?? ''}
          autoComplete="off"
          className="w-full px-3 py-2 typo-body rounded-card border border-white/[0.08] bg-white/[0.03] text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-primary/30 focus:bg-white/[0.05] transition-all"
        />
      )}
      {field.helpText && (
        <p className="typo-body text-foreground/55">{field.helpText}</p>
      )}
    </div>
  );
}
