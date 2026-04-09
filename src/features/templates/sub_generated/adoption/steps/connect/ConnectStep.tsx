import { useState, useMemo, useCallback, useEffect } from 'react';
import { Plug, ChevronDown, ShieldCheck, RefreshCw } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useTier } from '@/hooks/utility/interaction/useTier';
import { getConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';
import { healthcheckCredential } from '@/api/vault/credentials';
import { ConnectorPipeline } from '../../../shared/ConnectorPipeline';
import { useAdoptionWizard } from '../../AdoptionWizardContext';
import type { ConnectorPipelineStep } from '@/lib/types/designTypes';
import { InlineCredentialPanel } from './InlineCredentialPanel';
import { UnresolvedComponentCard, DatabaseSetupCard } from './ConnectStepCards';

// -- Types --------------------------------------------------------------

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

// -- Helpers --------------------------------------------------------------

const BUILTIN_CONNECTORS = new Set(['personas_messages', 'personas_database', 'personas_vector_db']);

function isVirtual(name: string): boolean {
  return BUILTIN_CONNECTORS.has(name);
}

// -- Main Component -----------------------------------------------------

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

  const { isStarter: isSimple } = useTier();
  const [inlineStartMode, setInlineStartMode] = useState<'pick' | 'design-query'>('pick');
  const [showPipeline, setShowPipeline] = useState(false);
  const [testingAll, setTestingAll] = useState(false);
  const [testAllResults, setTestAllResults] = useState<Record<string, { success: boolean; message: string }>>({});

  // Clear stale test results when credentials or connectors change
  useEffect(() => {
    setTestAllResults({});
  }, [connectorCredentialMap]);

  const handleTestAll = useCallback(async () => {
    setTestingAll(true);
    try {
      const results: Record<string, { success: boolean; message: string }> = {};
      const BUILTIN = new Set(['personas_messages', 'personas_database', 'personas_vector_db']);

      for (const c of requiredConnectors) {
        if (BUILTIN.has(c.activeName)) continue;
        const credId = connectorCredentialMap[c.activeName];
        if (!credId) continue;
        try {
          const result = await healthcheckCredential(credId);
          results[c.activeName] = { success: result.success, message: result.message };
        } catch (err) {
          results[c.activeName] = { success: false, message: err instanceof Error ? err.message : 'Test failed' };
        }
      }
      setTestAllResults(results);
    } finally {
      setTestingAll(false);
    }
  }, [requiredConnectors, connectorCredentialMap]);

  const handleOpenInlineForm = useCallback((name: string) => {
    setInlineStartMode('pick');
    onSetInlineConnector(name);
  }, [onSetInlineConnector]);

  const handleOpenDesign = useCallback((name: string) => {
    setInlineStartMode('design-query');
    onSetInlineConnector(name);
  }, [onSetInlineConnector]);

  // Derive configured count and missing names directly from connectors
  const { configuredCount, missingNames } = useMemo(() => {
    let configured = 0;
    const missing: string[] = [];

    for (const c of requiredConnectors) {
      const builtIn = isVirtual(c.activeName);
      const credId = connectorCredentialMap[c.activeName];
      if (builtIn || credId) {
        configured++;
      } else {
        missing.push(getConnectorMeta(c.activeName).label);
      }
    }
    return { configuredCount: configured, missingNames: missing };
  }, [requiredConnectors, connectorCredentialMap]);
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
        <p className="text-sm text-muted-foreground/80">
          No connectors needed -- you're all set!
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Step header */}
      <div>
        <h3 className="text-base font-semibold text-foreground">Connect Services</h3>
        <p className="text-sm text-muted-foreground/80 mt-0.5">
          Link your credentials to the connectors this template requires.
        </p>
      </div>

      {/* Collapsible pipeline diagram (hidden in simple mode) */}
      {!isSimple && pipelineSteps.length > 0 && (
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowPipeline(!showPipeline)}
            className="text-muted-foreground/80 hover:text-muted-foreground/90 flex items-center gap-1"
          >
            <ChevronDown className={`w-3 h-3 transition-transform ${showPipeline ? '' : '-rotate-90'}`} />
            Service flow
          </Button>
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
          <div className="flex items-center gap-3">
            {configuredCount > 0 && (
              <button
                type="button"
                onClick={() => void handleTestAll()}
                disabled={testingAll}
                className="flex items-center gap-1.5 text-sm text-violet-400/70 hover:text-violet-300 transition-colors disabled:opacity-50"
              >
                {testingAll ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="w-3.5 h-3.5" />
                )}
                {testingAll ? 'Testing...' : 'Test all connections'}
              </button>
            )}
            {missingNames.length > 0 && (
              <span className="text-sm text-amber-400/70">
                Missing: {missingNames.join(', ')}
              </span>
            )}
          </div>
        </div>
        <div className="h-1 rounded-full bg-secondary/40 overflow-hidden">
          <div
            className="h-full rounded-full bg-emerald-400 transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        {/* Test all results summary */}
        {Object.keys(testAllResults).length > 0 && (
          <div className="flex flex-wrap gap-2 mt-1">
            {Object.entries(testAllResults).map(([name, result]) => (
              <span
                key={name}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${
                  result.success
                    ? 'bg-emerald-500/10 text-emerald-400/80 border border-emerald-500/20'
                    : 'bg-red-500/10 text-red-400/80 border border-red-500/20'
                }`}
                title={result.message}
              >
                {result.success ? <ShieldCheck className="w-3 h-3" /> : <RefreshCw className="w-3 h-3" />}
                {getConnectorMeta(name).label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* All connectors -- editable cards */}
      <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {requiredConnectors.map((connector) => (
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

      {/* Database setup (inline when template uses DB connectors) */}
      {ctx.hasDatabaseConnector && <DatabaseSetupCard />}

      {/* Inline credential panel */}
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
    </div>
  );
}
