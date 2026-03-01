import { useState, useMemo, useCallback, useRef } from 'react';
import { ListChecks } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { parseDesignContext } from '@/features/shared/components/UseCasesList';
import type { DesignUseCase as UseCaseItem } from '@/lib/types/frontendTypes';
import { UseCaseRow } from '@/features/shared/components/UseCaseRow';
import { UseCaseHistory } from '@/features/shared/components/UseCaseHistory';
import { UseCaseExecutionPanel } from '@/features/shared/components/UseCaseExecutionPanel';
import { DefaultModelSection } from '@/features/agents/sub_editor/sub_use_cases/DefaultModelSection';
import { UseCaseDetailPanel } from '@/features/agents/sub_editor/sub_use_cases/UseCaseDetailPanel';
import { UseCaseGeneralHistory } from './UseCaseTabHeader';
import type { PersonaDraft } from '@/features/agents/sub_editor/PersonaDraft';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';

interface PersonaUseCasesTabProps {
  draft: PersonaDraft;
  patch: (updates: Partial<PersonaDraft>) => void;
  modelDirty: boolean;
  credentials: CredentialMetadata[];
  connectorDefinitions: ConnectorDefinition[];
}

export function PersonaUseCasesTab({ draft, patch, modelDirty, credentials, connectorDefinitions }: PersonaUseCasesTabProps) {
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);
  const isExecuting = usePersonaStore((s) => s.isExecuting);

  const [selectedUseCaseId, setSelectedUseCaseId] = useState<string | null>(null);
  const [expandedHistoryIds, setExpandedHistoryIds] = useState<Set<string>>(new Set());
  const [expandedConfigIds, setExpandedConfigIds] = useState<Set<string>>(new Set());
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

  const executionPanelRef = useRef<HTMLDivElement>(null);

  const personaId = selectedPersona?.id ?? '';

  const contextData = useMemo(
    () => parseDesignContext(selectedPersona?.design_context),
    [selectedPersona?.design_context],
  );
  const useCases: UseCaseItem[] = contextData.useCases ?? [];

  const selectedUseCase = useMemo(
    () => useCases.find((uc) => uc.id === selectedUseCaseId) ?? null,
    [useCases, selectedUseCaseId],
  );

  const handleExecute = useCallback((useCaseId: string, _sampleInput?: Record<string, unknown>) => {
    setSelectedUseCaseId(useCaseId);
    // Scroll to execution panel after render
    setTimeout(() => {
      executionPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
  }, []);

  const handleToggleHistory = useCallback((useCaseId: string) => {
    setExpandedHistoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(useCaseId)) {
        next.delete(useCaseId);
      } else {
        next.add(useCaseId);
      }
      return next;
    });
  }, []);

  const handleToggleConfig = useCallback((useCaseId: string) => {
    setExpandedConfigIds((prev) => {
      const next = new Set(prev);
      if (next.has(useCaseId)) {
        next.delete(useCaseId);
      } else {
        next.add(useCaseId);
      }
      return next;
    });
  }, []);

  const handleRerun = useCallback((_inputData: string) => {
    // Re-run opens execution panel; input pre-filled from sample_input
  }, []);

  const handleExecutionFinished = useCallback(() => {
    // Bump refresh key to re-fetch history for the active use case
    setHistoryRefreshKey((k) => k + 1);
  }, []);

  if (!selectedPersona) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground/80">
        No persona selected
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Persona Default Model */}
      <DefaultModelSection draft={draft} patch={patch} modelDirty={modelDirty} />

      {/* Use Cases Section */}
      {useCases.length === 0 ? (
        <div className="text-center py-8 space-y-2">
          <ListChecks className="w-5 h-5 text-muted-foreground/40 mx-auto" />
          <p className="text-sm text-muted-foreground/60">
            No use cases defined for this persona.
          </p>
          <p className="text-sm text-muted-foreground/40">
            Import from an n8n workflow or use the Design Wizard to generate use cases.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center gap-2 px-1">
            <ListChecks className="w-3.5 h-3.5 text-muted-foreground/80" />
            <p className="text-sm text-muted-foreground/80">
              {useCases.length} use case{useCases.length !== 1 ? 's' : ''} identified
            </p>
          </div>

          {/* Use case rows */}
          <div className="space-y-2">
            {useCases.map((uc, i) => (
              <UseCaseRow
                key={uc.id || i}
                useCase={uc}
                index={i}
                isExecuting={isExecuting}
                isActive={isExecuting && selectedUseCaseId === uc.id}
                onExecute={handleExecute}
                onToggleHistory={handleToggleHistory}
                historyExpanded={expandedHistoryIds.has(uc.id)}
                historyContent={
                  <UseCaseHistory
                    personaId={personaId}
                    useCaseId={uc.id}
                    onRerun={handleRerun}
                    refreshKey={historyRefreshKey}
                  />
                }
                onToggleConfig={handleToggleConfig}
                configExpanded={expandedConfigIds.has(uc.id)}
                configContent={
                  <UseCaseDetailPanel
                    useCaseId={uc.id}
                    credentials={credentials}
                    connectorDefinitions={connectorDefinitions}
                  />
                }
              />
            ))}
          </div>
        </div>
      )}

      {/* General History (unlinked executions) */}
      <UseCaseGeneralHistory personaId={personaId} refreshSignal={historyRefreshKey} />

      {/* Execution Panel */}
      {selectedUseCase && (
        <div ref={executionPanelRef}>
          <UseCaseExecutionPanel
            personaId={personaId}
            useCase={selectedUseCase}
            onClose={() => setSelectedUseCaseId(null)}
            onExecutionFinished={handleExecutionFinished}
          />
        </div>
      )}

      {/* Summary */}
      {contextData.summary && (
        <div className="px-1 mt-2">
          <p className="text-sm text-muted-foreground/60 leading-relaxed">
            {contextData.summary}
          </p>
        </div>
      )}
    </div>
  );
}
