import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronRight, CheckCircle2, Plus, Plug, ExternalLink } from 'lucide-react';
import { ConnectorIcon, getConnectorMeta } from '@/features/shared/components/ConnectorMeta';
import { CredentialEditForm } from '@/features/vault/components/CredentialEditForm';
import { usePersonaStore } from '@/stores/personaStore';
import type { ConnectorDefinition, CredentialMetadata, CredentialTemplateField } from '@/lib/types/types';

// ── Types ──────────────────────────────────────────────────────────────

interface RequiredConnector {
  name: string;
  setup_url?: string;
  setup_instructions?: string;
  credential_fields?: Array<{
    key: string;
    label: string;
    type: string;
    placeholder?: string;
    helpText?: string;
    required?: boolean;
  }>;
}

interface ConnectStepProps {
  requiredConnectors: RequiredConnector[];
  connectorDefinitions: ConnectorDefinition[];
  credentials: CredentialMetadata[];
  connectorCredentialMap: Record<string, string>;
  inlineCredentialConnector: string | null;
  onSetCredential: (connectorName: string, credentialId: string) => void;
  onClearCredential: (connectorName: string) => void;
  onSetInlineConnector: (name: string | null) => void;
  onCredentialCreated: () => void;
}

// ── Helpers ────────────────────────────────────────────────────────────

function findMatchingCredentials(
  connectorName: string,
  allCredentials: CredentialMetadata[],
): CredentialMetadata[] {
  return allCredentials.filter((c) => c.service_type === connectorName);
}

function findConnectorDefinition(
  connectorName: string,
  definitions: ConnectorDefinition[],
): ConnectorDefinition | undefined {
  return definitions.find((d) => d.name === connectorName);
}

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return 'never';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  if (diffMs < 0) return 'just now';

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── Health Badge ───────────────────────────────────────────────────────

function HealthBadge({ credential }: { credential: CredentialMetadata }) {
  if (credential.healthcheck_last_success === null) {
    return (
      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-secondary/40 text-muted-foreground/50">
        untested
      </span>
    );
  }
  if (credential.healthcheck_last_success) {
    return (
      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">
        healthy
      </span>
    );
  }
  return (
    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">
      failing
    </span>
  );
}

// ── Connector Card ─────────────────────────────────────────────────────

function ConnectorCard({
  connector,
  connectorDefinitions,
  credentials,
  selectedCredentialId,
  isInlineActive,
  onSetCredential,
  onClearCredential,
  onSetInlineConnector,
  onCredentialCreated,
}: {
  connector: RequiredConnector;
  connectorDefinitions: ConnectorDefinition[];
  credentials: CredentialMetadata[];
  selectedCredentialId: string | undefined;
  isInlineActive: boolean;
  onSetCredential: (connectorName: string, credentialId: string) => void;
  onClearCredential: (connectorName: string) => void;
  onSetInlineConnector: (name: string | null) => void;
  onCredentialCreated: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const meta = getConnectorMeta(connector.name);
  const matchingCreds = useMemo(
    () => findMatchingCredentials(connector.name, credentials),
    [connector.name, credentials],
  );
  const connectorDef = useMemo(
    () => findConnectorDefinition(connector.name, connectorDefinitions),
    [connector.name, connectorDefinitions],
  );
  const selectedCredential = useMemo(
    () => (selectedCredentialId ? credentials.find((c) => c.id === selectedCredentialId) : undefined),
    [selectedCredentialId, credentials],
  );
  const categoryLabel = connectorDef?.category;
  const hasCredential = !!selectedCredentialId;

  // Build fields for inline form from ConnectorDefinition or RequiredConnector
  const inlineFields: CredentialTemplateField[] = useMemo(() => {
    if (connectorDef?.fields && connectorDef.fields.length > 0) {
      return connectorDef.fields;
    }
    if (connector.credential_fields && connector.credential_fields.length > 0) {
      return connector.credential_fields.map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type as CredentialTemplateField['type'],
        placeholder: f.placeholder,
        helpText: f.helpText,
        required: f.required,
      }));
    }
    return [];
  }, [connectorDef, connector.credential_fields]);

  const setupUrl = connector.setup_url;
  const setupInstructions = connector.setup_instructions;

  const handleInlineSave = useCallback(
    async (values: Record<string, string>) => {
      const store = usePersonaStore.getState();
      const credId = await store.createCredential({
        name: `${meta.label} credential`,
        service_type: connector.name,
        data: values,
      });
      if (credId) {
        onCredentialCreated();
        onSetCredential(connector.name, credId);
        onSetInlineConnector(null);
      }
    },
    [connector.name, meta.label, onCredentialCreated, onSetCredential, onSetInlineConnector],
  );

  const handleInlineCancel = useCallback(() => {
    onSetInlineConnector(null);
  }, [onSetInlineConnector]);

  return (
    <div
      className={`rounded-xl border p-4 transition-all ${
        hasCredential ? 'border-emerald-500/20 bg-secondary/20' : 'border-primary/10 bg-secondary/20'
      }`}
    >
      {/* Header row */}
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center gap-3 text-left"
      >
        <ConnectorIcon meta={meta} size="w-5 h-5" />
        <span className="text-sm font-medium text-foreground/90">{meta.label}</span>
        {categoryLabel && (
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-secondary/40 text-muted-foreground/50">
            {categoryLabel}
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {hasCredential ? (
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span className="text-xs text-emerald-400">{selectedCredential?.name ?? 'configured'}</span>
            </div>
          ) : (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">
              needs credential
            </span>
          )}
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground/50" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground/50" />
          )}
        </div>
      </button>

      {/* Expandable body */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="mt-4 space-y-3">
              {/* Existing credentials list */}
              {matchingCreds.length > 0 ? (
                <div className="space-y-1.5">
                  {matchingCreds.map((cred) => {
                    const isSelected = cred.id === selectedCredentialId;
                    return (
                      <button
                        key={cred.id}
                        type="button"
                        onClick={() => {
                          if (isSelected) {
                            onClearCredential(connector.name);
                          } else {
                            onSetCredential(connector.name, cred.id);
                          }
                        }}
                        className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-all ${
                          isSelected
                            ? 'border-violet-500/20 bg-violet-500/5'
                            : 'border-primary/10 bg-secondary/15 hover:bg-secondary/30'
                        }`}
                      >
                        {/* Radio dot */}
                        <div
                          className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border transition-colors ${
                            isSelected
                              ? 'border-violet-500 bg-violet-500'
                              : 'border-muted-foreground/30 bg-transparent'
                          }`}
                        >
                          {isSelected && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                        </div>

                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium text-foreground/85">{cred.name}</span>
                        </div>

                        <span className="text-[10px] text-muted-foreground/50 flex-shrink-0">
                          {relativeTime(cred.healthcheck_last_tested_at)}
                        </span>

                        <HealthBadge credential={cred} />
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground/50 px-1">
                  No matching credentials for {meta.label}
                </p>
              )}

              {/* Separator */}
              <div className="border-t border-primary/8" />

              {/* Create New button */}
              {!isInlineActive && (
                <button
                  type="button"
                  onClick={() => onSetInlineConnector(connector.name)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-primary/15 text-sm text-muted-foreground/70 hover:bg-secondary/30 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Create New Credential
                </button>
              )}

              {/* Inline credential creation form */}
              {isInlineActive && (
                <div className="rounded-lg border border-primary/15 bg-background/30 p-4 space-y-3">
                  {/* Setup URL link */}
                  {setupUrl && (
                    <a
                      href={setupUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 px-4 py-3 bg-amber-500/10 border-2 border-amber-500/30 rounded-xl text-sm text-foreground/80 hover:bg-amber-500/15 hover:border-amber-500/40 transition-colors group"
                    >
                      <span className="w-6 h-6 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-sm font-bold text-amber-400 flex-shrink-0">
                        1
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className="font-medium">Get your credentials</span>
                        <span className="text-xs text-muted-foreground/60 block truncate mt-0.5">
                          {setupUrl}
                        </span>
                      </div>
                      <ExternalLink className="w-4 h-4 text-amber-400/70 flex-shrink-0 group-hover:scale-110 transition-transform" />
                    </a>
                  )}

                  {/* Setup instructions */}
                  {setupInstructions && (
                    <div className="px-3.5 py-2.5 bg-secondary/60 border border-primary/10 rounded-xl">
                      <p className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider mb-1.5">
                        Setup Instructions
                      </p>
                      <p className="text-sm text-foreground/80 whitespace-pre-line leading-relaxed">
                        {setupInstructions}
                      </p>
                    </div>
                  )}

                  {/* Credential form */}
                  {inlineFields.length > 0 ? (
                    <CredentialEditForm
                      fields={inlineFields}
                      onSave={handleInlineSave}
                      onCancel={handleInlineCancel}
                    />
                  ) : (
                    <div className="text-sm text-muted-foreground/50 text-center py-4">
                      No credential fields defined for this connector.
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────

export function ConnectStep({
  requiredConnectors,
  connectorDefinitions,
  credentials,
  connectorCredentialMap,
  inlineCredentialConnector,
  onSetCredential,
  onClearCredential,
  onSetInlineConnector,
  onCredentialCreated,
}: ConnectStepProps) {
  const configuredCount = useMemo(
    () => requiredConnectors.filter((c) => connectorCredentialMap[c.name]).length,
    [requiredConnectors, connectorCredentialMap],
  );
  const totalCount = requiredConnectors.length;
  const progressPercent = totalCount > 0 ? (configuredCount / totalCount) * 100 : 0;

  // ── Empty state ──
  if (requiredConnectors.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Plug className="w-10 h-10 text-muted-foreground/25 mb-3" />
        <p className="text-sm text-muted-foreground/50">
          No connectors needed -- you're all set!
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Progress rail */}
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground/70">
          {configuredCount} of {totalCount} connector{totalCount !== 1 ? 's' : ''} configured
        </p>
        <div className="h-1.5 rounded-full bg-secondary/40 overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-emerald-400"
            initial={{ width: 0 }}
            animate={{ width: `${progressPercent}%` }}
            transition={{ type: 'spring', damping: 20, stiffness: 200 }}
          />
        </div>
      </div>

      {/* Connector cards */}
      <div className="space-y-3">
        {requiredConnectors.map((connector) => (
          <ConnectorCard
            key={connector.name}
            connector={connector}
            connectorDefinitions={connectorDefinitions}
            credentials={credentials}
            selectedCredentialId={connectorCredentialMap[connector.name]}
            isInlineActive={inlineCredentialConnector === connector.name}
            onSetCredential={onSetCredential}
            onClearCredential={onClearCredential}
            onSetInlineConnector={onSetInlineConnector}
            onCredentialCreated={onCredentialCreated}
          />
        ))}
      </div>
    </div>
  );
}
