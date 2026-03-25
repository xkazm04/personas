import { memo } from 'react';
import { ListChecks } from 'lucide-react';
import { UseCaseRow } from '@/features/shared/components/use-cases/UseCaseRow';
import { UseCaseHistory } from '@/features/shared/components/use-cases/UseCaseHistory';
import { UseCaseExecutionPanel } from '@/features/shared/components/use-cases/UseCaseExecutionPanel';
import { DefaultModelSection } from './DefaultModelSection';
import { UseCaseDetailPanel } from '../detail/UseCaseDetailPanel';
import type { PersonaDraft } from '@/features/agents/sub_editor';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import { SectionHeader } from '@/features/shared/components/layout/SectionHeader';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { LinkedRecipesSection } from '@/features/recipes/sub_list/components/LinkedRecipesSection';
import { useUseCasesTab } from '../../libs/useUseCasesTab';

const MemoUseCaseRow = memo(UseCaseRow);

interface PersonaUseCasesTabProps {
  draft: PersonaDraft;
  patch: (updates: Partial<PersonaDraft>) => void;
  modelDirty: boolean;
  credentials: CredentialMetadata[];
  connectorDefinitions: ConnectorDefinition[];
}

export function PersonaUseCasesTab({ draft, patch, modelDirty, credentials, connectorDefinitions }: PersonaUseCasesTabProps) {
  const {
    selectedPersona,
    isExecuting,
    personaId,
    contextData,
    useCases,
    selectedUseCaseId,
    setSelectedUseCaseId,
    selectedUseCase,
    historyExpandedMap,
    configExpandedMap,
    historyRefreshKey,
    executionPanelRef,
    handleExecute,
    handleToggleHistory,
    handleToggleConfig,
    handleRerun,
    handleExecutionFinished,
  } = useUseCasesTab();

  if (!selectedPersona) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground/80">
        No persona selected
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[800px]">
      {/* Persona Default Model */}
      <DefaultModelSection draft={draft} patch={patch} modelDirty={modelDirty} personaId={personaId} />

      {/* Use Cases Section */}
      {useCases.length === 0 ? (
        <EmptyState variant="use-cases-empty" />
      ) : (
        <div className="space-y-4">
          <SectionHeader
            icon={<ListChecks className="w-3.5 h-3.5" />}
            label={`${useCases.length} use case${useCases.length !== 1 ? 's' : ''} identified`}
          />

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
