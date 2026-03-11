import { Play, Square, Loader2, ArrowRight } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import { UseCaseModelDropdown } from './UseCaseModelDropdown';
import { UseCaseChannelDropdown } from './UseCaseChannelDropdown';
import { UseCaseFixtureDropdown } from './UseCaseFixtureDropdown';
import { PipelineArrow, InputStageSummary } from './InputStageSummary';
import { useUseCaseHandlers } from './useUseCaseHandlers';

interface UseCaseDetailPanelProps {
  useCaseId: string;
  credentials: CredentialMetadata[];
  connectorDefinitions: ConnectorDefinition[];
}

export function UseCaseDetailPanel({ useCaseId, credentials: _credentials, connectorDefinitions: _connectorDefinitions }: UseCaseDetailPanelProps) {
  const {
    isTestRunning,
    testRunProgress,
    setEditorTab,
    useCase,
    saveError,
    setSaveError,
    selectedFixtureId,
    setSelectedFixtureId,
    fixtures,
    selectedFixture,
    modelConfig,
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
  } = useUseCaseHandlers(useCaseId);

  if (!useCase) {
    return (
      <div className="flex items-center justify-center py-2 text-sm text-muted-foreground/60">
        Use case not found.
      </div>
    );
  }

  const canCancel = !!testRunProgress?.runId;
  const channels = useCase.notification_channels ?? [];

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
            <Button
              onClick={handleCancelTest}
              disabled={!canCancel}
              variant="danger"
              size="sm"
              icon={<Square className="w-3.5 h-3.5" />}
              title={!canCancel ? 'Waiting for test to start...' : 'Stop test'}
            >
              Stop
            </Button>
          ) : (
            <Button
              onClick={handleRunTest}
              disabled={!hasPrompt || !modelConfig}
              variant="primary"
              size="sm"
              icon={<Play className="w-3.5 h-3.5" />}
              title={!hasPrompt ? 'No prompt configured' : 'Test this use case'}
            >
              Test
            </Button>
          )}
          <Button
            onClick={() => setEditorTab('lab')}
            variant="link"
            size="sm"
            className="text-muted-foreground/40 hover:text-primary/70"
            title="View full test history"
          >
            Tests <ArrowRight className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* Pipeline stage labels */}
      <div className="flex items-center gap-0.5 px-1">
        <span className="flex-1 text-center text-sm text-muted-foreground/35 uppercase tracking-wider font-medium">Input</span>
        <div className="w-3.5 flex-shrink-0" />
        <span className="flex-1 text-center text-sm text-muted-foreground/35 uppercase tracking-wider font-medium">Transform</span>
        <div className="w-3.5 flex-shrink-0" />
        <span className="flex-1 text-center text-sm text-muted-foreground/35 uppercase tracking-wider font-medium">Output</span>
        {/* Spacer matching the test actions width */}
        <div className="flex-shrink-0 ml-1.5" style={{ width: 130 }} />
      </div>

      {/* Full-width row: progress indicator and save error */}
      {(isTestRunning && testRunProgress || saveError) && (
        <div className="flex items-center gap-2.5">
          {isTestRunning && testRunProgress && (
            <span className="flex items-center gap-1.5 text-muted-foreground/60">
              <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
              <span className="capitalize text-sm">
                {testRunProgress.phase === 'generating'
                  ? 'Generating...'
                  : testRunProgress.phase === 'executing'
                    ? 'Testing...'
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
              Save failed
            </span>
          )}
        </div>
      )}
    </div>
  );
}
