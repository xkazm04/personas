import { useState, useMemo, useCallback, useRef, memo } from 'react';
import { ListChecks, Wrench, ChevronDown, ChevronRight } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { usePersonaStore } from '@/stores/personaStore';
import { parseDesignContext } from '@/features/shared/components/UseCasesList';
import type { DesignUseCase as UseCaseItem } from '@/lib/types/frontendTypes';
import { UseCaseRow } from '@/features/shared/components/UseCaseRow';
import { UseCaseHistory } from '@/features/shared/components/UseCaseHistory';
import { UseCaseExecutionPanel } from '@/features/shared/components/UseCaseExecutionPanel';
import { DefaultModelSection } from '@/features/agents/sub_use_cases/DefaultModelSection';
import { UseCaseDetailPanel } from '@/features/agents/sub_use_cases/UseCaseDetailPanel';
import { UseCaseGeneralHistory } from './UseCaseTabHeader';
import { ToolRunnerPanel } from '@/features/agents/sub_tool_runner/ToolRunnerPanel';
import type { PersonaDraft } from '@/features/agents/sub_editor/PersonaDraft';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import { SectionHeader } from '@/features/shared/components/SectionHeader';
import EmptyState from '@/features/shared/components/EmptyState';
import { LinkedRecipesSection } from '@/features/recipes/sub_list/components/LinkedRecipesSection';
import { ModelABCompare } from '@/features/agents/sub_model_config/ModelABCompare';

const MemoUseCaseRow = memo(UseCaseRow);

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
  const [toolRunnerOpen, setToolRunnerOpen] = useState(false);

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

  const historyExpandedMap = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const id of expandedHistoryIds) map.set(id, true);
    return map;
  }, [expandedHistoryIds]);

  const configExpandedMap = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const id of expandedConfigIds) map.set(id, true);
    return map;
  }, [expandedConfigIds]);

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

      {/* Model A/B Comparison */}
      <ModelABCompare />

      {/* Use Cases Section */}
      {useCases.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="No use cases defined for this persona"
          subtitle="Import from an n8n workflow or use the Design Wizard to generate use cases."
          iconContainerClassName="bg-violet-500/10 border-violet-500/20"
          iconColor="text-violet-400/75"
        />
      ) : (
        <div className="space-y-4">
          {/* Header */}
          <SectionHeader
            icon={<ListChecks className="w-3.5 h-3.5" />}
            label={`${useCases.length} use case${useCases.length !== 1 ? 's' : ''} identified`}
          />

          {/* Use case rows */}
          <div className="space-y-2">
            {useCases.map((uc, i) => (
              <MemoUseCaseRow
                key={uc.id || i}
                useCase={uc}
                index={i}
                isExecuting={isExecuting}
                isActive={isExecuting && selectedUseCaseId === uc.id}
                onExecute={handleExecute}
                onToggleHistory={handleToggleHistory}
                historyExpanded={historyExpandedMap.get(uc.id) === true}
                historyContent={
                  <UseCaseHistory
                    personaId={personaId}
                    useCaseId={uc.id}
                    onRerun={handleRerun}
                    refreshKey={historyRefreshKey}
                  />
                }
                onToggleConfig={handleToggleConfig}
                configExpanded={configExpandedMap.get(uc.id) === true}
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

      {/* Linked Recipes */}
      <LinkedRecipesSection personaId={personaId} />

      {/* Direct Tool Testing */}
      {(selectedPersona?.tools?.length ?? 0) > 0 && (
        <div className="rounded-xl border border-primary/10 bg-secondary/10 overflow-hidden">
          <button
            onClick={() => setToolRunnerOpen(!toolRunnerOpen)}
            aria-expanded={toolRunnerOpen}
            className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left hover:bg-secondary/20 transition-colors focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:outline-none focus-visible:rounded-xl"
          >
            {toolRunnerOpen ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/50" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50" />}
            <Wrench className="w-3.5 h-3.5 text-muted-foreground/80" />
            <span className="text-sm font-medium text-muted-foreground/80">Direct Tool Testing</span>
            <span className="text-sm text-muted-foreground/60">{selectedPersona!.tools!.length} tool{selectedPersona!.tools!.length !== 1 ? 's' : ''}</span>
          </button>
          <AnimatePresence>
            {toolRunnerOpen && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }} className="overflow-hidden">
                <div className="border-t border-primary/10 px-3.5 py-3">
                  <ToolRunnerPanel tools={selectedPersona!.tools!} personaId={personaId} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
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
