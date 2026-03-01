import { useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  AlertCircle,
  Download,
  Check,
  RefreshCw,
  ListChecks,
  Plug,
  Sliders,
  Hammer,
  CirclePlus,
} from 'lucide-react';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import { TransformProgress } from '@/features/shared/components/TransformProgress';
import { DimensionRadial } from './DimensionRadial';
import {
  WizardSidebar,
  ChooseStep,
  ConnectStep,
  TuneStep,
  CreateStep,
} from './steps';
import type { WizardSidebarStep } from './steps';
import type { AdoptWizardStep } from './useAdoptReducer';
import {
  AdoptionWizardProvider,
  useAdoptionWizard,
} from './AdoptionWizardContext';

// ── Types ──

interface AdoptionWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  review: PersonaDesignReview | null;
  credentials: CredentialMetadata[];
  connectorDefinitions: ConnectorDefinition[];
  onPersonaCreated: () => void;
}

// ── Sidebar step config ────────────────────────────────────────────────

const SIDEBAR_STEPS: WizardSidebarStep[] = [
  { key: 'choose',  label: 'Choose',  Icon: ListChecks },
  { key: 'connect', label: 'Connect', Icon: Plug },
  { key: 'tune',    label: 'Tune',    Icon: Sliders },
  { key: 'build',   label: 'Build',   Icon: Hammer },
  { key: 'create',  label: 'Create',  Icon: CirclePlus },
];

// ── Step content map ───────────────────────────────────────────────────
// Replaces the large inline switch with a declarative component map.

const STEP_COMPONENTS: Record<AdoptWizardStep, React.ComponentType> = {
  choose: ChooseStep,
  connect: ConnectStep,
  tune: TuneStep,
  build: BuildStep,
  create: CreateStep,
};

// ── Build step (inline — needs transform progress) ─────────────────────

function BuildStep() {
  const { state, wizard, currentAdoptId, isRestoring, startTransform, cancelTransform } = useAdoptionWizard();

  return (
    <div className="space-y-4">
      <TransformProgress
        phase={state.transformPhase}
        lines={state.transformLines}
        runId={currentAdoptId}
        isRestoring={isRestoring}
        onRetry={() => void startTransform()}
        onCancel={() => void cancelTransform()}
      />

      {state.transforming && (
        <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-blue-500/5 border border-blue-500/10">
          <Sparkles className="w-4 h-4 text-blue-400/60 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-blue-300/60 leading-relaxed">
            You can close this dialog — processing will continue in the background.
            Re-open the wizard to check progress.
          </p>
        </div>
      )}

      {state.draft && !state.transforming && (
        <div className="space-y-2">
          <label className="text-sm font-semibold text-muted-foreground/80 uppercase tracking-wider">
            Request adjustments (optional)
          </label>
          <textarea
            value={state.adjustmentRequest}
            onChange={(e) => wizard.setAdjustment(e.target.value)}
            placeholder="Example: Change the schedule to run at 9 AM, remove ClickUp integration, add Slack notifications"
            className="w-full h-20 p-3 rounded-xl border border-primary/15 bg-background/40 text-sm text-foreground/75 resize-y placeholder-muted-foreground/30"
          />
        </div>
      )}
    </div>
  );
}

// ── Back button ────────────────────────────────────────────────────────

function BackButton({
  state,
  onClose,
  onBack,
  getBackLabel,
}: {
  state: { step: string; confirming: boolean; created: boolean; transforming: boolean; questionGenerating: boolean };
  onClose: () => void;
  onBack: () => void;
  getBackLabel: () => string;
}) {
  const { cancelTransform } = useAdoptionWizard();

  return (
    <button
      onClick={() => {
        if (state.step === 'choose') onClose();
        else if (state.step === 'tune' && state.questionGenerating) return;
        else if (state.step === 'build' && state.transforming) void cancelTransform();
        else onBack();
      }}
      disabled={state.confirming || state.created || (state.step === 'tune' && state.questionGenerating)}
      className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl border border-primary/15 text-muted-foreground/80 hover:bg-secondary/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
    >
      <ArrowLeft className="w-3.5 h-3.5" />
      {getBackLabel()}
    </button>
  );
}

// ── Inner modal (consumes context) ─────────────────────────────────────

function AdoptionWizardInner({ onClose }: { onClose: () => void }) {
  const {
    state,
    wizard,
    designResult,
    completedSteps,
    requiredConnectors,
    handleNext,
    cleanupAll,
  } = useAdoptionWizard();

  const backdropRef = useRef<HTMLDivElement>(null);

  // ── Close handler ──

  const handleClose = useCallback(() => {
    if (state.confirming) return;

    if (state.created || !state.transforming) {
      void cleanupAll();
      wizard.reset();
    }
    onClose();
  }, [state.confirming, state.created, state.transforming, cleanupAll, wizard, onClose]);

  // ── Sidebar step click ──

  const handleSidebarStepClick = useCallback(
    (step: AdoptWizardStep) => {
      if (state.transforming || state.confirming) return;
      wizard.goToStep(step);
    },
    [state.transforming, state.confirming, wizard],
  );

  // ── Footer button config ──

  const getNextAction = (): {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    disabled: boolean;
    variant: 'violet' | 'emerald';
    spinning?: boolean;
  } | null => {
    switch (state.step) {
      case 'choose':
        return { label: 'Connect', icon: ArrowRight, disabled: false, variant: 'violet' };
      case 'connect': {
        const unconfigured = requiredConnectors.filter(
          (c) => !state.connectorCredentialMap[c.activeName],
        ).length;
        return {
          label: unconfigured > 0 ? `Configure (${unconfigured} remaining)` : 'Configure',
          icon: ArrowRight,
          disabled: unconfigured > 0,
          variant: 'violet',
        };
      }
      case 'tune':
        if (state.questionGenerating) {
          return { label: 'Analyzing...', icon: RefreshCw, disabled: true, variant: 'violet', spinning: true };
        }
        if (state.backgroundAdoptId && state.questions) {
          return { label: 'Continue with Answers', icon: ArrowRight, disabled: false, variant: 'violet' };
        }
        return { label: 'Build Persona', icon: Sparkles, disabled: false, variant: 'violet' };
      case 'build':
        return state.transforming
          ? { label: 'Generating...', icon: RefreshCw, disabled: true, variant: 'violet', spinning: true }
          : { label: 'Review Draft', icon: ArrowRight, disabled: !state.draft, variant: 'violet' };
      case 'create':
        if (state.created) {
          return { label: 'Done', icon: Check, disabled: false, variant: 'emerald' };
        }
        return state.confirming
          ? { label: 'Creating...', icon: RefreshCw, disabled: true, variant: 'emerald', spinning: true }
          : { label: 'Create Persona', icon: Sparkles, disabled: !state.draft, variant: 'emerald' };
      default:
        return null;
    }
  };

  const nextAction = getNextAction();

  const getBackLabel = () => {
    if (state.step === 'choose') return 'Cancel';
    if (state.step === 'build' && state.transforming) return 'Cancel';
    return 'Back';
  };

  // ── Render active step ──

  const StepComponent = STEP_COMPONENTS[state.step];

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={(e) => { if (e.target === backdropRef.current) handleClose(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Full-screen modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ duration: 0.2 }}
        className="relative w-[95vw] max-w-[1400px] h-[92vh] bg-background border border-primary/15 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-primary/10 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
              <Download className="w-4.5 h-4.5 text-violet-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground/90">Adopt Template</h2>
              <p className="text-sm text-muted-foreground/90">{state.templateName}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {designResult && <DimensionRadial designResult={designResult} size={28} />}
            <button
              onClick={handleClose}
              disabled={state.confirming}
              className="p-1.5 rounded-lg hover:bg-secondary/50 transition-colors text-muted-foreground/80 hover:text-foreground/95 disabled:opacity-30"
              title={state.transforming ? 'Close (processing continues in background)' : 'Close'}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Error banner */}
        {state.error && state.step !== 'build' && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mx-6 mt-2 flex items-start gap-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20"
          >
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-400/80 flex-1">{state.error}</p>
            <button
              onClick={() => wizard.clearError()}
              className="text-red-400/50 hover:text-red-400 text-sm"
            >
              Dismiss
            </button>
          </motion.div>
        )}

        {/* Main body: Sidebar + Content */}
        <div className="flex flex-1 min-h-0">
          <WizardSidebar
            steps={SIDEBAR_STEPS}
            currentStep={state.step}
            completedSteps={completedSteps}
            onStepClick={handleSidebarStepClick}
            disabled={state.transforming || state.confirming}
          />

          {/* Content area */}
          <div className="flex-1 overflow-y-auto min-h-0 p-6">
            <AnimatePresence mode="wait">
              {(state.step !== 'choose' || designResult) && (
                <motion.div
                  key={state.step}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.15 }}
                  className={state.step === 'build' ? 'space-y-4' : undefined}
                >
                  <StepComponent />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-primary/10 bg-secondary/10 flex-shrink-0">
          <BackButton
            state={state}
            onClose={handleClose}
            onBack={() => wizard.goBack()}
            getBackLabel={getBackLabel}
          />

          <div className="flex items-center gap-2">
            {nextAction && (
              <button
                onClick={() => {
                  if (state.created) handleClose();
                  else handleNext();
                }}
                disabled={nextAction.disabled}
                className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-xl border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  nextAction.variant === 'emerald'
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25 hover:bg-emerald-500/25'
                    : 'bg-violet-500/15 text-violet-300 border-violet-500/25 hover:bg-violet-500/25'
                }`}
              >
                <nextAction.icon
                  className={`w-4 h-4 ${nextAction.spinning ? 'animate-spin' : ''}`}
                />
                {nextAction.label}
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ── Public modal (wraps with provider) ─────────────────────────────────

export default function AdoptionWizardModal({
  isOpen,
  onClose,
  review,
  credentials,
  connectorDefinitions,
  onPersonaCreated,
}: AdoptionWizardModalProps) {
  if (!isOpen) return null;

  return (
    <AdoptionWizardProvider
      isOpen={isOpen}
      review={review}
      credentials={credentials}
      connectorDefinitions={connectorDefinitions}
      onPersonaCreated={onPersonaCreated}
    >
      <AdoptionWizardInner onClose={onClose} />
    </AdoptionWizardProvider>
  );
}
