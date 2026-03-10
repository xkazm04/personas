<<<<<<< HEAD
import { useMemo, useCallback } from 'react';
import { Zap, Settings, CheckCircle2, AlertTriangle } from 'lucide-react';
import { DimensionRadial } from '../../shared/DimensionRadial';
import { PersonaMatrix } from '../../gallery/PersonaMatrix';
import type { MatrixEditState, MatrixEditCallbacks } from '../../gallery/EditableMatrixCells';
=======
import { CheckCircle2, Zap, Settings } from 'lucide-react';
import { ConnectorIcon, getConnectorMeta } from '@/features/shared/components/ConnectorMeta';
import { DimensionRadial } from '../../shared/DimensionRadial';
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
import { useAdoptionWizard } from '../AdoptionWizardContext';

export function QuickAdoptConfirm() {
  const {
    state,
<<<<<<< HEAD
    wizard,
    requiredConnectors,
    liveCredentials,
    designResult,
    useCaseFlows,
    quickAdopt,
    enterFullWizard,
    setConnectorCredential,
  } = useAdoptionWizard();

  // ── Credential match summary ──

  const matchSummary = useMemo(() => {
    const BUILTIN = new Set(['personas_messages', 'personas_database']);
    const external = requiredConnectors.filter((rc) => !BUILTIN.has(rc.activeName));
    const matched = external.filter((rc) => !!state.connectorCredentialMap[rc.activeName]);
    return { total: external.length, matched: matched.length, allMatched: matched.length >= external.length };
  }, [requiredConnectors, state.connectorCredentialMap]);

  // ── Edit state bridged from wizard state ──

  const editState = useMemo<MatrixEditState>(() => ({
    connectorCredentialMap: state.connectorCredentialMap,
    connectorSwaps: state.connectorSwaps,
    triggerConfigs: state.triggerConfigs,
    requireApproval: state.requireApproval,
    memoryEnabled: state.memoryEnabled,
  }), [state.connectorCredentialMap, state.connectorSwaps, state.triggerConfigs, state.requireApproval, state.memoryEnabled]);

  const editCallbacks = useMemo<MatrixEditCallbacks>(() => ({
    onCredentialSelect: (connectorName: string, credentialId: string) => {
      setConnectorCredential(connectorName, credentialId);
    },
    onConnectorSwap: (originalName: string, replacementName: string) => {
      wizard.swapConnector(originalName, replacementName);
    },
    onTriggerConfigChange: (index: number, config: Record<string, string>) => {
      wizard.updateTriggerConfig(index, config);
    },
    onToggleApproval: (value: boolean) => {
      wizard.updatePreference('requireApproval', value);
    },
    onToggleMemory: (value: boolean) => {
      wizard.updatePreference('memoryEnabled', value);
    },
  }), [setConnectorCredential, wizard]);

  const handleQuickAdopt = useCallback(() => {
    quickAdopt();
  }, [quickAdopt]);

  return (
    <div className="flex flex-col gap-5 px-6 py-6 max-w-[720px] mx-auto w-full">
      {/* Header */}
      <div className="flex items-center gap-4">
        <DimensionRadial designResult={designResult} size={44} />
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-foreground/90 truncate">
            {state.templateName}
          </h2>
          <div className="flex items-center gap-2 mt-0.5">
            {matchSummary.allMatched ? (
              <span className="text-sm text-emerald-400/80 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                All connectors matched
              </span>
            ) : (
              <span className="text-sm text-amber-400/80 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {matchSummary.matched}/{matchSummary.total} connectors linked
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Editable matrix — the core of the one-window quick adopt experience */}
      <PersonaMatrix
        designResult={designResult}
        flows={useCaseFlows}
        mode="edit"
        hideHeader
        editState={editState}
        editCallbacks={editCallbacks}
        requiredConnectors={requiredConnectors}
        credentials={liveCredentials}
      />

      {/* Actions */}
      <div className="flex items-center justify-between pt-1 border-t border-primary/10">
=======
    requiredConnectors,
    liveCredentials,
    designResult,
    quickAdopt,
    enterFullWizard,
  } = useAdoptionWizard();

  const matchedConnectors = requiredConnectors.map((rc) => {
    const credId = state.connectorCredentialMap[rc.activeName];
    const cred = liveCredentials.find((c) => c.id === credId);
    const meta = getConnectorMeta(rc.activeName);
    return { rc, cred, meta };
  });

  return (
    <div className="flex flex-col items-center gap-6 px-8 py-10">
      {/* Header */}
      <div className="flex items-center gap-4">
        <DimensionRadial designResult={designResult} size={48} />
        <div>
          <h2 className="text-lg font-semibold text-foreground/90">
            {state.templateName}
          </h2>
          <p className="text-sm text-emerald-400/80 flex items-center gap-1.5 mt-0.5">
            <CheckCircle2 className="w-3.5 h-3.5" />
            All connectors matched
          </p>
        </div>
      </div>

      {/* Matched connectors */}
      {matchedConnectors.length > 0 && (
        <div className="w-full max-w-sm space-y-2">
          {matchedConnectors.map(({ rc, cred, meta }) => (
            <div
              key={rc.activeName}
              className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl bg-emerald-500/5 border border-emerald-500/15"
            >
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: `${meta.color}18` }}
              >
                <ConnectorIcon meta={meta} size="w-4.5 h-4.5" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium text-foreground/80 block truncate">
                  {meta.label}
                </span>
                <span className="text-sm text-muted-foreground/60 block truncate">
                  {cred?.name ?? 'Matched credential'}
                </span>
              </div>
              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col items-center gap-3 mt-2">
        <button
          onClick={quickAdopt}
          disabled={state.transforming || state.confirming}
          className="px-6 py-3 text-sm font-medium rounded-xl bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
        >
          <Zap className="w-4 h-4" />
          Quick Adopt
        </button>
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
        <button
          onClick={enterFullWizard}
          className="text-sm text-muted-foreground/60 hover:text-foreground/70 transition-colors inline-flex items-center gap-1.5"
        >
<<<<<<< HEAD
          <Settings className="w-3.5 h-3.5" />
          Full wizard
        </button>
        <button
          onClick={handleQuickAdopt}
          disabled={state.transforming || state.confirming || !matchSummary.allMatched}
          className="px-5 py-2.5 text-sm font-medium rounded-xl bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
        >
          <Zap className="w-4 h-4" />
          Quick Adopt
=======
          <Settings className="w-3 h-3" />
          Customize in full wizard
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
        </button>
      </div>
    </div>
  );
}
