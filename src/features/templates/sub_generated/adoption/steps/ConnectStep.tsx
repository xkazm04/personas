import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import {
  CheckCircle2,
  Plug,
  AlertCircle,
  ChevronDown,
  Star,
  Box,
  Plus,
} from 'lucide-react';
import { ConnectorIcon, getConnectorMeta } from '@/features/shared/components/ConnectorMeta';
import { ThemedSelect } from '@/features/shared/components/ThemedSelect';
import { ConnectorPipeline } from '../../shared/ConnectorPipeline';
import { useAdoptionWizard } from '../AdoptionWizardContext';
import type { ConnectorPipelineStep } from '@/lib/types/designTypes';
import { InlineCredentialPanel } from './InlineCredentialPanel';
import type { CredentialMetadata } from '@/lib/types/types';

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

const BUILTIN_CONNECTORS = new Set(['personas_messages', 'personas_database']);

function isVirtual(name: string): boolean {
  return BUILTIN_CONNECTORS.has(name);
}

function findMatchingCredentials(
  connectorName: string,
  allCredentials: CredentialMetadata[],
): CredentialMetadata[] {
  return allCredentials.filter((c) => c.service_type === connectorName);
}

// ── Connector Dropdown ─────────────────────────────────────────────────

function ConnectorDropdown({
  members,
  activeName,
  recommendedName,
  onSelect,
  credentials,
}: {
  members: string[];
  activeName: string;
  recommendedName: string;
  onSelect: (name: string) => void;
  credentials: CredentialMetadata[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const activeMeta = getConnectorMeta(activeName);

  // Filter to only connectors user has credentials for (+ always keep active + built-in), sorted by name
  const adoptedMembers = useMemo(() => {
    const credServiceTypes = new Set(credentials.map((c) => c.service_type));
    const filtered = members.filter(
      (m) => m === activeName || credServiceTypes.has(m) || BUILTIN_CONNECTORS.has(m),
    );
    return filtered.sort((a, b) => {
      const labelA = getConnectorMeta(a).label.toLowerCase();
      const labelB = getConnectorMeta(b).label.toLowerCase();
      return labelA.localeCompare(labelB);
    });
  }, [members, activeName, credentials]);
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
        className="w-full flex items-center gap-2 px-2.5 py-1.5 bg-background/50 border border-primary/10 rounded-lg text-sm text-foreground/80 hover:border-primary/20 transition-colors text-left"
      >
        <ConnectorIcon meta={activeMeta} size="w-3.5 h-3.5" />
        <span className="flex-1 truncate">{activeMeta.label}</span>
        {isRecommended && (
          <span className="inline-flex items-center gap-0.5 px-1 py-0.5 text-[10px] font-medium rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/20" title="Original template connector">
            <Star className="w-2 h-2" />
          </span>
        )}
        <ChevronDown className={`w-3 h-3 text-muted-foreground/50 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 z-20 bg-background border border-primary/20 rounded-xl shadow-xl overflow-hidden">
          <div className="max-h-[240px] overflow-y-auto py-1">
            {adoptedMembers.map((member) => {
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
                  className={`flex items-center gap-2.5 w-full px-3 py-2 text-left transition-colors ${
                    isActive
                      ? 'bg-violet-500/10 text-violet-300'
                      : 'text-foreground/80 hover:bg-primary/5'
                  }`}
                >
                  <ConnectorIcon meta={memberMeta} size="w-3.5 h-3.5" />
                  <span className="text-sm flex-1 truncate">{memberMeta.label}</span>
                  {isRec && (
                    <span className="text-[10px] text-violet-400/60">Original</span>
                  )}
                  {isActive && <CheckCircle2 className="w-3 h-3 text-violet-400 flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Resolved connector (compact row) ────────────────────────────────

function ResolvedConnectorRow({
  connector,
  credentialName,
}: {
  connector: RequiredConnector;
  credentialName: string;
}) {
  const meta = getConnectorMeta(connector.activeName);
  const builtIn = isVirtual(connector.activeName);

  return (
    <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-emerald-500/15 bg-emerald-500/5">
      <ConnectorIcon meta={meta} size="w-4 h-4" />
      <span className="text-sm font-medium text-foreground/80 flex-1 truncate">{meta.label}</span>
      <span className="text-sm text-muted-foreground/50 truncate max-w-[180px]">
        {builtIn ? 'Built-in' : credentialName}
      </span>
      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
    </div>
  );
}

// ── Unresolved Component Card ───────────────────────────────────────

function UnresolvedComponentCard({
  connector,
  credentials,
  selectedCredentialId,
  onSetCredential,
  onClearCredential,
  onOpenInlineForm,
  onOpenDesign,
  onSwapConnector,
}: {
  connector: RequiredConnector;
  credentials: CredentialMetadata[];
  selectedCredentialId: string | undefined;
  onSetCredential: (connectorName: string, credentialId: string) => void;
  onClearCredential: (connectorName: string) => void;
  onOpenInlineForm: (connectorName: string) => void;
  onOpenDesign: (connectorName: string) => void;
  onSwapConnector: (originalName: string, replacementName: string) => void;
}) {
  const builtIn = isVirtual(connector.activeName);
  const hasCredential = builtIn || !!selectedCredentialId;
  const matchingCreds = useMemo(
    () => findMatchingCredentials(connector.activeName, credentials),
    [connector.activeName, credentials],
  );

  const handleCredentialChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const val = e.target.value;
      if (val === '__create__') onOpenInlineForm(connector.activeName);
      else if (val === '__design__') onOpenDesign(connector.activeName);
      else if (val === '') onClearCredential(connector.activeName);
      else onSetCredential(connector.activeName, val);
    },
    [connector.activeName, onSetCredential, onClearCredential, onOpenInlineForm, onOpenDesign],
  );

  const handleConnectorSelect = useCallback(
    (selected: string) => onSwapConnector(connector.name, selected),
    [connector.name, onSwapConnector],
  );

  return (
    <div className={`rounded-xl border p-3 ${
      hasCredential ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-amber-500/15 bg-secondary/20'
    }`}>
      {/* Role header */}
      <div className="flex items-center gap-2 mb-2">
        <div className="w-5 h-5 rounded-md bg-violet-500/10 border border-violet-500/15 flex items-center justify-center flex-shrink-0">
          <Box className="w-2.5 h-2.5 text-violet-400/70" />
        </div>
        <span className="text-sm font-semibold text-foreground/90 flex-1 truncate">{connector.roleLabel ?? getConnectorMeta(connector.activeName).label}</span>
        {hasCredential ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
        ) : (
          <AlertCircle className="w-3.5 h-3.5 text-amber-400/60 flex-shrink-0" />
        )}
      </div>

      {/* Connector selector (only if there are role members) */}
      {connector.roleMembers && connector.roleMembers.length > 1 && (
        <div className="mb-2">
          <ConnectorDropdown
            members={connector.roleMembers}
            activeName={connector.activeName}
            recommendedName={connector.name}
            onSelect={handleConnectorSelect}
            credentials={credentials}
          />
        </div>
      )}

      {/* Credential dropdown or built-in badge */}
      {builtIn ? (
        <div className="flex items-center gap-1.5 px-2 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
          <span className="text-sm text-emerald-300/80">Built-in</span>
        </div>
      ) : (
        <div className="space-y-1.5">
          <ThemedSelect
            value={selectedCredentialId ?? ''}
            onChange={handleCredentialChange}
            className={`py-1.5 px-2.5 ${hasCredential ? 'border-emerald-500/15' : 'border-primary/10'}`}
          >
            <option value="">Select credential...</option>
            {matchingCreds.map((cred) => (
              <option key={cred.id} value={cred.id}>{cred.name}</option>
            ))}
            <option value="__create__">+ Create new credential</option>
            <option value="__design__">+ Design custom connector</option>
          </ThemedSelect>
          {!hasCredential && matchingCreds.length === 0 && (
            <button
              type="button"
              onClick={() => onOpenInlineForm(connector.activeName)}
              className="flex items-center gap-1.5 px-2 py-1 text-sm text-violet-400/70 hover:text-violet-300 transition-colors"
            >
              <Plus className="w-3 h-3" />
              Add credential
            </button>
          )}
        </div>
      )}
    </div>
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
  const onSetCredential = ctx.setConnectorCredential;
  const onClearCredential = ctx.clearConnectorCredential;
  const onSetInlineConnector = ctx.wizard.setInlineCredentialConnector;
  const onCredentialCreated = ctx.handleCredentialCreated;
  const onSwapConnector = ctx.wizard.swapConnector;

  const [inlineStartMode, setInlineStartMode] = useState<'pick' | 'design-query'>('pick');
  const [showPipeline, setShowPipeline] = useState(false);

  const handleOpenInlineForm = useCallback((name: string) => {
    setInlineStartMode('pick');
    onSetInlineConnector(name);
  }, [onSetInlineConnector]);

  const handleOpenDesign = useCallback((name: string) => {
    setInlineStartMode('design-query');
    onSetInlineConnector(name);
  }, [onSetInlineConnector]);

  // Classify connectors as resolved vs unresolved
  const { resolved, unresolved, missingNames } = useMemo(() => {
    const res: Array<{ connector: RequiredConnector; credName: string }> = [];
    const unres: RequiredConnector[] = [];
    const missing: string[] = [];

    for (const c of requiredConnectors) {
      const builtIn = isVirtual(c.activeName);
      const credId = connectorCredentialMap[c.activeName];
      if (builtIn) {
        res.push({ connector: c, credName: 'Built-in' });
      } else if (credId) {
        const cred = credentials.find((cr) => cr.id === credId);
        res.push({ connector: c, credName: cred?.name ?? 'Configured' });
      } else {
        unres.push(c);
        missing.push(getConnectorMeta(c.activeName).label);
      }
    }
    return { resolved: res, unresolved: unres, missingNames: missing };
  }, [requiredConnectors, connectorCredentialMap, credentials]);

  const configuredCount = resolved.length;
  const totalCount = requiredConnectors.length;
  const progressPercent = totalCount > 0 ? (configuredCount / totalCount) * 100 : 0;

  // Find the active inline connector
  const activeInlineConnector = useMemo(
    () => requiredConnectors.find((c) => c.activeName === inlineCredentialConnector),
    [requiredConnectors, inlineCredentialConnector],
  );

  // Pipeline steps (reflecting connector swaps)
  const pipelineSteps = useMemo<ConnectorPipelineStep[]>(() => {
    const sf = ctx.designResult?.service_flow;
    if (!Array.isArray(sf) || sf.length === 0) return [];
    const swaps = ctx.state.connectorSwaps;
    return sf
      .filter((step) => step.connector_name)
      .map((step) => {
        const replacement = swaps[step.connector_name];
        return replacement ? { ...step, connector_name: replacement } : step;
      });
  }, [ctx.designResult, ctx.state.connectorSwaps]);

  // Empty state
  if (requiredConnectors.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Plug className="w-8 h-8 text-muted-foreground/25 mb-3" />
        <p className="text-sm text-muted-foreground/50">
          No connectors needed — you're all set!
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Step header */}
      <div>
        <h3 className="text-base font-semibold text-foreground">Connect Services</h3>
        <p className="text-sm text-muted-foreground/60 mt-0.5">
          Link your credentials to the connectors this template requires.
        </p>
      </div>

      {/* Collapsible pipeline diagram */}
      {pipelineSteps.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowPipeline(!showPipeline)}
            className="text-sm text-muted-foreground/50 hover:text-muted-foreground/70 transition-colors flex items-center gap-1"
          >
            <ChevronDown className={`w-3 h-3 transition-transform ${showPipeline ? '' : '-rotate-90'}`} />
            Service flow
          </button>
          {showPipeline && (
            <div className="mt-2">
              <ConnectorPipeline steps={pipelineSteps} className="justify-center" />
            </div>
          )}
        </div>
      )}

      {/* Progress rail */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground/70">
            {configuredCount} of {totalCount} configured
          </p>
          {missingNames.length > 0 && (
            <span className="text-sm text-amber-400/70">
              Missing: {missingNames.join(', ')}
            </span>
          )}
        </div>
        <div className="h-1 rounded-full bg-secondary/40 overflow-hidden">
          <div
            className="h-full rounded-full bg-emerald-400 transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Unresolved connectors — expanded cards */}
      {unresolved.length > 0 && (
        <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
          {unresolved.map((connector) => (
            <UnresolvedComponentCard
              key={connector.name}
              connector={connector}
              credentials={credentials}
              selectedCredentialId={connectorCredentialMap[connector.activeName]}
              onSetCredential={onSetCredential}
              onClearCredential={onClearCredential}
              onOpenInlineForm={handleOpenInlineForm}
              onOpenDesign={handleOpenDesign}
              onSwapConnector={onSwapConnector!}
            />
          ))}
        </div>
      )}

      {/* Resolved connectors — compact rows */}
      {resolved.length > 0 && (
        <div>
          {unresolved.length > 0 && (
            <p className="text-sm text-muted-foreground/40 mb-1.5">Configured</p>
          )}
          <div className="flex flex-col gap-1">
            {resolved.map(({ connector, credName }) => (
              <ResolvedConnectorRow
                key={connector.name}
                connector={connector}
                credentialName={credName}
              />
            ))}
          </div>
        </div>
      )}

      {/* Inline credential panel */}
      <AnimatePresence initial={false}>
        {activeInlineConnector && (
          <InlineCredentialPanel
            key={`${activeInlineConnector.activeName}-${inlineStartMode}`}
            connectorName={activeInlineConnector.activeName}
            connectorDefinitions={connectorDefinitions}
            credentialFields={activeInlineConnector.credential_fields}
            setupUrl={activeInlineConnector.setup_url}
            setupInstructions={activeInlineConnector.setup_instructions}
            initialMode={inlineStartMode}
            onSetCredential={onSetCredential}
            onCredentialCreated={onCredentialCreated}
            onSaveSuccess={() => {}}
            onClose={() => onSetInlineConnector(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
