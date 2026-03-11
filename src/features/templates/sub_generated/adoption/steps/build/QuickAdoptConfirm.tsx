import { useMemo, useCallback, useState } from 'react';
import { Settings, CheckCircle2, AlertTriangle, ExternalLink } from 'lucide-react';
import { DimensionRadial } from '../../../shared/DimensionRadial';
import { PersonaMatrix } from '../../../gallery/matrix/PersonaMatrix';
import type { MatrixEditState, MatrixEditCallbacks } from '../../../gallery/matrix/EditableMatrixCells';
import { getConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';
import { usePersonaStore } from '@/stores/personaStore';
import { useAdoptionWizard } from '../../AdoptionWizardContext';

const BUILTIN = new Set(['personas_messages', 'personas_database']);

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

  const setSidebarSection = usePersonaStore((s) => s.setSidebarSection);

  const matchSummary = useMemo(() => {
    const external = requiredConnectors.filter((rc) => !BUILTIN.has(rc.activeName));
    const matched = external.filter((rc) => !!state.connectorCredentialMap[rc.activeName]);
    const missing = external
      .filter((rc) => !liveCredentials.some((c) => c.service_type === rc.activeName))
      .map((rc) => rc.activeName);
    const missingUnique = [...new Set(missing)];
    return {
      total: external.length,
      matched: matched.length,
      allMatched: matched.length >= external.length,
      missingConnectorTypes: missingUnique,
    };
  }, [requiredConnectors, state.connectorCredentialMap, liveCredentials]);

  const [messagePreset, setMessagePreset] = useState('updates');

  const editState = useMemo<MatrixEditState>(() => ({
    connectorCredentialMap: state.connectorCredentialMap,
    connectorSwaps: state.connectorSwaps,
    triggerConfigs: state.triggerConfigs,
    requireApproval: state.requireApproval,
    autoApproveSeverity: state.autoApproveSeverity,
    reviewTimeout: state.reviewTimeout,
    memoryEnabled: state.memoryEnabled,
    memoryScope: state.memoryScope,
    messagePreset,
    databaseMode: state.databaseMode,
    databaseTable: state.databaseTable,
    databaseSchema: state.databaseSchema,
  }), [state.connectorCredentialMap, state.connectorSwaps, state.triggerConfigs, state.requireApproval, state.autoApproveSeverity, state.reviewTimeout, state.memoryEnabled, state.memoryScope, messagePreset, state.databaseMode, state.databaseTable, state.databaseSchema]);

  const editCallbacks = useMemo<MatrixEditCallbacks>(() => ({
    onCredentialSelect: (connectorName: string, credentialId: string) => { setConnectorCredential(connectorName, credentialId); },
    onConnectorSwap: (originalName: string, replacementName: string) => { wizard.swapConnector(originalName, replacementName); },
    onTriggerConfigChange: (index: number, config: Record<string, string>) => { wizard.updateTriggerConfig(index, config); },
    onToggleApproval: (value: boolean) => { wizard.updatePreference('requireApproval', value); },
    onToggleMemory: (value: boolean) => { wizard.updatePreference('memoryEnabled', value); },
    onPreferenceChange: (key: string, value: unknown) => {
      if (key === 'messagePreset') { setMessagePreset(value as string); }
      else if (key === 'databaseMode') { wizard.setDatabaseMode(value as 'create' | 'existing'); }
      else { wizard.updatePreference(key, value); }
    },
  }), [setConnectorCredential, wizard]);

  const handleQuickAdopt = useCallback(() => { quickAdopt(); }, [quickAdopt]);
  const handleNavigateCatalog = useCallback(() => { setSidebarSection('credentials'); }, [setSidebarSection]);
  const hasMissing = matchSummary.missingConnectorTypes.length > 0;

  return (
    <div className="flex flex-col gap-4 px-6 py-5 w-full h-full">
      {/* Centered header with connector status */}
      <div className="flex flex-col items-center gap-2 text-center">
        <DimensionRadial designResult={designResult} size={44} />
        <h2 className="text-base font-semibold text-foreground/90 truncate max-w-full">{state.templateName}</h2>
        <div className="flex items-center gap-1.5">
          {matchSummary.allMatched ? (
            <span className="text-sm text-emerald-400/80 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />All connectors matched</span>
          ) : (
            <span className="text-sm text-amber-400/80 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{matchSummary.matched}/{matchSummary.total} connectors linked</span>
          )}
        </div>
        {hasMissing && (
          <p className="text-[12px] text-muted-foreground/50 leading-snug">
            {'Missing: '}
            {matchSummary.missingConnectorTypes.map((t, i) => (
              <span key={t}>{i > 0 && ', '}{getConnectorMeta(t).label}</span>
            ))}
            {' — '}
            <button type="button" onClick={handleNavigateCatalog} className="text-primary/70 hover:text-primary transition-colors inline-flex items-center gap-0.5">
              add in Keys Catalog<ExternalLink className="w-2.5 h-2.5" />
            </button>
          </p>
        )}
      </div>

      {/* Matrix */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <PersonaMatrix
          designResult={designResult}
          flows={useCaseFlows}
          mode="edit"
          hideHeader
          editState={editState}
          editCallbacks={editCallbacks}
          requiredConnectors={requiredConnectors}
          credentials={liveCredentials}
          onLaunch={handleQuickAdopt}
          launchDisabled={state.transforming || state.confirming || !matchSummary.allMatched}
          launchLabel="Build Persona"
          isRunning={state.transforming}
          onNavigateCatalog={handleNavigateCatalog}
        />
      </div>

      {/* Footer */}
      <div className="flex items-center pt-1 border-t border-primary/10 flex-shrink-0">
        <button onClick={enterFullWizard} className="text-sm text-muted-foreground/60 hover:text-foreground/70 transition-colors inline-flex items-center gap-1.5">
          <Settings className="w-3.5 h-3.5" />Full wizard
        </button>
      </div>
    </div>
  );
}
