import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle } from 'lucide-react';
import { useN8nWizard } from './useN8nWizard';
import { N8nStepIndicator } from './N8nStepIndicator';
import { N8nWizardFooter } from './N8nWizardFooter';
import { N8nUploadStep } from './N8nUploadStep';
import { N8nParserResults } from './N8nParserResults';
import { N8nTransformChat } from './N8nTransformChat';
import { N8nEditStep } from './N8nEditStep';
import { N8nConfirmStep } from './N8nConfirmStep';
import { N8nSessionList } from './N8nSessionList';

// ── Slide animation variants ──

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 80 : -80,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -80 : 80,
    opacity: 0,
  }),
};

export default function N8nImportTab() {
  const {
    state,
    dispatch,
    canGoBack,
    goBack,
    handleNext,
    processFile,
    handleTransform,
    handleCancelTransform,
    handleTestDraft,
    handleReset,
    updateDraft,
    currentTransformId,
    isRestoring,
    analyzing,
    confirmResult,
    connectorsMissing,
    setConnectorsMissing,
    fileInputRef,
    direction,
  } = useN8nWizard();

  return (
    <div className="flex flex-col h-full">
      {/* Step indicator — hidden on upload */}
      {state.step !== 'upload' && (
        <div className="px-6 pt-4 pb-1 border-b border-primary/5">
          <N8nStepIndicator currentStep={state.step} processing={analyzing || state.transforming} />
        </div>
      )}

      {/* Error banner — suppress on transform step (errors shown inline in chat) */}
      {state.error && state.step !== 'transform' && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-6 mt-3 flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20"
        >
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-red-400 font-medium">Import Error</p>
            <p className="text-sm text-red-400/70 mt-0.5">{state.error}</p>
          </div>
          <button
            onClick={() => dispatch({ type: 'CLEAR_ERROR' })}
            className="text-red-400/50 hover:text-red-400 text-sm"
          >
            Dismiss
          </button>
        </motion.div>
      )}

      {/* Step content */}
      <div className={`flex-1 min-h-0 ${state.step === 'edit' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={state.step}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className={`p-6 ${state.step === 'edit' ? 'h-full' : ''}`}
          >
            {state.step === 'upload' && (
              <>
                <N8nUploadStep
                  fileInputRef={fileInputRef}
                  onFileDrop={processFile}
                />
                <div className="mt-6">
                  <N8nSessionList
                    onLoadSession={(payload) => {
                      dispatch({ type: 'SESSION_LOADED', payload });
                    }}
                  />
                </div>
              </>
            )}

            {state.step === 'analyze' && state.parsedResult && (
              <N8nParserResults
                parsedResult={state.parsedResult}
                workflowName={state.workflowName}
                onReset={handleReset}
                selectedToolIndices={state.selectedToolIndices}
                selectedTriggerIndices={state.selectedTriggerIndices}
                selectedConnectorNames={state.selectedConnectorNames}
                onToggleTool={(i) => dispatch({ type: 'TOGGLE_TOOL', index: i })}
                onToggleTrigger={(i) => dispatch({ type: 'TOGGLE_TRIGGER', index: i })}
                onToggleConnector={(n) => dispatch({ type: 'TOGGLE_CONNECTOR', name: n })}
                isAnalyzing={analyzing}
                platform={state.platform}
              />
            )}

            {state.step === 'transform' && (
              <N8nTransformChat
                transformSubPhase={state.transformSubPhase}
                questions={state.questions}
                userAnswers={state.userAnswers}
                onAnswerUpdated={(questionId, answer) =>
                  dispatch({ type: 'ANSWER_UPDATED', questionId, answer })
                }
                transformPhase={state.transformPhase}
                transformLines={state.transformLines}
                streamingSections={state.streamingSections}
                runId={currentTransformId}
                isRestoring={isRestoring}
                onRetry={() => void handleTransform()}
                onCancel={() => void handleCancelTransform()}
              />
            )}

            {state.step === 'edit' && state.draft && (
              <N8nEditStep
                draft={state.draft}
                draftJson={state.draftJson}
                draftJsonError={state.draftJsonError}
                parsedResult={state.parsedResult!}
                selectedToolIndices={state.selectedToolIndices}
                selectedTriggerIndices={state.selectedTriggerIndices}
                selectedConnectorNames={state.selectedConnectorNames}
                adjustmentRequest={state.adjustmentRequest}
                transforming={state.transforming}
                disabled={state.transforming || state.confirming || state.created}
                updateDraft={updateDraft}
                onDraftUpdated={(d) => dispatch({ type: 'DRAFT_UPDATED', draft: d })}
                onJsonEdited={(json, draft, error) => dispatch({ type: 'DRAFT_JSON_EDITED', json, draft, error })}
                onAdjustmentChange={(text) => dispatch({ type: 'SET_ADJUSTMENT', text })}
                onApplyAdjustment={() => void handleTransform()}
                onGoToAnalyze={() => dispatch({ type: 'GO_TO_STEP', step: 'analyze' })}
                onConnectorsMissingChange={setConnectorsMissing}
                testPhase={state.testPhase}
                testLines={state.testLines}
                testRunId={state.testRunId}
                onTestUseCase={() => void handleTestDraft()}
                testingUseCaseId={state.testStatus === 'running' ? '__testing__' : null}
              />
            )}

            {state.step === 'confirm' && state.draft && (
              <N8nConfirmStep
                draft={state.draft}
                parsedResult={state.parsedResult!}
                selectedToolIndices={state.selectedToolIndices}
                selectedTriggerIndices={state.selectedTriggerIndices}
                selectedConnectorNames={state.selectedConnectorNames}
                created={state.created}
                confirmResult={confirmResult}
                onReset={handleReset}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Footer navigation */}
      <N8nWizardFooter
        step={state.step}
        canGoBack={canGoBack}
        onBack={goBack}
        onNext={handleNext}
        transforming={state.transforming}
        confirming={state.confirming}
        created={state.created}
        hasDraft={!!state.draft}
        hasParseResult={!!state.parsedResult}
        transformSubPhase={state.transformSubPhase}
        analyzing={analyzing}
        connectorsMissing={connectorsMissing}
        testStatus={state.testStatus}
        testError={state.testError}
        onTest={() => void handleTestDraft()}
        onApplyAdjustment={() => void handleTransform()}
      />
    </div>
  );
}
