import { memo, useCallback, useState } from 'react';
import { ListChecks, List, LayoutGrid, Columns } from 'lucide-react';
import { UseCaseRow } from '@/features/shared/components/use-cases/UseCaseRow';
import { UseCaseHistory } from '@/features/shared/components/use-cases/UseCaseHistory';
import { UseCaseExecutionPanel } from '@/features/shared/components/use-cases/UseCaseExecutionPanel';
import { DefaultModelSection } from './DefaultModelSection';
import { CapabilityDisableDialog } from './CapabilityDisableDialog';
import { PersonaUseCasesTabGrid } from './PersonaUseCasesTabGrid';
import { PersonaUseCasesTabSplit } from './PersonaUseCasesTabSplit';
import { UseCaseDetailPanel } from '../detail/UseCaseDetailPanel';
import type { PersonaDraft } from '@/features/agents/sub_editor';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import { SectionHeader } from '@/features/shared/components/layout/SectionHeader';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { LinkedRecipesSection } from '@/features/recipes/sub_list/components/LinkedRecipesSection';
import { useUseCasesTab } from '../../libs/useUseCasesTab';
import { useCapabilityToggle } from '../../libs/useCapabilityToggle';
import { useTranslation } from '@/i18n/useTranslation';

type UseCaseView = 'list' | 'grid' | 'split';
const VIEW_STORAGE_KEY = 'persona-use-cases-view';
const VIEW_VARIANTS: { key: UseCaseView; label: string; icon: typeof List }[] = [
  { key: 'list',  label: 'List',  icon: List },
  { key: 'grid',  label: 'Grid',  icon: LayoutGrid },
  { key: 'split', label: 'Split', icon: Columns },
];

function readInitialView(): UseCaseView {
  try {
    const v = localStorage.getItem(VIEW_STORAGE_KEY);
    if (v === 'grid' || v === 'split' || v === 'list') return v;
  } catch { /* SSR / denied */ }
  return 'list';
}

const MemoUseCaseRow = memo(UseCaseRow);

interface PersonaUseCasesTabProps {
  draft: PersonaDraft;
  patch: (updates: Partial<PersonaDraft>) => void;
  modelDirty: boolean;
  credentials: CredentialMetadata[];
  connectorDefinitions: ConnectorDefinition[];
}

export function PersonaUseCasesTab(props: PersonaUseCasesTabProps) {
  const [view, setView] = useState<UseCaseView>(readInitialView);
  const changeView = useCallback((next: UseCaseView) => {
    setView(next);
    try { localStorage.setItem(VIEW_STORAGE_KEY, next); } catch { /* ignore */ }
  }, []);

  const ViewSwitcher = (
    <div className="flex items-center gap-1 rounded-card border border-primary/10 bg-secondary/30 p-1">
      {VIEW_VARIANTS.map((v) => {
        const Icon = v.icon;
        const active = view === v.key;
        return (
          <button
            key={v.key}
            onClick={() => changeView(v.key)}
            data-testid={`use-cases-view-${v.key}`}
            className={`flex items-center gap-1.5 rounded-card px-2.5 py-1 typo-caption transition-colors ${
              active
                ? 'bg-primary/15 text-primary'
                : 'text-foreground/70 hover:text-foreground hover:bg-primary/5'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {v.label}
          </button>
        );
      })}
    </div>
  );

  if (view === 'grid') {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-end px-1 pb-2">{ViewSwitcher}</div>
        <PersonaUseCasesTabGrid {...props} />
      </div>
    );
  }
  if (view === 'split') {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-end px-1 pb-2">{ViewSwitcher}</div>
        <PersonaUseCasesTabSplit {...props} />
      </div>
    );
  }
  return <PersonaUseCasesTabListView {...props} viewSwitcher={ViewSwitcher} />;
}

function PersonaUseCasesTabListView({
  draft, patch, modelDirty, credentials, connectorDefinitions,
  viewSwitcher,
}: PersonaUseCasesTabProps & { viewSwitcher: React.ReactNode }) {
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

  const {
    pendingUseCaseId,
    disableConfirmation,
    requestToggle,
    confirmDisable,
    cancelDisable,
    requestSimulate,
  } = useCapabilityToggle();

  const handleToggleEnabled = useCallback(
    (useCaseId: string, enabled: boolean) => {
      if (!personaId) return;
      const uc = useCases.find((c) => c.id === useCaseId);
      requestToggle(personaId, useCaseId, uc?.title ?? useCaseId, enabled);
    },
    [personaId, useCases, requestToggle],
  );

  const handleSimulate = useCallback(
    (useCaseId: string) => {
      if (!personaId) return;
      requestSimulate(personaId, useCaseId);
    },
    [personaId, requestSimulate],
  );

  const handleConfirmDisable = useCallback(() => {
    if (!personaId) return;
    confirmDisable(personaId);
  }, [personaId, confirmDisable]);

  const { t } = useTranslation();

  if (!selectedPersona) {
    return (
      <div className="flex items-center justify-center py-8 text-foreground">
        {t.agents.use_cases.no_persona_selected}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[800px]">
      <div className="flex items-center justify-end">{viewSwitcher}</div>
      {/* Persona Default Model */}
      <DefaultModelSection draft={draft} patch={patch} modelDirty={modelDirty} personaId={personaId} />

      {/* Use Cases Section */}
      {useCases.length === 0 ? (
        <EmptyState variant="use-cases-empty" />
      ) : (
        <div className="space-y-4">
          <SectionHeader
            icon={<ListChecks className="w-5 h-5" />}
            label={useCases.length === 1
              ? t.agents.use_cases.use_cases_identified.replace('{count}', String(useCases.length))
              : t.agents.use_cases.use_cases_identified_other.replace('{count}', String(useCases.length))}
            prominent
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
                onToggleEnabled={handleToggleEnabled}
                onSimulate={handleSimulate}
                toggling={pendingUseCaseId === uc.id}
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
          <p className="typo-body text-foreground leading-relaxed">
            {contextData.summary}
          </p>
        </div>
      )}

      {/* Disable-capability confirmation (Phase C3) */}
      {disableConfirmation && (
        <CapabilityDisableDialog
          state={disableConfirmation}
          onConfirm={handleConfirmDisable}
          onCancel={cancelDisable}
        />
      )}
    </div>
  );
}
