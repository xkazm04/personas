import { useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useN8nWizard } from '../hooks/useN8nWizard';
import { N8nStepIndicator } from '../widgets/N8nStepIndicator';
import { N8nWizardFooter } from '../widgets/N8nWizardFooter';
import { N8nUploadStep } from './upload/N8nUploadStep';
import { N8nParserResults } from './N8nParserResults';
import { N8nSessionList } from './N8nSessionList';
import { useAgentStore } from "@/stores/agentStore";
import { useSystemStore } from "@/stores/systemStore";

// -- Slide animation variants --

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
    processContent,
    handleReset,
    analyzing,
    connectorsMissing,
    fileInputRef,
    direction,
  } = useN8nWizard();

  const setWorkflowImport = useAgentStore((s) => s.setWorkflowImport);
  const setIsCreatingPersona = useSystemStore((s) => s.setIsCreatingPersona);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);

  const setN8nTransformActive = useSystemStore((s) => s.setN8nTransformActive);

  /** Send the parsed workflow to the PersonaMatrix for building. */
  const handleProcessWithMatrix = useCallback(() => {
    if (!state.parsedResult || !state.rawWorkflowJson) return;

    // Store workflow data in the matrix build slice
    setWorkflowImport({
      workflowJson: state.rawWorkflowJson,
      parserResultJson: JSON.stringify(state.parsedResult),
      name: state.workflowName || 'Imported Workflow',
      platform: state.platform || 'unknown',
    });

    // Register process activity so the activity drawer tracks this build
    try {
      void import("@/stores/overviewStore").then(({ useOverviewStore }) => {
        useOverviewStore.getState().processStarted(
          'n8n_build',
          undefined,
          `Build Persona: ${state.workflowName || 'Imported Workflow'}`,
          { section: 'personas' },
        );
      });
    } catch { /* best-effort */ }

    // Show progress dot on design-reviews sidebar
    setN8nTransformActive(true);

    // Navigate to personas page in creation mode — the matrix will pick up the workflow
    setSidebarSection('personas');
    setIsCreatingPersona(true);
  }, [state.parsedResult, state.rawWorkflowJson, state.workflowName, state.platform, setWorkflowImport, setSidebarSection, setIsCreatingPersona, setN8nTransformActive]);

  return (
    <div className="flex flex-col h-full">
      {/* Step indicator -- hidden on upload */}
      {state.step !== 'upload' && (
        <div className="px-6 pt-4 pb-1 border-b border-primary/5">
          <N8nStepIndicator currentStep={state.step} processing={analyzing || state.transforming} />
        </div>
      )}

      {/* Error banner -- suppress on transform step (errors shown inline in chat) */}
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
          <Button
            onClick={() => dispatch({ type: 'CLEAR_ERROR' })}
            variant="ghost"
            size="xs"
            className="text-red-400/50 hover:text-red-400"
          >
            Dismiss
          </Button>
        </motion.div>
      )}

      {state.sessionWarning && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-6 mt-3 flex items-start gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20"
          aria-live="polite"
        >
          <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-amber-300 font-medium">Partial Session Restore</p>
            <p className="text-sm text-amber-200/90 mt-0.5">{state.sessionWarning}</p>
          </div>
          <Button
            onClick={() => dispatch({ type: 'CLEAR_SESSION_WARNING' })}
            variant="ghost"
            size="xs"
            className="text-amber-300/70 hover:text-amber-200"
          >
            Dismiss
          </Button>
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
                  onContentPaste={processContent}
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
              <>
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
                  platformNeedsConfirmation={state.platformNeedsConfirmation}
                  onConfirmPlatform={() => dispatch({ type: 'CONFIRM_PLATFORM' })}
                />
              </>
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
        analyzing={analyzing}
        connectorsMissing={connectorsMissing}
        onProcessWithMatrix={handleProcessWithMatrix}
      />
    </div>
  );
}
