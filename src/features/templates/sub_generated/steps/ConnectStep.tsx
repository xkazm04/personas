import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2,
  Plug,
  ExternalLink,
  AlertCircle,
  ChevronDown,
  Star,
  Box,
} from 'lucide-react';
import { ConnectorIcon, getConnectorMeta } from '@/features/shared/components/ConnectorMeta';
import { CredentialEditForm } from '@/features/vault/components/CredentialEditForm';
import { usePersonaStore } from '@/stores/personaStore';
import { useAdoptionWizard } from '../AdoptionWizardContext';
import type { ConnectorDefinition, CredentialMetadata, CredentialTemplateField } from '@/lib/types/types';

// ── Types ──────────────────────────────────────────────────────────────

export interface RequiredConnector {
  name: string;           // template's ORIGINAL connector
  activeName: string;     // currently selected (after swap)
  role?: string;
  roleLabel?: string;
  roleMembers?: string[];
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

// ── Connector Dropdown ─────────────────────────────────────────────────

function ConnectorDropdown({
  members,
  activeName,
  recommendedName,
  onSelect,
}: {
  members: string[];
  activeName: string;
  recommendedName: string;
  onSelect: (name: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const activeMeta = getConnectorMeta(activeName);
  const isRecommended = activeName === recommendedName;

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 px-2.5 py-2 bg-background/50 border border-primary/10 rounded-lg text-sm text-foreground/80 hover:border-primary/20 transition-colors text-left"
      >
        <ConnectorIcon meta={activeMeta} size="w-4 h-4" />
        <span className="flex-1 truncate">{activeMeta.label}</span>
        {isRecommended && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-medium rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/20">
            <Star className="w-2 h-2" />
            Rec
          </span>
        )}
        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground/50 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 z-20 bg-background border border-primary/20 rounded-xl shadow-xl overflow-hidden">
          <div className="max-h-[240px] overflow-y-auto py-1">
            {members.map((member) => {
              const memberMeta = getConnectorMeta(member);
              const isActive = member === activeName;
              const isRec = member === recommendedName;
              return (
                <button
                  key={member}
                  type="button"
                  onClick={() => {
                    onSelect(member);
                    setIsOpen(false);
                  }}
                  className={`flex items-center gap-2.5 w-full px-3 py-2.5 text-left transition-colors ${
                    isActive
                      ? 'bg-violet-500/10 text-violet-300'
                      : 'text-foreground/80 hover:bg-primary/5'
                  }`}
                >
                  <ConnectorIcon meta={memberMeta} size="w-4 h-4" />
                  <span className="text-sm flex-1 truncate">{memberMeta.label}</span>
                  {isRec && (
                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-medium rounded-full bg-violet-500/10 text-violet-400/70 border border-violet-500/15 flex-shrink-0">
                      <Star className="w-2 h-2" />
                      Recommended
                    </span>
                  )}
                  {isActive && <CheckCircle2 className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Component Card (for role-grouped connectors) ───────────────────────

function ComponentCard({
  connector,
  credentials,
  selectedCredentialId,
  onSetCredential,
  onClearCredential,
  onOpenInlineForm,
  onSwapConnector,
  justCreated,
}: {
  connector: RequiredConnector;
  credentials: CredentialMetadata[];
  selectedCredentialId: string | undefined;
  onSetCredential: (connectorName: string, credentialId: string) => void;
  onClearCredential: (connectorName: string) => void;
  onOpenInlineForm: (connectorName: string) => void;
  onSwapConnector: (originalName: string, replacementName: string) => void;
  justCreated?: boolean;
}) {
  const hasCredential = !!selectedCredentialId;
  const matchingCreds = useMemo(
    () => findMatchingCredentials(connector.activeName, credentials),
    [connector.activeName, credentials],
  );

  const handleCredentialChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const val = e.target.value;
      if (val === '__create__') {
        onOpenInlineForm(connector.activeName);
      } else if (val === '') {
        onClearCredential(connector.activeName);
      } else {
        onSetCredential(connector.activeName, val);
      }
    },
    [connector.activeName, onSetCredential, onClearCredential, onOpenInlineForm],
  );

  const handleConnectorSelect = useCallback(
    (selected: string) => {
      onSwapConnector(connector.name, selected);
    },
    [connector.name, onSwapConnector],
  );

  return (
    <div
      className={`rounded-xl border p-4 transition-all ${
        hasCredential ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-primary/10 bg-secondary/20'
      }`}
    >
      {/* Role header */}
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-7 h-7 rounded-lg bg-violet-500/10 border border-violet-500/15 flex items-center justify-center flex-shrink-0">
          <Box className="w-3.5 h-3.5 text-violet-400/70" />
        </div>
        <span className="text-sm font-semibold text-foreground/90 flex-1">{connector.roleLabel}</span>
        {hasCredential ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
        ) : (
          <AlertCircle className="w-4 h-4 text-amber-400/60 flex-shrink-0" />
        )}
      </div>

      {/* Connector selector */}
      <div className="mb-3">
        <label className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider mb-1.5 block">
          Connector
        </label>
        <ConnectorDropdown
          members={connector.roleMembers!}
          activeName={connector.activeName}
          recommendedName={connector.name}
          onSelect={handleConnectorSelect}
        />
      </div>

      {/* Credential dropdown */}
      <div>
        <label className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider mb-1.5 block">
          Credential
        </label>
        <select
          value={selectedCredentialId ?? ''}
          onChange={handleCredentialChange}
          className={`w-full px-2.5 py-2 bg-background/50 border rounded-lg text-sm text-foreground/80 focus:outline-none focus:border-violet-500/30 transition-colors appearance-none cursor-pointer ${
            justCreated
              ? 'border-emerald-400/60 ring-2 ring-emerald-400/20'
              : hasCredential ? 'border-emerald-500/15' : 'border-primary/10'
          }`}
          style={justCreated ? { transition: 'border-color 0.3s, box-shadow 0.3s' } : undefined}
        >
          <option value="">Select credential...</option>
          {matchingCreds.map((cred) => (
            <option key={cred.id} value={cred.id}>
              {cred.name}
            </option>
          ))}
          <option value="__create__">+ Create new credential</option>
        </select>
      </div>
    </div>
  );
}

// ── Standalone Tile (for connectors without a role) ────────────────────

function StandaloneConnectorTile({
  connector,
  credentials,
  selectedCredentialId,
  onSetCredential,
  onClearCredential,
  onOpenInlineForm,
  justCreated,
}: {
  connector: RequiredConnector;
  credentials: CredentialMetadata[];
  selectedCredentialId: string | undefined;
  onSetCredential: (connectorName: string, credentialId: string) => void;
  onClearCredential: (connectorName: string) => void;
  onOpenInlineForm: (connectorName: string) => void;
  justCreated?: boolean;
}) {
  const meta = getConnectorMeta(connector.activeName);
  const hasCredential = !!selectedCredentialId;
  const matchingCreds = useMemo(
    () => findMatchingCredentials(connector.activeName, credentials),
    [connector.activeName, credentials],
  );

  const handleSelectChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const val = e.target.value;
      if (val === '__create__') {
        onOpenInlineForm(connector.activeName);
      } else if (val === '') {
        onClearCredential(connector.activeName);
      } else {
        onSetCredential(connector.activeName, val);
      }
    },
    [connector.activeName, onSetCredential, onClearCredential, onOpenInlineForm],
  );

  return (
    <div
      className={`rounded-xl border p-3 transition-all ${
        hasCredential ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-primary/10 bg-secondary/20'
      }`}
    >
      <div className="flex items-center gap-2.5 mb-2">
        {hasCredential ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
        ) : (
          <AlertCircle className="w-3.5 h-3.5 text-amber-400/60 flex-shrink-0" />
        )}
        <ConnectorIcon meta={meta} size="w-4 h-4" />
        <span className="text-sm font-medium text-foreground/90 flex-1 truncate">{meta.label}</span>
      </div>

      <select
        value={selectedCredentialId ?? ''}
        onChange={handleSelectChange}
        className={`w-full px-2.5 py-1.5 bg-background/50 border rounded-lg text-sm text-foreground/80 focus:outline-none focus:border-violet-500/30 transition-colors appearance-none cursor-pointer ${
          justCreated
            ? 'border-emerald-400/60 ring-2 ring-emerald-400/20'
            : hasCredential ? 'border-emerald-500/15' : 'border-primary/10'
        }`}
        style={justCreated ? { transition: 'border-color 0.3s, box-shadow 0.3s' } : undefined}
      >
        <option value="">Select credential...</option>
        {matchingCreds.map((cred) => (
          <option key={cred.id} value={cred.id}>
            {cred.name}
          </option>
        ))}
        <option value="__create__">+ Create new credential</option>
      </select>
    </div>
  );
}

// ── Inline Form Panel ─────────────────────────────────────────────────

function InlineFormPanel({
  connectorName,
  connectorDefinitions,
  credentialFields,
  setupUrl,
  setupInstructions,
  onSetCredential,
  onCredentialCreated,
  onSaveSuccess,
  onClose,
}: {
  connectorName: string;
  connectorDefinitions: ConnectorDefinition[];
  credentialFields?: RequiredConnector['credential_fields'];
  setupUrl?: string;
  setupInstructions?: string;
  onSetCredential: (connectorName: string, credentialId: string) => void;
  onCredentialCreated: () => void;
  onSaveSuccess?: (connectorName: string, credentialName: string) => void;
  onClose: () => void;
}) {
  const meta = getConnectorMeta(connectorName);
  const connectorDef = useMemo(
    () => findConnectorDefinition(connectorName, connectorDefinitions),
    [connectorName, connectorDefinitions],
  );

  const inlineFields: CredentialTemplateField[] = useMemo(() => {
    if (connectorDef?.fields && connectorDef.fields.length > 0) {
      return connectorDef.fields;
    }
    if (credentialFields && credentialFields.length > 0) {
      return credentialFields.map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type as CredentialTemplateField['type'],
        placeholder: f.placeholder,
        helpText: f.helpText,
        required: f.required,
      }));
    }
    return [];
  }, [connectorDef, credentialFields]);

  const credentialName = `${meta.label} credential`;

  const handleSave = useCallback(
    async (values: Record<string, string>) => {
      const store = usePersonaStore.getState();
      const credId = await store.createCredential({
        name: credentialName,
        service_type: connectorName,
        data: values,
      });
      if (credId) {
        onCredentialCreated();
        onSetCredential(connectorName, credId);
        onSaveSuccess?.(connectorName, credentialName);
        onClose();
      }
    },
    [connectorName, credentialName, onCredentialCreated, onSetCredential, onSaveSuccess, onClose],
  );

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.2, ease: 'easeInOut' }}
      className="overflow-hidden"
    >
      <div className="rounded-xl border border-primary/15 bg-secondary/20 p-4 space-y-3">
        <div className="flex items-center gap-2 mb-2">
          <ConnectorIcon meta={meta} size="w-4 h-4" />
          <span className="text-sm font-medium text-foreground/80">
            New {meta.label} Credential
          </span>
        </div>

        {setupUrl && (
          <a
            href={setupUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/25 rounded-lg text-sm text-foreground/80 hover:bg-amber-500/15 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5 text-amber-400/70 flex-shrink-0" />
            <span className="flex-1 truncate">Get your credentials</span>
          </a>
        )}

        {setupInstructions && (
          <div className="px-3 py-2 bg-secondary/40 border border-primary/8 rounded-lg">
            <p className="text-xs text-muted-foreground/70 whitespace-pre-line leading-relaxed">
              {setupInstructions}
            </p>
          </div>
        )}

        {inlineFields.length > 0 ? (
          <CredentialEditForm
            fields={inlineFields}
            onSave={handleSave}
            onCancel={onClose}
          />
        ) : (
          <div className="text-sm text-muted-foreground/50 text-center py-3">
            No credential fields defined.
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Success Bridge Chip ─────────────────────────────────────────────────

function SuccessBridgeChip({ credentialName, onDone }: { credentialName: string; onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 1500);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.92 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4, scale: 0.95 }}
      transition={{ type: 'spring', damping: 18, stiffness: 300 }}
      className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/25 shadow-lg shadow-emerald-500/10"
    >
      <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
      <span className="text-sm font-medium text-emerald-300 truncate max-w-[200px]">{credentialName}</span>
      <span className="text-xs text-emerald-400/60">connected</span>
    </motion.div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────

export function ConnectStep() {
  const ctx = useAdoptionWizard();
  const requiredConnectors = ctx.requiredConnectors;
  const connectorDefinitions = ctx.connectorDefinitions;
  const credentials = ctx.liveCredentials;
  const connectorCredentialMap = ctx.state.connectorCredentialMap;
  const inlineCredentialConnector = ctx.state.inlineCredentialConnector;
  const onSetCredential = ctx.wizard.setConnectorCredential;
  const onClearCredential = ctx.wizard.clearConnectorCredential;
  const onSetInlineConnector = ctx.wizard.setInlineCredentialConnector;
  const onCredentialCreated = ctx.handleCredentialCreated;
  const onSwapConnector = ctx.wizard.swapConnector;

  // Success bridge state: tracks which connector just had a credential created
  const [justCreated, setJustCreated] = useState<{ connector: string; credName: string } | null>(null);
  const justCreatedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleInlineSaveSuccess = useCallback((connName: string, credName: string) => {
    if (justCreatedTimerRef.current) clearTimeout(justCreatedTimerRef.current);
    setJustCreated({ connector: connName, credName });
    justCreatedTimerRef.current = setTimeout(() => setJustCreated(null), 1800);
  }, []);
  const configuredCount = useMemo(
    () => requiredConnectors.filter((c) => connectorCredentialMap[c.activeName]).length,
    [requiredConnectors, connectorCredentialMap],
  );
  const totalCount = requiredConnectors.length;
  const progressPercent = totalCount > 0 ? (configuredCount / totalCount) * 100 : 0;

  // Separate into role-grouped (component cards) and standalone
  const { componentConnectors, standaloneConnectors } = useMemo(() => {
    const withRole: RequiredConnector[] = [];
    const without: RequiredConnector[] = [];
    for (const conn of requiredConnectors) {
      if (conn.role && conn.roleLabel && conn.roleMembers) {
        withRole.push(conn);
      } else {
        without.push(conn);
      }
    }
    return { componentConnectors: withRole, standaloneConnectors: without };
  }, [requiredConnectors]);

  // Find the active inline connector (using activeName)
  const activeInlineConnector = useMemo(
    () => requiredConnectors.find((c) => c.activeName === inlineCredentialConnector),
    [requiredConnectors, inlineCredentialConnector],
  );

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
    <div className="space-y-4">
      {/* Progress rail */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground/70">
            {configuredCount} of {totalCount} component{totalCount !== 1 ? 's' : ''} configured
          </p>
          <AnimatePresence mode="wait">
            {justCreated ? (
              <SuccessBridgeChip
                key={justCreated.connector}
                credentialName={justCreated.credName}
                onDone={() => setJustCreated(null)}
              />
            ) : configuredCount < totalCount ? (
              <motion.span
                key="remaining"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-xs text-amber-400/70"
              >
                {totalCount - configuredCount} remaining
              </motion.span>
            ) : null}
          </AnimatePresence>
        </div>
        <div className="h-1.5 rounded-full bg-secondary/40 overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-emerald-400"
            initial={{ width: 0 }}
            animate={{ width: `${progressPercent}%` }}
            transition={{ type: 'spring', damping: 20, stiffness: 200 }}
          />
        </div>
      </div>

      {/* Architecture Component Cards */}
      {componentConnectors.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {componentConnectors.map((connector) => (
            <ComponentCard
              key={connector.name}
              connector={connector}
              credentials={credentials}
              selectedCredentialId={connectorCredentialMap[connector.activeName]}
              onSetCredential={onSetCredential}
              onClearCredential={onClearCredential}
              onOpenInlineForm={(name) => onSetInlineConnector(name)}
              onSwapConnector={onSwapConnector!}
              justCreated={justCreated?.connector === connector.activeName}
            />
          ))}
        </div>
      )}

      {/* Standalone Connector Tiles (no role) */}
      {standaloneConnectors.length > 0 && (
        <>
          {componentConnectors.length > 0 && (
            <div className="flex items-center gap-2 pt-1">
              <div className="flex-1 h-px bg-primary/8" />
              <span className="text-[10px] font-medium text-muted-foreground/40 uppercase tracking-wider">
                Additional Connectors
              </span>
              <div className="flex-1 h-px bg-primary/8" />
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {standaloneConnectors.map((connector) => (
              <StandaloneConnectorTile
                key={connector.name}
                connector={connector}
                credentials={credentials}
                selectedCredentialId={connectorCredentialMap[connector.activeName]}
                onSetCredential={onSetCredential}
                onClearCredential={onClearCredential}
                onOpenInlineForm={(name) => onSetInlineConnector(name)}
                justCreated={justCreated?.connector === connector.activeName}
              />
            ))}
          </div>
        </>
      )}

      {/* Shared inline credential form (below grid) */}
      <AnimatePresence initial={false}>
        {activeInlineConnector && (
          <InlineFormPanel
            key={activeInlineConnector.activeName}
            connectorName={activeInlineConnector.activeName}
            connectorDefinitions={connectorDefinitions}
            credentialFields={activeInlineConnector.credential_fields}
            setupUrl={activeInlineConnector.setup_url}
            setupInstructions={activeInlineConnector.setup_instructions}
            onSetCredential={onSetCredential}
            onCredentialCreated={onCredentialCreated}
            onSaveSuccess={handleInlineSaveSuccess}
            onClose={() => onSetInlineConnector(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
