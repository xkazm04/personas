import { Play, Square, ArrowRight } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import { UseCaseModelDropdown } from './UseCaseModelDropdown';
import { UseCaseChannelDropdown } from './UseCaseChannelDropdown';
import { UseCaseFixtureDropdown } from './UseCaseFixtureDropdown';
import { InputStageSummary, PipelineArrow } from './UseCaseDetailSections';
import { useUseCaseDetail } from '../../libs/useUseCaseDetail';
import { useTranslation } from '@/i18n/useTranslation';

interface UseCaseDetailPanelProps {
  useCaseId: string;
  credentials: CredentialMetadata[];
  connectorDefinitions: ConnectorDefinition[];
}

export function UseCaseDetailPanel({ useCaseId, credentials: _credentials, connectorDefinitions: _connectorDefinitions }: UseCaseDetailPanelProps) {
  const {
    useCase,
    isTestRunning,
    testRunProgress,
    setEditorTab,
    saveError,
    setSaveError,
    selectedFixtureId,
    setSelectedFixtureId,
    fixtures,
    selectedFixture,
    modelConfig,
    canCancel,
    channels,
    hasOverride,
    hasPrompt,
    personaDefaultLabel,
    modelLabel,
    handleRunTest,
    handleCancelTest,
    handleModelSelect,
    handleSaveFixture,
    handleDeleteFixture,
    handleUpdateFixture,
    handleChannelToggle,
  } = useUseCaseDetail(useCaseId);

  const { t } = useTranslation();
  const uc = t.agents.use_cases;

  if (!useCase) {
    return (
      <div className="flex items-center justify-center py-2 text-sm text-foreground">
        {uc.use_case_not_found}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {/* Pipeline: Input -> Transform -> Output + Test actions */}
      <div className="flex items-center gap-0.5">
        {/* Input Sources */}
        <div className="min-w-0 flex-1">
          <InputStageSummary useCase={useCase} />
        </div>

        <PipelineArrow />

        {/* Transform: Model Config */}
        <div className="min-w-0 flex-1">
          <UseCaseModelDropdown
            hasOverride={hasOverride}
            modelLabel={modelLabel}
            personaDefaultLabel={personaDefaultLabel}
            useCase={useCase}
            onSelectModel={handleModelSelect}
          />
        </div>

        <PipelineArrow />

        {/* Output Channels */}
        <div className="min-w-0 flex-1">
          <UseCaseChannelDropdown channels={channels} onToggle={handleChannelToggle} />
        </div>

        {/* Fixture + Test actions */}
        <div className="flex items-center gap-1.5 flex-shrink-0 ml-1.5">
          <UseCaseFixtureDropdown
            fixtures={fixtures}
            selectedFixtureId={selectedFixtureId}
            onSelect={setSelectedFixtureId}
            onSave={handleSaveFixture}
            onDelete={handleDeleteFixture}
            onUpdate={handleUpdateFixture}
            currentInputs={selectedFixture?.inputs ?? useCase.sample_input ?? undefined}
          />
          {isTestRunning ? (
            <button
              onClick={handleCancelTest}
              disabled={!canCancel}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-modal text-sm font-medium bg-red-500/15 border border-red-500/25 text-red-400 hover:bg-red-500/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title={!canCancel ? uc.waiting_for_test : uc.stop_test}
            >
              <Square className="w-3.5 h-3.5" /> {uc.stop}
            </button>
          ) : (
            <button
              onClick={handleRunTest}
              disabled={!hasPrompt || !modelConfig}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-modal text-sm font-medium bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title={!hasPrompt ? uc.no_prompt_configured : uc.test_this_use_case}
            >
              <Play className="w-3.5 h-3.5" /> {uc.test}
            </button>
          )}
          <button
            onClick={() => setEditorTab('lab')}
            className="flex items-center gap-1 text-sm text-foreground hover:text-primary/70 transition-colors"
            title={uc.view_full_test_history_title}
          >
            {uc.tests} <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Pipeline stage labels */}
      <div className="flex items-center gap-0.5 px-1">
        <span className="flex-1 text-center text-sm text-foreground uppercase tracking-wider font-medium">{uc.stage_input}</span>
        <div className="w-3.5 flex-shrink-0" />
        <span className="flex-1 text-center text-sm text-foreground uppercase tracking-wider font-medium">{uc.stage_transform}</span>
        <div className="w-3.5 flex-shrink-0" />
        <span className="flex-1 text-center text-sm text-foreground uppercase tracking-wider font-medium">{uc.stage_output}</span>
        <div className="flex-shrink-0 ml-1.5" style={{ width: 130 }} />
      </div>

      {/* Full-width row: progress indicator and save error */}
      {(isTestRunning && testRunProgress || saveError) && (
        <div className="flex items-center gap-2.5">
          {isTestRunning && testRunProgress && (
            <span className="flex items-center gap-1.5 text-foreground">
              <LoadingSpinner size="sm" className="text-primary" />
              <span className="capitalize text-sm">
                {testRunProgress.phase === 'generating'
                  ? uc.generating
                  : testRunProgress.phase === 'executing'
                    ? uc.testing
                    : testRunProgress.phase}
              </span>
            </span>
          )}
          {saveError && (
            <span
              className="text-sm text-red-400/80 cursor-pointer hover:text-red-400 transition-colors"
              title={saveError}
              onClick={() => setSaveError(null)}
            >
              {uc.save_failed}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
