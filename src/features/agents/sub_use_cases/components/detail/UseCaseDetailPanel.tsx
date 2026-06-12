import { Play, Square, ArrowRight, Rocket, GitMerge } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { UseCaseModelDropdown } from './UseCaseModelDropdown';
import { UseCaseChannelDropdown } from './UseCaseChannelDropdown';
import { UseCaseFixtureDropdown } from './UseCaseFixtureDropdown';
import { InputStageSummary, PipelineArrow } from './UseCaseDetailSections';
import { useUseCaseDetail } from '../../libs/useUseCaseDetail';
import { useTranslation } from '@/i18n/useTranslation';


interface UseCaseDetailPanelProps {
  useCaseId: string;
}

export function UseCaseDetailPanel({ useCaseId }: UseCaseDetailPanelProps) {
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
    handleManualRun,
    isManualRunning,
    handleModelSelect,
    engineMode,
    handleEngineToggle,
    handleSaveFixture,
    handleDeleteFixture,
    handleUpdateFixture,
    handleChannelToggle,
  } = useUseCaseDetail(useCaseId);

  const { t } = useTranslation();
  const uc = t.agents.use_cases;

  if (!useCase) {
    return (
      <div className="flex items-center justify-center py-2 typo-body text-foreground">
        {uc.use_case_not_found}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {/* Pipeline + stage labels share ONE grid template so the labels always
          track their controls — robust to font scaling, zoom, and longer
          translated labels. (Replaces the old hand-tuned `width: 130` + `w-3.5`
          spacer strip that re-created the row's widths by hand and snapped out
          of alignment.) The three `1fr` columns hold Input / Transform / Output;
          the `auto` columns hold the two arrows and the test-action cluster. */}
      <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr_auto] items-center gap-x-0.5 gap-y-1.5">
        {/* Row 1 — controls (auto-placed left-to-right into columns 1-6) */}
        {/* Input Sources */}
        <div className="min-w-0">
          <InputStageSummary useCase={useCase} />
        </div>

        <PipelineArrow />

        {/* Transform: Model Config + engine mode (mixed = local delegate tool) */}
        <div className="min-w-0 space-y-1">
          <UseCaseModelDropdown
            hasOverride={hasOverride}
            modelLabel={modelLabel}
            personaDefaultLabel={personaDefaultLabel}
            useCase={useCase}
            onSelectModel={handleModelSelect}
          />
          <Tooltip
            content={
              engineMode === 'mixed'
                ? uc.engine_mixed_tooltip
                : engineMode === 'local_first'
                  ? uc.engine_local_first_tooltip
                  : uc.engine_claude_tooltip
            }
          >
            <button
              type="button"
              onClick={handleEngineToggle}
              aria-pressed={engineMode !== 'claude'}
              data-testid="use-case-engine-toggle"
              className={`flex items-center gap-1.5 px-2 py-1 rounded-modal typo-caption font-medium border transition-all w-full ${
                engineMode === 'mixed'
                  ? 'bg-accent/10 border-accent/30 text-accent'
                  : engineMode === 'local_first'
                    ? 'bg-primary/10 border-primary/30 text-primary'
                    : 'bg-background/30 border-primary/10 text-foreground/70 hover:border-primary/20'
              }`}
            >
              <GitMerge className="w-3 h-3 flex-shrink-0" />
              <span className="flex-1 text-left truncate">
                {engineMode === 'mixed'
                  ? uc.engine_mixed
                  : engineMode === 'local_first'
                    ? uc.engine_local_first
                    : uc.engine_claude}
              </span>
            </button>
          </Tooltip>
        </div>

        <PipelineArrow />

        {/* Output Channels */}
        <div className="min-w-0">
          <UseCaseChannelDropdown channels={channels} onToggle={handleChannelToggle} />
        </div>

        {/* Fixture + Test actions */}
        <div className="flex items-center gap-1.5 ml-1.5">
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
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-modal typo-body font-medium bg-red-500/15 border border-red-500/25 text-red-400 hover:bg-red-500/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title={!canCancel ? uc.waiting_for_test : uc.stop_test}
            >
              <Square className="w-3.5 h-3.5" /> {uc.stop}
            </button>
          ) : (
            <button
              onClick={handleRunTest}
              disabled={!hasPrompt || !modelConfig}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-modal typo-body font-medium bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title={!hasPrompt ? uc.no_prompt_configured : uc.test_this_use_case}
            >
              <Play className="w-3.5 h-3.5" /> {uc.test}
            </button>
          )}
          {/* Real-execution trigger — distinct from "Test" because it spawns
              the production runner, fires `emit_event` protocols, and
              cascades into any downstream personas listening on this UC's
              event_subscriptions. Disabled while a test is in progress to
              avoid contention on the lab harness. */}
          <button
            type="button"
            onClick={handleManualRun}
            disabled={!hasPrompt || !modelConfig || isManualRunning || isTestRunning}
            data-testid="use-case-run-now"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-modal typo-body font-medium bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={
              !hasPrompt
                ? uc.no_prompt_configured
                : isManualRunning
                  ? uc.manual_run_in_progress
                  : uc.run_now_tooltip
            }
          >
            <Rocket className="w-3.5 h-3.5" /> {uc.run_now}
          </button>
          <button
            onClick={() => setEditorTab('lab')}
            className="flex items-center gap-1 typo-body text-foreground hover:text-primary/70 transition-colors"
            title={uc.view_full_test_history_title}
          >
            {uc.tests} <ArrowRight className="w-3 h-3" />
          </button>
        </div>

        {/* Row 2 — stage labels, pinned to the same stage columns (1/3/5) so
            they always sit centered under their controls. */}
        <span className="row-start-2 col-start-1 text-center typo-body text-foreground uppercase tracking-wider font-medium">{uc.stage_input}</span>
        <span className="row-start-2 col-start-3 text-center typo-body text-foreground uppercase tracking-wider font-medium">{uc.stage_transform}</span>
        <span className="row-start-2 col-start-5 text-center typo-body text-foreground uppercase tracking-wider font-medium">{uc.stage_output}</span>
      </div>

      {/* Full-width row: progress indicator and save error */}
      {(isTestRunning && testRunProgress || saveError) && (
        <div className="flex items-center gap-2.5">
          {isTestRunning && testRunProgress && (
            <span className="flex items-center gap-1.5 text-foreground">
              <LoadingSpinner size="sm" className="text-primary" />
              <span className="capitalize typo-body">
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
              className="typo-body text-red-400/80 cursor-pointer hover:text-red-400 transition-colors"
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
