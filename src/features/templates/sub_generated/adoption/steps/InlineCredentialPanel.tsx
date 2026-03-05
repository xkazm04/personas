/**
 * InlineCredentialPanel — credential creation panel in ConnectStep.
 *
 * Two top-level methods:
 *   1. Manual Input   — fill in known credential fields yourself
 *   2. Design with AI — CLI analyzes a service and discovers credential fields
 *
 * Auto-Setup (Playwright) is offered *after* Design with AI completes, when
 * the LLM has identified setup procedures for the service.
 *
 * State machine: pick → (design-query → designing →) manual ⇄ auto
 */
import { useState, useMemo, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  Bot,
  PenTool,
  ArrowLeft,
  ExternalLink,
} from 'lucide-react';
import { ConnectorIcon, getConnectorMeta } from '@/features/shared/components/ConnectorMeta';
import { useCredentialDesign, type CredentialDesignResult } from '@/hooks/design/useCredentialDesign';
import { AutoCredPanel } from '@/features/vault/sub_autoCred/AutoCredPanel';
import { CredentialEditForm } from '@/features/vault/sub_forms/CredentialEditForm';
import { useCredentialHealth } from '@/features/vault/hooks/useCredentialHealth';
import { usePersonaStore } from '@/stores/personaStore';
import { AnalyzingPhase } from '@/features/vault/sub_design/AnalyzingPhase';
import type { ConnectorDefinition, CredentialTemplateField } from '@/lib/types/types';
import type { RequiredConnector } from './ConnectStep';
import { MOTION, useTemplateMotion } from '@/features/templates/animationPresets';

// ── Types ──────────────────────────────────────────────────────────────

type PanelMode = 'pick' | 'design-query' | 'designing' | 'manual' | 'auto';

interface InlineCredentialPanelProps {
  connectorName: string;
  connectorDefinitions: ConnectorDefinition[];
  credentialFields?: RequiredConnector['credential_fields'];
  setupUrl?: string;
  setupInstructions?: string;
  /** Start directly in design-query mode (for custom connector flow). */
  initialMode?: 'pick' | 'design-query';
  onSetCredential: (connectorName: string, credentialId: string) => void;
  onCredentialCreated: () => void;
  onSaveSuccess?: (connectorName: string, credentialName: string) => void;
  onClose: () => void;
}

// ── Helpers ────────────────────────────────────────────────────────────

function findConnectorDefinition(
  connectorName: string,
  definitions: ConnectorDefinition[],
): ConnectorDefinition | undefined {
  return definitions.find((d) => d.name === connectorName);
}

/** Build a synthetic CredentialDesignResult from known connector data. */
function buildSyntheticDesignResult(
  connectorName: string,
  connectorDef: ConnectorDefinition | undefined,
  credentialFields?: RequiredConnector['credential_fields'],
  setupInstructions?: string,
): CredentialDesignResult | null {
  const meta = getConnectorMeta(connectorName);

  let fields: CredentialDesignResult['connector']['fields'];

  if (connectorDef?.fields?.length) {
    fields = connectorDef.fields.map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      required: f.required ?? false,
      placeholder: f.placeholder,
      helpText: f.helpText,
    }));
  } else if (credentialFields?.length) {
    fields = credentialFields.map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      required: f.required ?? false,
      placeholder: f.placeholder,
      helpText: f.helpText,
    }));
  } else {
    return null;
  }

  return {
    match_existing: connectorDef ? connectorName : null,
    connector: {
      name: connectorName,
      label: meta.label,
      category: connectorDef?.category ?? 'custom',
      color: connectorDef?.color ?? '#888',
      fields,
      healthcheck_config: connectorDef?.healthcheck_config ?? null,
      services: [],
      events: [],
    },
    setup_instructions: setupInstructions ?? '',
    summary: `${meta.label} credential`,
  };
}

// ── Method Picker ──────────────────────────────────────────────────────

function MethodCard({
  icon,
  label,
  description,
  onClick,
  disabled,
  disabledHint,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
  disabledHint?: string;
  accent?: 'violet';
}) {
  const border = disabled
    ? 'border-primary/8'
    : accent === 'violet'
      ? 'border-violet-500/20 hover:border-violet-500/35'
      : 'border-primary/15 hover:border-primary/25';
  const bg = disabled
    ? 'bg-secondary/10'
    : accent === 'violet'
      ? 'hover:bg-violet-500/5'
      : 'hover:bg-secondary/30';

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`p-3 rounded-lg border ${border} ${bg} text-left transition-all ${MOTION.snappy.css} ${
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
      }`}
      title={disabledHint}
    >
      <div className="mb-1.5">{icon}</div>
      <p className="text-sm font-medium text-foreground/85">{label}</p>
      <p className="text-sm text-muted-foreground/50 mt-0.5 leading-relaxed">{description}</p>
    </button>
  );
}

function MethodPicker({
  hasKnownFields,
  onManual,
  onDesign,
}: {
  hasKnownFields: boolean;
  onManual: () => void;
  onDesign: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="grid grid-cols-2 gap-2"
    >
      <MethodCard
        icon={<PenTool className="w-4 h-4 text-foreground/60" />}
        label="Manual Input"
        description={hasKnownFields ? 'Fill in credential fields' : 'No fields — use Design'}
        onClick={onManual}
        disabled={!hasKnownFields}
        disabledHint={!hasKnownFields ? 'No fields defined — use Design with AI' : undefined}
      />
      <MethodCard
        icon={<Sparkles className="w-4 h-4 text-violet-400" />}
        label="Design with AI"
        description="AI discovers fields, optionally auto-fills"
        onClick={onDesign}
        accent="violet"
      />
    </motion.div>
  );
}

// ── Design Query Input ─────────────────────────────────────────────────

function DesignQueryInput({
  query,
  onQueryChange,
  onStartDesign,
}: {
  query: string;
  onQueryChange: (v: string) => void;
  onStartDesign: () => void;
}) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onStartDesign();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      className="space-y-3"
    >
      <p className="text-sm text-muted-foreground/70">
        Describe the service or connector you need. AI will identify
        credential requirements and offer auto-setup when possible.
      </p>
      <textarea
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="e.g. Zendesk API, Intercom, Freshdesk..."
        rows={2}
        autoFocus
        className="w-full px-3 py-2 bg-secondary/40 border border-primary/15 rounded-xl text-foreground text-sm placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
      />
      <div className="flex justify-end">
        <button
          onClick={onStartDesign}
          disabled={!query.trim()}
          className={`flex items-center gap-1.5 px-4 py-2 bg-primary hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed text-foreground rounded-xl text-sm font-medium transition-all ${MOTION.snappy.css}`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          Design Credential
        </button>
      </div>
    </motion.div>
  );
}

// ── Manual Form ────────────────────────────────────────────────────────

function ManualForm({
  connectorName,
  connectorDef,
  credentialFields,
  setupUrl,
  setupInstructions,
  designResult,
  onSetCredential,
  onCredentialCreated,
  onSaveSuccess,
  onClose,
  onSwitchToAuto,
}: {
  connectorName: string;
  connectorDef: ConnectorDefinition | undefined;
  credentialFields?: RequiredConnector['credential_fields'];
  setupUrl?: string;
  setupInstructions?: string;
  designResult: CredentialDesignResult | null;
  onSetCredential: (connectorName: string, credentialId: string) => void;
  onCredentialCreated: () => void;
  onSaveSuccess?: (connectorName: string, credentialName: string) => void;
  onClose: () => void;
  /** Offered when design result has setup procedures. */
  onSwitchToAuto?: () => void;
}) {
  const meta = getConnectorMeta(connectorName);

  // Resolve fields: prefer design result, then connectorDef, then template metadata
  const inlineFields = useMemo<CredentialTemplateField[]>(() => {
    if (designResult?.connector.fields?.length) {
      return designResult.connector.fields.map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type as CredentialTemplateField['type'],
        placeholder: f.placeholder,
        helpText: f.helpText,
        required: f.required,
      }));
    }
    if (connectorDef?.fields?.length) {
      return connectorDef.fields;
    }
    if (credentialFields?.length) {
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
  }, [designResult, connectorDef, credentialFields]);

  const credentialName = designResult
    ? `${designResult.connector.label} credential`
    : `${meta.label} credential`;

  // Prefer built-in connector definition metadata over AI-generated instructions
  const effectiveSetupUrl =
    (connectorDef?.metadata as Record<string, unknown>)?.docs_url as string | undefined ?? setupUrl;
  const effectiveSetupInstructions = connectorDef
    ? undefined
    : designResult?.setup_instructions || setupInstructions;

  // Connection test
  const health = useCredentialHealth(`connector:${connectorName}`);

  const handleHealthcheck = useCallback(
    async (values: Record<string, string>) => {
      if (designResult) {
        await health.checkDesign(
          `Test connection for ${designResult.connector.label}`,
          designResult.connector as unknown as Record<string, unknown>,
          values,
        );
      } else {
        await health.checkDesign(
          `Test connection for ${meta.label} connector`,
          { name: connectorName, label: meta.label, fields: inlineFields },
          values,
        );
      }
    },
    [connectorName, meta.label, inlineFields, designResult, health.checkDesign],
  );

  const handleSave = useCallback(
    async (values: Record<string, string>) => {
      const store = usePersonaStore.getState();

      // If design result created a new connector definition, create it first
      if (designResult && !designResult.match_existing) {
        const conn = designResult.connector;
        await store.createConnectorDefinition({
          name: conn.name,
          label: conn.label,
          category: conn.category,
          color: conn.color,
          fields: JSON.stringify(conn.fields),
          healthcheck_config: JSON.stringify(conn.healthcheck_config ?? null),
          services: JSON.stringify(conn.services || []),
          events: JSON.stringify(conn.events || []),
          metadata: JSON.stringify({
            template_enabled: true,
            setup_instructions: designResult.setup_instructions,
            summary: designResult.summary,
          }),
          is_builtin: false,
        });
      }

      const serviceType = designResult?.match_existing || designResult?.connector.name || connectorName;
      const credId = await store.createCredential({
        name: credentialName,
        service_type: serviceType,
        data: values,
      });
      if (credId) {
        onCredentialCreated();
        onSetCredential(connectorName, credId);
        onSaveSuccess?.(connectorName, credentialName);
        onClose();
      }
    },
    [connectorName, credentialName, designResult, onCredentialCreated, onSetCredential, onSaveSuccess, onClose],
  );

  // Auto-setup is available when we have a design result with setup procedures
  const canAutoSetup = !!(designResult?.setup_instructions);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
    >
      {/* Auto-Setup offer — shown when design result has setup info */}
      {canAutoSetup && onSwitchToAuto && (
        <button
          onClick={onSwitchToAuto}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 mb-3 rounded-lg border border-cyan-500/20 bg-cyan-500/5 hover:bg-cyan-500/10 transition-colors text-left"
        >
          <Bot className="w-4 h-4 text-cyan-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-cyan-300">Auto-Setup available</p>
            <p className="text-sm text-muted-foreground/50">Let browser automation fill these fields for you</p>
          </div>
        </button>
      )}

      {effectiveSetupUrl && (
        <a
          href={effectiveSetupUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-3 py-2 mb-3 bg-amber-500/10 border border-amber-500/25 rounded-lg text-sm text-foreground/80 hover:bg-amber-500/15 transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5 text-amber-400/70 flex-shrink-0" />
          <span className="flex-1 truncate">Get your credentials</span>
        </a>
      )}

      {effectiveSetupInstructions && (
        <div className="px-3 py-2 mb-3 bg-secondary/40 border border-primary/8 rounded-lg">
          <p className="text-sm text-muted-foreground/70 whitespace-pre-line leading-relaxed">
            {effectiveSetupInstructions}
          </p>
        </div>
      )}

      {inlineFields.length > 0 ? (
        <CredentialEditForm
          fields={inlineFields}
          onSave={handleSave}
          onCancel={onClose}
          onHealthcheck={handleHealthcheck}
          isHealthchecking={health.isHealthchecking}
          healthcheckResult={health.result}
          onValuesChanged={() => health.invalidate()}
          saveDisabled={!health.result?.success}
          saveDisabledReason="Run a successful connection test before saving."
        />
      ) : (
        <div className="text-sm text-muted-foreground/50 text-center py-3">
          No credential fields defined. Try <span className="text-violet-400">Design with AI</span> to discover the required fields.
        </div>
      )}
    </motion.div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────

export function InlineCredentialPanel({
  connectorName,
  connectorDefinitions,
  credentialFields,
  setupUrl,
  setupInstructions,
  initialMode = 'pick',
  onSetCredential,
  onCredentialCreated,
  onSaveSuccess,
  onClose,
}: InlineCredentialPanelProps) {
  const { motion: MOTION } = useTemplateMotion();
  const meta = getConnectorMeta(connectorName);
  const connectorDef = useMemo(
    () => findConnectorDefinition(connectorName, connectorDefinitions),
    [connectorName, connectorDefinitions],
  );

  const [mode, setMode] = useState<PanelMode>(initialMode);
  const [designQuery, setDesignQuery] = useState(meta.label);
  const [activeDesignResult, setActiveDesignResult] = useState<CredentialDesignResult | null>(null);

  const design = useCredentialDesign();
  const fetchCredentials = usePersonaStore((s) => s.fetchCredentials);

  // Synthetic result from known connector fields
  const syntheticResult = useMemo(
    () => buildSyntheticDesignResult(connectorName, connectorDef, credentialFields, setupInstructions),
    [connectorName, connectorDef, credentialFields, setupInstructions],
  );

  const hasKnownFields = !!syntheticResult;

  // When design completes, always go to manual (auto is reached from there)
  useEffect(() => {
    if (mode === 'designing' && design.phase === 'preview' && design.result) {
      setActiveDesignResult(design.result);
      setMode('manual');
    }
  }, [mode, design.phase, design.result]);

  // ── Method handlers ──

  const handlePickManual = useCallback(() => {
    setMode('manual');
  }, []);

  const handlePickDesign = useCallback(() => {
    setMode('design-query');
  }, []);

  const handleStartDesign = useCallback(() => {
    if (!designQuery.trim()) return;
    design.start(designQuery.trim());
    setMode('designing');
  }, [designQuery, design]);

  const handleBack = useCallback(() => {
    if (mode === 'designing') {
      design.cancel();
    }
    design.reset();
    setActiveDesignResult(null);
    setMode(initialMode);
  }, [mode, design, initialMode]);

  // ── Switch to auto-setup from manual form ──

  const handleSwitchToAuto = useCallback(() => {
    if (activeDesignResult) {
      setMode('auto');
    }
  }, [activeDesignResult]);

  // ── Auto-complete handler ──

  const handleAutoComplete = useCallback(() => {
    // Credential already saved by useAutoCredSession — refresh and map
    void fetchCredentials().then(() => {
      const creds = usePersonaStore.getState().credentials;
      const match = creds
        .filter((c) => c.service_type === connectorName)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      if (match) {
        onSetCredential(connectorName, match.id);
        onSaveSuccess?.(connectorName, match.name);
      }
      onCredentialCreated();
      onClose();
    });
  }, [connectorName, fetchCredentials, onSetCredential, onCredentialCreated, onSaveSuccess, onClose]);

  const handleAutoCancel = useCallback(() => {
    // Go back to manual form (not all the way to pick)
    setMode('manual');
  }, []);

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={MOTION.smooth.framer}
      className="overflow-hidden"
    >
      <div className="rounded-xl border border-primary/15 bg-secondary/20 p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {mode !== 'pick' && mode !== initialMode && (
              <button
                onClick={handleBack}
                className="p-1 rounded hover:bg-secondary/50 transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5 text-muted-foreground/60" />
              </button>
            )}
            <ConnectorIcon meta={meta} size="w-4 h-4" />
            <span className="text-sm font-medium text-foreground/80">
              {initialMode === 'design-query' ? 'Custom Connector' : `New ${meta.label} Credential`}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-sm text-muted-foreground/50 hover:text-foreground/70 transition-colors"
          >
            Cancel
          </button>
        </div>

        <AnimatePresence mode="wait">
          {mode === 'pick' && (
            <MethodPicker
              key="pick"
              hasKnownFields={hasKnownFields}
              onManual={handlePickManual}
              onDesign={handlePickDesign}
            />
          )}

          {mode === 'design-query' && (
            <DesignQueryInput
              key="design-query"
              query={designQuery}
              onQueryChange={setDesignQuery}
              onStartDesign={handleStartDesign}
            />
          )}

          {mode === 'designing' && (
            <motion.div
              key="designing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <AnalyzingPhase outputLines={design.outputLines} onCancel={handleBack} />
            </motion.div>
          )}

          {mode === 'manual' && (
            <ManualForm
              key="manual"
              connectorName={connectorName}
              connectorDef={connectorDef}
              credentialFields={credentialFields}
              setupUrl={setupUrl}
              setupInstructions={setupInstructions}
              designResult={activeDesignResult}
              onSetCredential={onSetCredential}
              onCredentialCreated={onCredentialCreated}
              onSaveSuccess={onSaveSuccess}
              onClose={onClose}
              onSwitchToAuto={activeDesignResult ? handleSwitchToAuto : undefined}
            />
          )}

          {mode === 'auto' && activeDesignResult && (
            <motion.div
              key="auto"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <AutoCredPanel
                designResult={activeDesignResult}
                onComplete={handleAutoComplete}
                onCancel={handleAutoCancel}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
