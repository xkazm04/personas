import { useMemo, useCallback } from 'react';
import { Zap, Settings, CheckCircle2, AlertTriangle } from 'lucide-react';
import { DimensionRadial } from '../../shared/DimensionRadial';
import { PersonaMatrix } from '../../gallery/PersonaMatrix';
import type { MatrixEditState, MatrixEditCallbacks } from '../../gallery/EditableMatrixCells';
import { useAdoptionWizard } from '../AdoptionWizardContext';

export function QuickAdoptConfirm() {
  const {
    state,
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
        <button
          onClick={enterFullWizard}
          className="text-sm text-muted-foreground/60 hover:text-foreground/70 transition-colors inline-flex items-center gap-1.5"
        >
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
        </button>
      </div>
    </div>
  );
}
