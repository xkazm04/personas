import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { ListChecks, ChevronRight, ChevronDown, Clock } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { parseDesignContext } from '@/features/shared/components/UseCasesList';
import type { DesignUseCase as UseCaseItem } from '@/lib/types/frontendTypes';
import { UseCaseRow } from '@/features/shared/components/UseCaseRow';
import { UseCaseHistory } from '@/features/shared/components/UseCaseHistory';
import { UseCaseExecutionPanel } from '@/features/shared/components/UseCaseExecutionPanel';
import { DefaultModelSection } from '@/features/agents/sub_editor/use-cases/DefaultModelSection';
import { UseCaseDetailPanel } from '@/features/agents/sub_editor/use-cases/UseCaseDetailPanel';
import { listExecutions } from '@/api/executions';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import type { PersonaDraft } from '@/features/agents/sub_editor/PersonaDraft';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import { formatRelativeTime, formatDuration, getStatusEntry, badgeClass } from '@/lib/utils/formatters';

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
  const [showGeneralHistory, setShowGeneralHistory] = useState(false);
  const [generalHistory, setGeneralHistory] = useState<PersonaExecution[]>([]);
  const [generalHistoryLoading, setGeneralHistoryLoading] = useState(false);
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

  // Fetch general (unlinked) executions
  const fetchGeneralHistory = useCallback(async () => {
    if (!personaId) return;
    setGeneralHistoryLoading(true);
    try {
      const all = await listExecutions(personaId, 50);
      // Show executions with no use_case_id
      setGeneralHistory(all.filter((e) => !e.use_case_id));
    } catch {
      setGeneralHistory([]);
    } finally {
      setGeneralHistoryLoading(false);
    }
  }, [personaId]);

  useEffect(() => {
    if (showGeneralHistory) {
      fetchGeneralHistory();
    }
  }, [showGeneralHistory, fetchGeneralHistory]);

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
    // Also refresh general history if showing
    if (showGeneralHistory) fetchGeneralHistory();
  }, [showGeneralHistory, fetchGeneralHistory]);

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
      <div className="rounded-xl border border-primary/10 bg-secondary/10 overflow-hidden">
        <button
          onClick={() => setShowGeneralHistory(!showGeneralHistory)}
          className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left hover:bg-secondary/20 transition-colors"
        >
          {showGeneralHistory ? (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/50" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50" />
          )}
          <Clock className="w-3.5 h-3.5 text-muted-foreground/50" />
          <span className="text-sm text-muted-foreground/70">
            General History
            {!showGeneralHistory && generalHistory.length > 0 && (
              <span className="ml-1 text-muted-foreground/40">
                ({generalHistory.length} unlinked execution{generalHistory.length !== 1 ? 's' : ''})
              </span>
            )}
          </span>
        </button>

        {showGeneralHistory && (
          <div className="border-t border-primary/10">
            {generalHistoryLoading ? (
              <div className="px-4 py-3 text-sm text-muted-foreground/50">Loading...</div>
            ) : generalHistory.length === 0 ? (
              <div className="px-4 py-3 text-sm text-muted-foreground/40">
                No unlinked executions found.
              </div>
            ) : (
              <div className="divide-y divide-primary/5 max-h-64 overflow-y-auto">
                {generalHistory.slice(0, 20).map((exec) => {
                  const statusEntry = getStatusEntry(exec.status);
                  return (
                    <div key={exec.id} className="px-4 py-2 flex items-center gap-3">
                      <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded border ${badgeClass(statusEntry)} uppercase`}>
                        {statusEntry.label}
                      </span>
                      <span className="text-sm text-muted-foreground/60 font-mono w-14 flex-shrink-0">
                        {formatDuration(exec.duration_ms)}
                      </span>
                      <span className="text-sm text-muted-foreground/50 flex-1 truncate">
                        {formatRelativeTime(exec.created_at)}
                      </span>
                      {exec.cost_usd > 0 && (
                        <span className="text-sm text-muted-foreground/50 font-mono flex-shrink-0">
                          ${exec.cost_usd.toFixed(4)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

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
